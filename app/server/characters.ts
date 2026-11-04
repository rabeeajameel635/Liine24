// Character card API. The card is built from approved/locked library assets; it is a draft until the user taps «اعتمد».
import type { FastifyInstance } from 'fastify';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import type { DB } from './db.ts';

const run = promisify(execFile);
type Row = Record<string, unknown>;

/** Dominant colours of an image (k-means on a small RGB thumbnail), as hex. Used as a *suggested* wardrobe palette. */
async function palette(path: string, k = 3): Promise<string[]> {
  const S = 48;
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', path, '-vf', `crop=iw*0.6:ih*0.6,scale=${S}:${S},format=rgb24`, '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 1 << 20 }) as unknown as { stdout: Buffer };
  const px: number[][] = []; for (let i = 0; i + 2 < stdout.length; i += 3) px.push([stdout[i], stdout[i + 1], stdout[i + 2]]);
  let c = Array.from({ length: k }, (_, i) => px[Math.floor((i + 0.5) * px.length / k)].slice());
  let n: number[] = [];
  for (let it = 0; it < 10; it++) {
    const sum = c.map(() => [0, 0, 0]); n = c.map(() => 0);
    for (const p of px) { let b = 0, bd = Infinity; c.forEach((q, j) => { const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2; if (d < bd) { bd = d; b = j; } }); sum[b][0] += p[0]; sum[b][1] += p[1]; sum[b][2] += p[2]; n[b]++; }
    c = sum.map((s, j) => n[j] ? s.map(v => v / n[j]) : c[j]);
  }
  return c.map((q, j) => ({ q, w: n[j] })).sort((a, b) => b.w - a.w).map(({ q }) => '#' + q.map(v => Math.round(v).toString(16).padStart(2, '0')).join(''));
}

export async function characterRoutes(app: FastifyInstance, db: DB) {
  app.get('/api/characters/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = db.prepare('SELECT ch.*, b.name AS brand, b.line FROM character ch JOIN brand b ON b.id = ch.brand_id WHERE ch.id = ?').get(id) as Row | undefined;
    if (!c) return reply.code(404).send({ what: 'الشخصية مش موجودة' });
    const refs = db.prepare(`SELECT a.id, a.label, a.role, a.locked, a.work_path, a.source_ref,
        EXISTS (SELECT 1 FROM approval ap WHERE ap.subject_type='asset' AND ap.subject_id=a.id) AS approved
      FROM asset a WHERE a.character_id = ? AND (a.locked = 1 OR EXISTS (SELECT 1 FROM approval ap WHERE ap.subject_type='asset' AND ap.subject_id=a.id))
      ORDER BY CASE a.role WHEN 'sheet' THEN 0 WHEN 'reference' THEN 1 WHEN 'look' THEN 2 ELSE 3 END, a.created_at LIMIT 20`).all(id) as Row[];
    const pal: Record<string, string[]> = {};
    for (const r of refs) if (r.role === 'reference' && r.work_path) pal[String(r.id)] = await palette(String(r.work_path)).catch(() => []);
    const approved = !!db.prepare(`SELECT 1 FROM approval WHERE subject_type='character' AND subject_id=? AND stage='card'`).get(id);
    return {
      id: c.id, name: c.name, brand: c.brand, line: c.line, version: c.version, approved,
      locked_text: c.locked_text, modesty: c.modesty, voice: c.voice,
      wardrobe: JSON.parse(String(c.wardrobe || '{}')), forbidden: JSON.parse(String(c.forbidden || '[]')),
      identity: { baseline: c.identity_baseline, threshold: c.identity_threshold, model: null },
      refs: refs.map(r => ({ id: r.id, label: r.label, role: r.role, locked: !!r.locked, approved: !!r.approved, thumb: `/media/${r.id}/thumb`, src: `/media/${r.id}/work`, palette: pal[String(r.id)] ?? null }))
    };
  });

  // «اعتمد» for the card itself
  app.post('/api/characters/:id/approve', async req => {
    const { id } = req.params as { id: string };
    db.prepare(`INSERT OR IGNORE INTO approval (id, subject_type, subject_id, stage) VALUES (?, 'character', ?, 'card')`).run(randomUUID(), id);
    return { approved: true };
  });
}

/** Seed Donia's card text from the decisions recorded in projects/i-am-the-world/README.md (4 Nov 2026). Draft until approved. */
export function seedDonia(db: DB) {
  const c = db.prepare(`SELECT locked_text FROM character WHERE id = 'donia'`).get() as { locked_text: string } | undefined;
  if (!c || c.locked_text) return;
  const wardrobe = {
    reference: 'Donia-Final (Higgsfield): Head sheet 2K + شيت الأربع زوايا + turnaround',
    sheet: 'DONIA_WARDROBE_LOCK_v2',
    looks: ['Departure', 'Fame', 'Love v2'],
    constants: ['نفس اللوفر الأبيض بالظبط', 'مشبك «سِرّ» القرمزي', 'من غير مجوهرات']
  };
  db.prepare(`UPDATE character SET version = 2, wardrobe = ?, forbidden = ?, locked_text = ? WHERE id = 'donia'`).run(
    JSON.stringify(wardrobe),
    JSON.stringify(['عنصر Higgsfield القديم «Donia» (وش تاني)', 'أي مجوهرات', 'شفافية زيادة']),
    'Donia — the same woman as Donia-Final in every frame. Exactly the same white loafers as the locked shoe reference. The crimson «سِرّ» hair clip. No jewelry. Chest and back covered; no added sheerness; fitted cuts and one-shoulder are allowed.');
}

// ---------- wardrobe pieces: colours measured from the piece only ----------
import { mkdir as mkdirP } from 'node:fs/promises';
import { existsSync as exists } from 'node:fs';
import { join as pjoin } from 'node:path';

