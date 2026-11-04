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
