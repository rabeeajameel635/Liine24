// H2 pilot: takes (نسخ التوليد), the storyboard, «اعتمد» / «ارفض» on a take, and the gallery (المعرض).
// Every video ever attached to or received for a segment is a take. Takes are never deleted; choosing one as the
// segment's video leaves the others where they are. A decision is a row in the approval table (subject_type 'take').
// Test takes (test = 1) are made locally by scripts/make-test-take.ts: they show «تجربة» and never reach the gallery.
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { DB } from './db.ts';
import { resolvePrompt } from './refs.ts';

type Row = Record<string, unknown>;
export type TakeSource = 'inbox' | 'kit' | 'picker' | 'drop' | 'legacy';

/** Additive and idempotent: a take table plus a backfill of every video a segment ever had (current and in its versions). */
export function migrateTakes(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS take (
    id TEXT PRIMARY KEY,
    segment_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    n INTEGER NOT NULL,
    source TEXT NOT NULL,
    shot_code TEXT,
    test INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    UNIQUE (segment_id, asset_id)
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS take_asset ON take (asset_id)');
  try { db.exec('ALTER TABLE asset ADD COLUMN test INTEGER NOT NULL DEFAULT 0'); } catch { /* exists */ }
  const seen = db.prepare(`SELECT id AS segment_id, video_asset_id AS asset_id, updated_at AS at FROM segment WHERE video_asset_id IS NOT NULL
    UNION SELECT segment_id, json_extract(snapshot, '$.video_asset_id'), at FROM segment_version WHERE json_extract(snapshot, '$.video_asset_id') IS NOT NULL
    ORDER BY at`).all() as { segment_id: string; asset_id: string }[];
  for (const r of seen) {
    if (!db.prepare('SELECT 1 FROM segment WHERE id = ?').get(r.segment_id) || !db.prepare(`SELECT 1 FROM asset WHERE id = ? AND kind = 'video'`).get(r.asset_id)) continue;
    ensureTake(db, r.segment_id, r.asset_id, 'legacy');
  }
}

/** Adds the take once (same segment + same file = same take). Returns the take id. Never touches the asset or other takes. */
export function ensureTake(db: DB, segmentId: string, assetId: string, source: TakeSource, shotCode: string | null = null): string {
  const have = db.prepare('SELECT id FROM take WHERE segment_id = ? AND asset_id = ?').get(segmentId, assetId) as { id: string } | undefined;
  if (have) return have.id;
  const a = db.prepare('SELECT kind, test FROM asset WHERE id = ?').get(assetId) as { kind: string; test: number } | undefined;
  if (!a || a.kind !== 'video') return '';
  const n = ((db.prepare('SELECT max(n) AS n FROM take WHERE segment_id = ?').get(segmentId) as { n: number | null }).n ?? 0) + 1;
  const id = randomUUID();
  db.prepare('INSERT INTO take (id, segment_id, asset_id, n, source, shot_code, test) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, segmentId, assetId, n, source, shotCode, a.test ? 1 : 0);
  return id;
}

/** Shot codes of the timeline (H2, L1, R1a…) found as whole tokens in a file name or in its provenance. */
export function codesIn(db: DB, text: string): { code: string; segment_id: string }[] {
  const shots = db.prepare('SELECT code, segment_id FROM shot WHERE code IS NOT NULL AND segment_id IS NOT NULL').all() as { code: string; segment_id: string }[];
  const tokens = new Set(text.split(/[^A-Za-z0-9]+/).filter(Boolean).map(t => t.toUpperCase()));
  return shots.filter(s => tokens.has(s.code.toUpperCase()));
}
export const isTestName = (name: string) => /(^|[^A-Za-z0-9])TEST([^A-Za-z0-9]|$)/i.test(name) || name.includes('تجربة');

/** The Inbox: a video whose name or provenance carries a shot code becomes a new take of that shot's segment, and is checked.
 *  A name with TEST / «تجربة» marks a new file as a test (test = 1). Called by the watched folder after the kit-code link. */
export function linkInboxTake(db: DB, assetId: string, fileName: string, opts: { duplicate?: boolean } = {}) {
  const a = db.prepare('SELECT kind, provenance, locked FROM asset WHERE id = ?').get(assetId) as { kind: string; provenance: string; locked: number } | undefined;
  if (!a || a.kind !== 'video') return [];
  if (!opts.duplicate && !a.locked && isTestName(fileName)) db.prepare('UPDATE asset SET test = 1 WHERE id = ? AND locked = 0').run(assetId);
  const prov = JSON.parse(a.provenance || '{}') as Row;
  const provText = ['shot', 'shot_code', 'code', 'segment'].map(k => prov[k]).filter(v => typeof v === 'string').join(' ');
  const hits = codesIn(db, `${fileName} ${provText}`);
  const out: string[] = [];
  for (const h of hits) { const id = ensureTake(db, h.segment_id, assetId, 'inbox', h.code); if (id) out.push(id); }
  return out; // the watcher queues the check right after (queueQc), now that the take tells it which segment's bars to measure
}

/** The latest decision on a take, from the approval table: approve / reject / none. */
function decision(db: DB, takeId: string): { status: 'waiting' | 'approved' | 'rejected'; at: string | null } {
  const r = db.prepare(`SELECT stage, at FROM approval WHERE subject_type = 'take' AND subject_id = ? AND stage IN ('approve','reject') ORDER BY at DESC, rowid DESC LIMIT 1`).get(takeId) as { stage: string; at: string } | undefined;
  return r ? { status: r.stage === 'approve' ? 'approved' : 'rejected', at: r.at } : { status: 'waiting', at: null };
}

function shapeTake(db: DB, t: Row) {
  const a = db.prepare('SELECT id, thumb_path, work_path, duration, width, height, test FROM asset WHERE id = ?').get(String(t.asset_id)) as Row | undefined;
  const qc = db.prepare('SELECT score, status, reason FROM qc_run WHERE asset_id = ? ORDER BY created_at DESC LIMIT 1').get(String(t.asset_id)) as Row | undefined;
  const cur = db.prepare('SELECT 1 FROM segment WHERE id = ? AND video_asset_id = ?').get(String(t.segment_id), String(t.asset_id));
  const d = decision(db, String(t.id));
  return {
    id: t.id, n: t.n, segment_id: t.segment_id, asset_id: t.asset_id, source: t.source, shot_code: t.shot_code, created_at: t.created_at,
    test: !!(Number(t.test) || Number(a?.test)), status: d.status, decided_at: d.at, current: !!cur,
    thumb: a?.thumb_path ? `/media/${a.id}/thumb` : null, src: a?.work_path ? `/media/${a.id}/work` : null, duration: a?.duration ?? null,
    qc: qc ? { score: qc.score, status: qc.status, reason: qc.reason, checks: [] } : null
  };
}

const takesOf = (db: DB, segmentId: string) => (db.prepare('SELECT * FROM take WHERE segment_id = ? ORDER BY n').all(segmentId) as Row[]).map(t => shapeTake(db, t));

export async function takeRoutes(app: FastifyInstance, db: DB, tools: Record<string, { mode: string }>) {
  migrateTakes(db);

  app.get('/api/segments/:id/takes', async req => ({ takes: takesOf(db, (req.params as { id: string }).id) }));
  // e.g. /api/takes/by-code/H2 — the takes of the segment that holds shot H2
  app.get('/api/takes/by-code/:code', async (req, reply) => {
    const s = db.prepare('SELECT segment_id FROM shot WHERE upper(code) = upper(?) AND segment_id IS NOT NULL').get((req.params as { code: string }).code) as { segment_id?: string } | undefined;
    if (!s?.segment_id) return reply.code(404).send({ what: 'اللقطة مش موجودة' });
    return { segment_id: s.segment_id, takes: takesOf(db, s.segment_id) };
  });

  // «اعتمد» / «ارفض»: only from the button on the take. Recorded with the time; the asset itself (locked or not) is never touched.
  const decide = (stage: 'approve' | 'reject') => async (req: { params: unknown }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    const { id } = req.params as { id: string };
    if (!db.prepare('SELECT 1 FROM take WHERE id = ?').get(id)) return reply.code(404).send({ what: 'النسخة مش موجودة' });
    db.prepare(`INSERT INTO approval (id, subject_type, subject_id, stage, at) VALUES (?, 'take', ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'))
      ON CONFLICT (subject_type, subject_id, stage) DO UPDATE SET at = excluded.at`).run(randomUUID(), id, stage);
    return shapeTake(db, db.prepare('SELECT * FROM take WHERE id = ?').get(id) as Row);
  };
  app.post('/api/takes/:id/approve', decide('approve'));
  app.post('/api/takes/:id/reject', decide('reject'));

  // ستوري بورد: frames drawn from what already exists — each shot's @ references, the segment's extra pictures, and linked inspiration. No generation.
  app.get('/api/segments/:id/storyboard', async (req, reply) => {
    const { id } = req.params as { id: string };
    const g = db.prepare('SELECT * FROM segment WHERE id = ?').get(id) as Row | undefined;
    if (!g) return reply.code(404).send({ what: 'المقطع مش موجود' });
    const toolKey = String(g.tool), mode = tools[toolKey]?.mode ?? 'bridge';
    const shots = db.prepare('SELECT code, title, prompt FROM shot WHERE segment_id = ? ORDER BY start_s, idx').all(id) as { code: string; title: string; prompt: string | null }[];
    const thumbOf = (aid: string) => { const a = db.prepare('SELECT id, thumb_path, remote_url FROM asset WHERE id = ?').get(aid) as Row | undefined; return a ? (a.thumb_path ? `/media/${a.id}/thumb` : (a.remote_url as string | null)) : null; };
    const segRes = resolvePrompt(db, String(g.prompt_partial || ''), toolKey, mode);
    const segPics = segRes.refs.flatMap(r => r.images.map(im => ({ asset: im.id, thumb: im.thumb, handle: r.handle })));
    const used = new Set<string>();
    type Frame = { kind: 'shot' | 'ref' | 'inspo'; code: string | null; title: string | null; thumb: string | null; handles: string[]; asset_id: string | null; temp: boolean };
    const frames: Frame[] = [];
    for (const sh of shots) {
      const res = resolvePrompt(db, sh.prompt ?? '', toolKey, mode);
      const pics = res.refs.flatMap(r => r.images.map(im => ({ asset: im.id, thumb: im.thumb, handle: r.handle })));
      // the frame shows the place first (the shot is set there), then pictures and props, the character last
      const FRAME_ORDER: Record<string, number> = { place: 0, image: 1, prop: 2, video: 3, character: 4, audio: 5 };
      const order = [...res.refs].sort((a, b) => (FRAME_ORDER[a.kind] ?? 9) - (FRAME_ORDER[b.kind] ?? 9));
      const lead = order.flatMap(r => r.images.map(im => ({ asset: im.id, thumb: im.thumb }))).find(p => p.thumb) ?? segPics.find(p => p.thumb) ?? null;
      pics.forEach(p => used.add(p.asset)); if (lead) used.add(lead.asset);
      frames.push({ kind: 'shot', code: sh.code, title: sh.title, thumb: lead?.thumb ?? null, handles: res.refs.map(r => r.handle), asset_id: lead?.asset ?? null, temp: !lead });
    }
    const extra = [...segPics.map(p => p.asset), ...(JSON.parse(String(g.refs || '[]')) as string[])];
    for (const aid of extra) { if (used.has(aid)) continue; used.add(aid); const t = thumbOf(aid); if (t) frames.push({ kind: 'ref', code: null, title: null, thumb: t, handles: [], asset_id: aid, temp: false }); }
    const inspo = db.prepare(`SELECT a.id, a.label, a.thumb_path, a.remote_url FROM inspo_link l JOIN asset a ON a.id = l.asset_id WHERE l.segment_id = ? ORDER BY l.created_at`).all(id) as Row[];
    for (const a of inspo) frames.push({ kind: 'inspo', code: null, title: a.label as string, thumb: a.thumb_path ? `/media/${a.id}/thumb` : (a.remote_url as string | null), handles: [], asset_id: String(a.id), temp: false });
    return { frames };
  });

  // المعرض: approved, non-test takes only, in song order. Internal page: nothing is published or shared.
  app.get('/api/gallery', async () => {
    const rows = db.prepare(`SELECT t.*, s.start_s, s.end_s, s.label AS seg_label, s.group_label, s.idx AS seg_idx, s.song_id, g.title AS song_title
      FROM take t JOIN segment s ON s.id = t.segment_id JOIN song g ON g.id = s.song_id JOIN asset a ON a.id = t.asset_id
      WHERE t.test = 0 AND a.test = 0 ORDER BY s.start_s, t.n`).all() as Row[];
    // for the presentation: the moment on the song (the shot's start when the take names a shot), the sung line at that moment,
    // and the scene's name (the shot title up to its first comma). Read-only.
    const cuesOf = new Map<string, { s: number; e: number; t: string }[]>();
    const cues = (songId: string) => { if (!cuesOf.has(songId)) { const s = db.prepare('SELECT srt FROM song WHERE id = ?').get(songId) as { srt?: string } | undefined; cuesOf.set(songId, JSON.parse(String(s?.srt || '[]'))); } return cuesOf.get(songId)!; };
    const items = rows.map(r => {
      const shot = (r.shot_code ? db.prepare('SELECT title, start_s FROM shot WHERE segment_id = ? AND upper(code) = upper(?)').get(String(r.segment_id), String(r.shot_code))
        : db.prepare('SELECT title, start_s FROM shot WHERE segment_id = ? ORDER BY start_s, idx LIMIT 1').get(String(r.segment_id))) as { title: string; start_s: number } | undefined;
      const at = r.shot_code && shot ? Number(shot.start_s) : Number(r.start_s), end = Number(r.end_s);
      const cs = cues(String(r.song_id));
      const cue = cs.find(c => c.s <= at + 0.3 && c.e > at) ?? cs.find(c => c.s >= at && c.s < end) ?? null;
      return { ...shapeTake(db, r), start_s: r.start_s, end_s: r.end_s, seg_label: r.seg_label, group_label: r.group_label, seg_idx: r.seg_idx, song_id: r.song_id, song_title: r.song_title,
        at, line: cue?.t ?? null, scene: shot?.title ? shot.title.split('،')[0].replace(/\([^)]*\)/g, ' ').replace(/["«][^"»]*["»]/g, ' ').replace(/\s+/g, ' ').trim() || null : null };
    }).filter(t => t.status === 'approved' && !t.test);
    return { items };
  });
}