const PIECES = [
  { id: 'donia-clip', name: 'مشبك «سِرّ»', ref: 'fab411cb', box: { x: 0.712, y: 0.605, w: 0.06, h: 0.095 }, mode: 'red' },
  { id: 'donia-jacket', name: 'الجاكيت', ref: '3b66f274', box: { x: 0.31, y: 0.16, w: 0.16, h: 0.5 }, mode: 'all' },
  { id: 'donia-blouse', name: 'البلوزة الأوف وايت', ref: '3b66f274', box: { x: 0.55, y: 0.16, w: 0.1, h: 0.32 }, mode: 'all' },
  { id: 'donia-trousers', name: 'البنطلون الأوف وايت', ref: '9edbdf00', box: { x: 0.41, y: 0.5, w: 0.13, h: 0.34 }, mode: 'all' },
  { id: 'donia-loafer', name: 'اللوفر الأبيض', ref: '859d8b5f', box: { x: 0.19, y: 0.5, w: 0.13, h: 0.16 }, mode: 'all' }
] as const;

function seedPieces(db: DB) {
  if (!db.prepare(`SELECT 1 FROM character WHERE id = 'donia'`).get()) return; // the card comes with the Higgsfield import
  const ins = db.prepare(`INSERT OR IGNORE INTO wardrobe_piece (id, character_id, name, asset_ref, box, mode) VALUES (?, 'donia', ?, ?, ?, ?)`);
  for (const p of PIECES) ins.run(String(p.id), String(p.name), String(p.ref), JSON.stringify(p.box), String(p.mode));
}

async function measure(path: string, box: { x: number; y: number; w: number; h: number }, mode: string): Promise<string[]> {
  const S = 64;
  const vf = `crop=iw*${box.w}:ih*${box.h}:iw*${box.x}:ih*${box.y},scale=${S}:${S},format=rgb24`;
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', path, '-vf', vf, '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 1 << 20 }) as unknown as { stdout: Buffer };
  let px: number[][] = []; for (let i = 0; i + 2 < stdout.length; i += 3) px.push([stdout[i], stdout[i + 1], stdout[i + 2]]);
  if (mode === 'red') px = px.filter(([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return r === mx && mx > 60 && (mx - mn) / mx > 0.45 && g < r * 0.6; });
  if (px.length < 8) return [];
  // median colour (robust to stray pixels) + the darker/lighter cluster spread
  const med = (k: number) => px.map(p => p[k]).sort((a, b) => a - b)[Math.floor(px.length / 2)];
  const lum = (p: number[]) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
  const sorted = [...px].sort((a, b) => lum(a) - lum(b));
  const avg = (arr: number[][]) => [0, 1, 2].map(k => arr.reduce((s, p) => s + p[k], 0) / arr.length);
  const shadow = avg(sorted.slice(0, Math.floor(px.length * 0.2))), light = avg(sorted.slice(Math.floor(px.length * 0.8)));
  const hex = (c: number[]) => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  return [hex([med(0), med(1), med(2)]), hex(shadow), hex(light)];
}

export async function pieceRoutes(app: FastifyInstance, db: DB, dataDir: string) {
  seedPieces(db);
  const pathOf = (ref: string) => (db.prepare('SELECT work_path FROM asset WHERE source_ref LIKE ?').get(ref + '%') as { work_path?: string } | undefined)?.work_path;

  app.get('/api/characters/:id/pieces', async req => {
    const { id } = req.params as { id: string }; seedPieces(db);
    const rows = db.prepare('SELECT * FROM wardrobe_piece WHERE character_id = ? ORDER BY rowid').all(id) as Row[];
    for (const r of rows) {
      if (r.hex) continue;
      const p = pathOf(String(r.asset_ref)); if (!p) continue;
      const hex = await measure(p, JSON.parse(String(r.box)), String(r.mode)).catch(() => []);
      db.prepare('UPDATE wardrobe_piece SET hex = ? WHERE id = ?').run(JSON.stringify(hex), String(r.id)); r.hex = JSON.stringify(hex);
    }
    return { pieces: rows.map(r => ({ id: r.id, name: r.name, hex: JSON.parse(String(r.hex ?? '[]')), approved: !!r.approved_at, crop: `/api/pieces/${r.id}/crop` })) };
  });

  // the exact region the colour was measured from, so the eye can check it
  app.get('/api/pieces/:id/crop', async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = db.prepare('SELECT * FROM wardrobe_piece WHERE id = ?').get(id) as Row | undefined;
    const p = r && pathOf(String(r.asset_ref)); if (!r || !p) return reply.code(404).send({ what: 'مش موجود' });
    const dir = pjoin(dataDir, 'pieces'); await mkdirP(dir, { recursive: true });
    const out = pjoin(dir, `${id}.jpg`);
    if (!exists(out)) {
      const b = JSON.parse(String(r.box)); const pad = 0.6; // show a bit of context around the box
      const x = Math.max(0, b.x - b.w * pad), y = Math.max(0, b.y - b.h * pad), w = Math.min(1 - x, b.w * (1 + 2 * pad)), h = Math.min(1 - y, b.h * (1 + 2 * pad));
      await run('ffmpeg', ['-v', 'error', '-y', '-i', p, '-vf', `crop=iw*${w}:ih*${h}:iw*${x}:ih*${y},scale=360:-2`, '-q:v', '3', out]);
    }
    reply.type('image/jpeg'); const { createReadStream } = await import('node:fs'); return reply.send(createReadStream(out));
  });

  app.post('/api/pieces/:id/approve', async req => {
    const { id } = req.params as { id: string };
    db.prepare(`UPDATE wardrobe_piece SET approved_at = datetime('now') WHERE id = ?`).run(id);
    return { approved: true };
  });
}
