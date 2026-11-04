// Library API: list/search, albums, media files, drag-drop import, favorites, approvals, watched folder.
import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { createReadStream, existsSync, watch } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DB } from './db.ts';
import { importFile } from './media.ts';

type Row = Record<string, unknown>;
const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/mp4' };

export const ALBUMS = [
  { id: 'all', title: 'كل الصور', icon: 'images' },
  { id: 'approved', title: 'المعتمد', icon: 'check' },
  { id: 'favorites', title: 'المفضّل', icon: 'heart' },
  { id: 'locked', title: 'المراجع المقفولة', icon: 'lock' },
  { id: 'waiting', title: 'مستني اعتمادك', icon: 'clock' },
  { id: 'videos', title: 'الفيديوهات', icon: 'video' }
] as const;

function where(album: string): string {
  const approved = `EXISTS (SELECT 1 FROM approval ap WHERE ap.subject_type='asset' AND ap.subject_id=a.id)`;
  switch (album) {
    case 'approved': return approved;
    case 'favorites': return 'a.favorite = 1';
    case 'locked': return 'a.locked = 1';
    case 'waiting': return `NOT ${approved} AND a.kind IN ('image','video')`;
    case 'videos': return `a.kind = 'video'`;
    default:
      if (album.startsWith('project:')) return `a.project_id = '${album.slice(8).replace(/'/g, '')}'`;
      if (album.startsWith('person:')) return `a.character_id = '${album.slice(7).replace(/'/g, '')}'`;
      return `a.kind IN ('image','video')`;
  }
}

function shape(r: Row) {
  return {
    ...r,
    provenance: JSON.parse(String(r.provenance ?? '{}')),
    approved: !!r.approved, favorite: !!r.favorite, locked: !!r.locked,
    thumb: r.thumb_path ? `/media/${r.id}/thumb` : r.remote_url ?? null,
    src: r.work_path ? `/media/${r.id}/work` : r.remote_url ?? null,
    original: r.original_path ? `/media/${r.id}/original` : r.remote_url ?? null,
    original_path: undefined, work_path: undefined, thumb_path: undefined
  };
}

