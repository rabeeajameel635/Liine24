// أول تشغيل على الماك: (١) موديلات الوش (٢) تسجيل الدخول في Higgsfield وSuno وRunway (٣) فحص وش دنيا.
// The Mac starts with an empty database. setup/library.json (ids + SHA-256 + decisions, no URLs) is pulled through the official
// Higgsfield MCP (show_medias) right after the Higgsfield login; every file is checked against its SHA-256 before import.
import type { FastifyInstance } from 'fastify';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { DB } from './db.ts';
import { importFile } from './media.ts';
import { callMcpTool, onConnected } from './connections.ts';
import { modelsReady, decodeRGB, faceScore } from './face.ts';
import { PASS } from './qc.ts';
import { seedRefs } from './refs.ts';
import { seedTimelineV44 } from './timeline.ts';

export type LibItem = { ids: string[]; sha256: string; kind: 'image' | 'video' | 'audio'; label: string | null; folder: string | null; role: string | null; locked: boolean; approved: boolean;
  warn: string | null; no_generation: boolean; face_baseline: boolean; character_id: string | null; created_at: string; song_audio?: string; provenance: Record<string, unknown> };
export type Resolver = (ids: Set<string>, kind: 'image' | 'audio' | 'video') => Promise<Map<string, string>>;

const SCORED = ['pass', 'warn', 'none']; // face_check after a real score ('pending' is the column default)
const state = { running: false, error: null as string | null, done: 0, total: 0, failed: [] as string[], face: { running: false, error: null as string | null } };

/** The three MCP addresses Rabee confirmed on the companies' own sites (4 Nov). */
export async function seedConnections(db: DB, root: string) {
  const rows = JSON.parse(await readFile(join(root, 'setup', 'connections.json'), 'utf8').catch(() => '[]')) as Record<string, string>[];
  for (const r of rows) db.prepare(`INSERT OR IGNORE INTO connection (id, verified_url, verified_source, verified_quote, verified_at, status) VALUES (?, ?, ?, ?, ?, 'unknown')`)
    .run(r.id, r.verified_url, r.verified_source, r.verified_quote, r.verified_at);
}

/** Pages through show_medias until every wanted id is found (the JSON block carries items[{id,url}] and next_cursor). */
export const higgsfieldResolver = (db: DB, port: number): Resolver => async (ids, kind) => {
  const found = new Map<string, string>(); let cursor: number | undefined;
  for (let page = 0; page < 60 && found.size < ids.size; page++) {
    const r = await callMcpTool(db, 'higgsfield', port, 'show_medias', { type: kind, size: 100, ...(cursor ? { cursor } : {}) });
    if (r.isError) throw new Error('Higgsfield رفض طلب المكتبة');
    const json = (r.content ?? []).map(c => c.text ?? '').map(t => { const i = t.indexOf('{"items"'); if (i < 0) return null; try { return JSON.parse(t.slice(i)) as { items: { id: string; url: string }[]; next_cursor: number | null }; } catch { return null; } }).find(Boolean);
    if (!json) throw new Error('رد Higgsfield مش بالشكل المتوقع');
    for (const it of json.items) if (ids.has(it.id)) found.set(it.id, it.url);
    if (!json.next_cursor) break; cursor = json.next_cursor;
  }
  return found;
};

export async function syncLibrary(db: DB, dataDir: string, root: string, resolve: Resolver, analyzeSong?: (id: string) => Promise<void>) {
  if (state.running) return; state.running = true; state.error = null; state.failed = [];
  try {
    const lib = JSON.parse(await readFile(join(root, 'setup', 'library.json'), 'utf8')) as { items: LibItem[] };
    const have = (sha: string) => db.prepare('SELECT id FROM asset WHERE sha256 = ?').get(sha) as { id: string } | undefined;
    const todo = lib.items.filter(i => !have(i.sha256));
    state.total = lib.items.length; state.done = lib.items.length - todo.length;
    const tmp = join(dataDir, 'tmp'); await mkdir(tmp, { recursive: true });
    for (const kind of ['image', 'audio', 'video'] as const) {
      const group = todo.filter(i => i.kind === kind); if (!group.length) continue;
      const urls = await resolve(new Set(group.flatMap(i => i.ids)), kind);
      for (const it of group) {
        const url = it.ids.map(id => urls.get(id)).find(Boolean);
        if (!url) { state.failed.push(it.label ?? it.ids[0]); continue; }
        const res = await fetch(url); if (!res.ok) { state.failed.push(it.label ?? it.ids[0]); continue; }
        const buf = Buffer.from(await res.arrayBuffer());
        if (createHash('sha256').update(buf).digest('hex') !== it.sha256) { state.failed.push(`${it.label ?? it.ids[0]} (الـ SHA مش مطابق)`); continue; }
        const ext = (new URL(url).pathname.match(/\.\w+$/) ?? ['.bin'])[0]; const f = join(tmp, it.ids[0] + ext); await writeFile(f, buf);
        const r = await importFile(db, dataDir, f, { name: it.ids[0] + ext, label: it.label ?? undefined, source: kind === 'audio' ? 'drop' : 'higgsfield', sourceRef: it.ids[0],
          folder: it.folder ?? undefined, projectId: 'iatw', createdAt: it.created_at, role: it.role ?? undefined, locked: it.locked, characterId: it.character_id ?? undefined,
          provenance: { ...it.provenance, media_ids: it.ids }, tags: [it.label, it.character_id === 'donia' ? 'دنيا Donia' : ''].filter(Boolean).join(' ') });
        await rm(f, { force: true });
        db.prepare('UPDATE asset SET warn = ?, no_generation = ?, face_baseline = ? WHERE id = ?').run(it.warn, it.no_generation ? 1 : 0, it.face_baseline ? 1 : 0, r.id);
        if (it.approved) db.prepare(`INSERT OR IGNORE INTO approval (id, subject_type, subject_id, stage) VALUES (?, 'asset', ?, 'asset')`).run(randomUUID(), r.id);
        if (it.song_audio) {
          db.prepare('UPDATE song SET audio_asset_id = ? WHERE id = ?').run(r.id, it.song_audio); await analyzeSong?.(it.song_audio);
          await seedTimelineV44(db, join(root, '..', 'projects', 'i-am-the-world', 'timeline_v44.json')); // segments onto the measured bars now, not at the next restart
        }
        state.done++;
      }
    }
    // what depended on the pictures: the song's poster and the @ constants
    db.prepare(`UPDATE song SET poster_asset_id = (SELECT id FROM asset WHERE label = 'Departure') WHERE id = 'iatw-v44' AND poster_asset_id IS NULL`).run();
    seedRefs(db);
  } catch (e) { state.error = (e as Error).message; } finally { state.running = false; }
}

