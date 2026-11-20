// Rebuild grid thumbnails for every stored image/video (e.g. after the thumbnail rules change).
// Usage: node server/rethumb.ts
import { join } from 'node:path';
import { homedir } from 'node:os';
import { openDb } from './db.ts';
import { probe, thumb } from './media.ts';

const dataDir = process.env.GHORFA_DATA ?? join(homedir(), 'Library', 'Application Support', 'Ghorfa');
const db = openDb(join(dataDir, 'ghorfa.sqlite'));
const rows = db.prepare(`SELECT id, work_path, thumb_path FROM asset WHERE work_path IS NOT NULL AND thumb_path IS NOT NULL AND kind IN ('image','video')`).all() as { id: string; work_path: string; thumb_path: string }[];
for (const r of rows) await thumb(r.work_path, r.thumb_path, await probe(r.work_path));
console.log(`اتعمل ${rows.length} مصغّر`);
