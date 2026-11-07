// Import a Higgsfield project manifest (produced from Higgsfield MCP: list_project_assets + show_medias).
// Usage: node server/import-higgsfield.ts <manifest.json>
// Downloads each file and imports it with provenance. If a download fails (network), the asset is kept as a remote
// reference so nothing is lost, and re-running the import later fills in the bytes (idempotent by source_ref).
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { openDb } from './db.ts';
import { importFile } from './media.ts';

type Item = {
  media_id: string; url: string; folder: string; created_at: string; label?: string;
  role?: 'sheet' | 'look' | 'reference'; locked?: boolean;
  approved_note?: string; // set only when the user approved this item explicitly
  warn?: string; no_generation?: boolean; face_baseline?: boolean;
  md5?: string; // when given, the downloaded bytes must match it or nothing is imported
  upload_id?: string; // Higgsfield media id the file was re-uploaded under (source_ref stays the original job id)
};
type Manifest = { project: { id: string; name: string; workspace_id: string }; character_id: string; items: Item[] };

const file = process.argv[2];
if (!file) { console.error('محتاج مسار الـ manifest'); process.exit(1); }
const dataDir = process.env.GHORFA_DATA ?? join(homedir(), 'Library', 'Application Support', 'Ghorfa');
const db = openDb(join(dataDir, 'ghorfa.sqlite'));
const m = JSON.parse(await readFile(file, 'utf8')) as Manifest;

db.prepare(`INSERT OR IGNORE INTO character (id, brand_id, name, modesty, forbidden) VALUES (?, 'liine24', ?, ?, ?)`).run(
  m.character_id, 'دنيا',
  'الصدر والضهر مغطيين، ومفيش شفافية زيادة. القصّات الضيقة والكتف الواحد مسموحين.',
  JSON.stringify(['عنصر Higgsfield القديم «Donia» (وش تاني)']));

const tmp = join(dataDir, 'tmp'); await mkdir(tmp, { recursive: true });
let ok = 0, remote = 0, skipped = 0;
for (const it of m.items) {
  const existing = db.prepare('SELECT id, original_path FROM asset WHERE source = ? AND source_ref = ?').get('higgsfield', it.media_id) as { id: string; original_path: string | null } | undefined;
  if (existing?.original_path) { db.prepare('UPDATE asset SET warn = ?, no_generation = ?, face_baseline = ?, label = COALESCE(?, label) WHERE id = ?').run(it.warn ?? null, it.no_generation ? 1 : 0, it.face_baseline ? 1 : 0, it.label ?? null, existing.id); skipped++; continue; }
  const provenance = { tool: 'Higgsfield', upload_id: it.upload_id ?? null, md5: it.md5 ?? null, higgsfield_project: m.project.name, higgsfield_project_id: m.project.id, media_id: it.media_id, folder: it.folder, license: 'Higgsfield — خطة Max', prompt: null, seed: null };
  const meta = { name: it.media_id + extname(new URL(it.url).pathname), label: it.label, source: 'higgsfield' as const, sourceRef: it.media_id, folder: it.folder,
    projectId: 'iatw', createdAt: it.created_at, provenance, role: it.role, locked: !!it.locked, characterId: m.character_id, tags: 'دنيا Donia ' + (it.label ?? '') };
  let id: string;
  try {
    const res = await fetch(it.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (it.md5) { const got = createHash('md5').update(buf).digest('hex'); if (got !== it.md5) throw new Error(`MD5 مش مطابق: ${got}`); }
    const dst = join(tmp, it.media_id + extname(new URL(it.url).pathname));
    await writeFile(dst, buf);
    if (existing) for (const q of ['DELETE FROM asset WHERE id = ?', 'DELETE FROM asset_fts WHERE asset_id = ?', `DELETE FROM approval WHERE subject_type = 'asset' AND subject_id = ?`]) db.prepare(q).run(existing.id);
    id = (await importFile(db, dataDir, dst, meta)).id; ok++;
    await rm(dst, { force: true });
  } catch (e) {
    if (existing) { skipped++; continue; }
    id = randomUUID(); remote++;
    db.prepare(`INSERT INTO asset (id, project_id, name, label, kind, remote_url, source, source_ref, folder, provenance, role, locked, character_id, created_at)
      VALUES (?, 'iatw', ?, ?, 'image', ?, 'higgsfield', ?, ?, ?, ?, ?, ?, ?)`).run(id, meta.name, it.label ?? null, it.url, it.media_id, it.folder,
      JSON.stringify({ ...provenance, fetch_error: String((e as Error).message) }), it.role ?? null, it.locked ? 1 : 0, m.character_id, it.created_at);
    db.prepare('INSERT INTO asset_fts (asset_id, name, label, prompt, tags) VALUES (?,?,?,?,?)').run(id, meta.name, it.label ?? '', '', meta.tags);
  }
  db.prepare('UPDATE asset SET warn = ?, no_generation = ?, face_baseline = ? WHERE id = ?').run(it.warn ?? null, it.no_generation ? 1 : 0, it.face_baseline ? 1 : 0, id);
  if (it.approved_note) db.prepare(`INSERT OR IGNORE INTO approval (id, subject_type, subject_id, stage) VALUES (?, 'asset', ?, 'asset')`).run(randomUUID(), id);
}
console.log(`اتسحب ${ok} · مرجع بعيد ${remote} · موجود قبل كده ${skipped}`);