/** Donia's approved references (not the H2 paintings): free face score for each; under 95 gets marked. */
export function doniaRefs(db: DB) {
  return db.prepare(`SELECT a.id, a.label, a.work_path, a.thumb_path, a.face_score, a.face_check FROM asset a WHERE a.character_id = 'donia' AND a.kind = 'image'
    AND (a.folder IS NULL OR a.folder NOT LIKE 'H2%') AND EXISTS (SELECT 1 FROM approval p WHERE p.subject_type = 'asset' AND p.subject_id = a.id) ORDER BY a.created_at`).all() as Record<string, string | number | null>[];
}
export async function faceCheckDonia(db: DB, dataDir: string) {
  if (!modelsReady(dataDir) || state.face.running) return; state.face.running = true; state.face.error = null;
  try {
    for (const a of doniaRefs(db)) {
      const r = await faceScore(db, dataDir, [await decodeRGB(String(a.work_path), 1600)]);
      db.prepare('UPDATE asset SET face_score = ?, face_check = ? WHERE id = ?').run(r.pct, r.pct == null ? 'none' : r.pct >= PASS ? 'pass' : 'warn', a.id);
    }
  } catch (e) { state.face.error = (e as Error).message; } finally { state.face.running = false; }
}

export async function setupRoutes(app: FastifyInstance, db: DB, dataDir: string, root: string, port: number, analyzeSong: (id: string) => Promise<void>) {
  await seedConnections(db, root);
  // 6 Nov: the three H2 paintings belong to the corridor folder only, not to Donia's references
  db.prepare(`UPDATE asset SET character_id = NULL WHERE folder LIKE 'H2%' AND character_id = 'donia'`).run();
  // GHORFA_TEST_RESOLVE=<file of {id: url}>: dev only, to rehearse a first run without the Mac's Higgsfield login
  const resolver: Resolver = process.env.GHORFA_TEST_RESOLVE
    ? async ids => { const m = JSON.parse(await readFile(process.env.GHORFA_TEST_RESOLVE!, 'utf8')) as Record<string, string>; return new Map([...ids].filter(i => m[i]).map(i => [i, m[i]])); }
    : higgsfieldResolver(db, port);
  const sync = () => syncLibrary(db, dataDir, root, resolver, analyzeSong).then(() => faceCheckDonia(db, dataDir)).catch(e => app.log.warn(String(e)));
  onConnected.push(id => { if (id === 'higgsfield') sync(); });
  // models came after the library: score the faces once, automatically
  if (modelsReady(dataDir) && doniaRefs(db).length && doniaRefs(db).every(a => !SCORED.includes(String(a.face_check)))) setTimeout(() => { faceCheckDonia(db, dataDir); }, 2000);

  app.get('/api/setup', async () => {
    const lib = JSON.parse(await readFile(join(root, 'setup', 'library.json'), 'utf8').catch(() => '{"items":[]}')) as { items: LibItem[] };
    const have = lib.items.filter(i => db.prepare('SELECT 1 FROM asset WHERE sha256 = ?').get(i.sha256)).length;
    const svc = (id: string) => (db.prepare('SELECT status FROM connection WHERE id = ?').get(id) as { status?: string } | undefined)?.status ?? 'unknown';
    const refs = doniaRefs(db).map(a => ({ id: a.id, label: a.label, thumb: a.thumb_path ? `/media/${a.id}/thumb` : null, pct: a.face_score, state: a.face_check }));
    return {
      models: modelsReady(dataDir),
      services: ['higgsfield', 'suno', 'runway'].map(id => ({ id, status: svc(id) })),
      library: { total: lib.items.length, have, running: state.running, error: state.error, failed: state.failed },
      face: { running: state.face.running, error: state.face.error, refs, done: refs.length > 0 && refs.every(r => SCORED.includes(String(r.state))) }
    };
  });
  // «اللي محتاجه مني على الماك»: one source, docs/mac-checklist.md, shown as is
  app.get('/api/setup/checklist', async () => {
    const md = await readFile(join(root, '..', 'docs', 'mac-checklist.md'), 'utf8').catch(() => '');
    return { items: md.split('\n').filter(l => /^\d+\.\s/.test(l)).map(l => l.replace(/^\d+\.\s*/, '')) };
  });
  app.post('/api/setup/sync', async () => { sync(); return { ok: true }; });
  app.post('/api/setup/face-check', async (_req, reply) => {
    if (!modelsReady(dataDir)) return reply.code(409).send({ what: 'موديلات الوش لسه ما نزلتش', fix: 'شغّل npm run mac-setup' });
    faceCheckDonia(db, dataDir); return { ok: true };
  });
}
