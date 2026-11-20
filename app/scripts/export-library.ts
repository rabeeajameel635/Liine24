// Dev tool: write setup/library.json and setup/connections.json from a working database, so the Mac starts with the same
// library and decisions. No URLs and no account id go in: the Mac fetches each file through the official Higgsfield MCP
// (show_medias) by its media id, and checks its SHA-256 before importing.
// Usage: node scripts/export-library.ts <ghorfa.sqlite>
import { writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.argv[2]);
const rows = db.prepare(`SELECT a.*, EXISTS (SELECT 1 FROM approval p WHERE p.subject_type = 'asset' AND p.subject_id = a.id) AS approved FROM asset a WHERE a.kind IN ('image','video','audio') ORDER BY a.created_at`).all() as Record<string, unknown>[];
const songAudio = (db.prepare(`SELECT audio_asset_id FROM song WHERE id = 'iatw-v44'`).get() as { audio_asset_id?: string } | undefined)?.audio_asset_id;
const items = rows.map(r => {
  const p = JSON.parse(String(r.provenance || '{}')) as Record<string, unknown>;
  const ids = [r.source_ref, p.upload_id, p.media_id].filter((x, i, a) => typeof x === 'string' && /^[0-9a-f-]{36}$/.test(x) && a.indexOf(x) === i) as string[];
  if (r.id === songAudio) ids.push('453add2b-40f7-4183-bcaa-edf702cbb6d3'); // the v44 MP3 upload (MD5 240cd5100560226f7f83534bfd1d894c)
  const keep = ['tool', 'higgsfield_project', 'higgsfield_project_id', 'folder', 'license', 'note', 'md5'];
  return {
    ids, sha256: r.sha256, kind: r.kind, label: r.label ?? null, folder: r.folder ?? null, role: r.role ?? null, locked: !!r.locked, approved: !!r.approved,
    warn: r.warn ?? null, no_generation: !!r.no_generation, face_baseline: !!r.face_baseline, character_id: r.character_id ?? null, created_at: r.created_at,
    song_audio: r.id === songAudio ? 'iatw-v44' : undefined, provenance: Object.fromEntries(Object.entries(p).filter(([k]) => keep.includes(k)))
  };
});
writeFileSync(new URL('../setup/library.json', import.meta.url), JSON.stringify({ exported: new Date().toISOString().slice(0, 10), items }, null, 1));
const conns = db.prepare(`SELECT id, verified_url, verified_source, verified_quote, verified_at FROM connection WHERE verified_at IS NOT NULL`).all();
writeFileSync(new URL('../setup/connections.json', import.meta.url), JSON.stringify(conns, null, 1));
console.log(`library: ${items.length} · without an id: ${items.filter(i => !i.ids.length).length} · connections: ${conns.length}`);