export async function libraryRoutes(app: FastifyInstance, db: DB, dataDir: string) {
  await app.register(multipart, { limits: { fileSize: 4 * 1024 ** 3 } });
  const SELECT = `SELECT a.*, EXISTS (SELECT 1 FROM approval ap WHERE ap.subject_type='asset' AND ap.subject_id=a.id) AS approved,
    c.name AS character_name, p.title AS project_title FROM asset a LEFT JOIN character c ON c.id=a.character_id LEFT JOIN project p ON p.id=a.project_id`;

  app.get('/api/assets', async req => {
    const q = (req.query as Row) ?? {};
    const album = String(q.album ?? 'all'), search = String(q.q ?? '').trim();
    let sql = `${SELECT} WHERE ${where(album)}`; const args: string[] = [];
    if (search) { sql += ` AND a.id IN (SELECT asset_id FROM asset_fts WHERE asset_fts MATCH ?)`; args.push(search.split(/\s+/).map(w => `"${w.replace(/"/g, '')}"*`).join(' ')); }
    sql += ' ORDER BY a.created_at ASC'; // newest at the bottom, like Photos
    return { items: (db.prepare(sql).all(...args) as Row[]).map(shape) };
  });

  app.get('/api/albums', async () => {
    const count = (a: string) => (db.prepare(`SELECT count(*) AS n FROM asset a WHERE ${where(a)}`).get() as { n: number }).n;
    const cover = (a: string) => (db.prepare(`SELECT a.id FROM asset a WHERE ${where(a)} AND a.kind IN ('image','video') ORDER BY a.created_at DESC LIMIT 1`).get() as { id?: string } | undefined)?.id ?? null;
    const projects = (db.prepare('SELECT id, title FROM project').all() as { id: string; title: string }[]).map(p => ({ id: 'project:' + p.id, title: p.title, icon: 'folder', count: count('project:' + p.id), cover: cover('project:' + p.id) }));
    const people = (db.prepare('SELECT id, name FROM character').all() as { id: string; name: string }[]).map(c => ({ id: 'person:' + c.id, title: c.name, count: count('person:' + c.id), cover: cover('person:' + c.id) }));
    return { albums: ALBUMS.map(a => ({ ...a, count: count(a.id), cover: cover(a.id) })), projects, people };
  });

  app.get('/media/:id/:variant', async (req, reply) => {
    const { id, variant } = req.params as { id: string; variant: string };
    const col = variant === 'thumb' ? 'thumb_path' : variant === 'original' ? 'original_path' : 'work_path';
    const r = db.prepare(`SELECT ${col} AS p FROM asset WHERE id = ?`).get(id) as { p?: string } | undefined;
    if (!r?.p || !existsSync(r.p)) return reply.code(404).send({ what: 'الملف مش موجود' });
    const size = (await stat(r.p)).size, type = MIME[extname(r.p).toLowerCase()] ?? 'application/octet-stream';
    reply.header('Cache-Control', 'private, max-age=31536000, immutable').header('Accept-Ranges', 'bytes').type(type);
    const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
    if (range) {
      const start = Number(range[1] || 0), end = range[2] ? Number(range[2]) : size - 1;
      reply.code(206).header('Content-Range', `bytes ${start}-${end}/${size}`).header('Content-Length', end - start + 1);
      return reply.send(createReadStream(r.p, { start, end }));
    }
    reply.header('Content-Length', size);
    return reply.send(createReadStream(r.p));
  });

  app.post('/api/assets/import', async req => {
    const tmp = join(dataDir, 'tmp'); await mkdir(tmp, { recursive: true });
    const out = [];
    for await (const part of req.files()) {
      const dst = join(tmp, randomUUID() + extname(part.filename));
      await pipeline(part.file, createWriteStream(dst));
      try { out.push({ name: part.filename, ...(await importFile(db, dataDir, dst, { name: part.filename, source: 'drop', projectId: 'iatw' })) }); }
      finally { await rm(dst, { force: true }); }
    }
    return { imported: out };
  });

  app.post('/api/assets/:id/favorite', async req => {
    const { id } = req.params as { id: string };
    db.prepare('UPDATE asset SET favorite = 1 - favorite WHERE id = ?').run(id);
    return db.prepare('SELECT favorite FROM asset WHERE id = ?').get(id);
  });

  // «اعتمد» — the only way an asset becomes approved.
  app.post('/api/assets/:id/approve', async req => {
    const { id } = req.params as { id: string };
    db.prepare(`INSERT OR IGNORE INTO approval (id, subject_type, subject_id, stage) VALUES (?, 'asset', ?, 'asset')`).run(randomUUID(), id);
    return { approved: true };
  });

  startWatcher(db, dataDir, app.log);
}

/** Watched folder: anything dropped in Inbox is imported, then moved to Inbox/Imported. */
function startWatcher(db: DB, dataDir: string, log: { error: (m: unknown) => void }) {
  const inbox = process.env.GHORFA_INBOX ?? join(dataDir, 'Inbox');
  const done = join(inbox, 'Imported');
  mkdir(done, { recursive: true }).then(() => {
    const pending = new Map<string, NodeJS.Timeout>();
    watch(inbox, (_ev, name) => {
      if (!name || name.startsWith('.') || name === 'Imported') return;
      clearTimeout(pending.get(name));
      pending.set(name, setTimeout(async () => {
        pending.delete(name);
        const f = join(inbox, name);
        if (!existsSync(f)) return;
        try { await importFile(db, dataDir, f, { name, source: 'watch', projectId: 'iatw' }); await rename(f, join(done, basename(f))); }
        catch (e) { log.error(e); }
      }, 1500)); // wait for the copy to finish
    });
  }).catch(e => log.error(e));
}
