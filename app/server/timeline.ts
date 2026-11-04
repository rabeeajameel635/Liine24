// Shot timeline → segments on whole bars. Shots keep their written times and status; segments are built from
// shot starts snapped to the bar grid, never crossing a song section, ~4–8 bars each.
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { DB } from './db.ts';
import { barLength, snapToBar, type Cue } from './audio.ts';

export type TShot = { n: number; code: string; from: number; to: number; title: string; status: 'approved' | 'candidate' | 'redo' | 'pending'; kind?: string; note?: string; source: string };
export type Timeline = { source: string; duration: number; sections: { from: number; to: number; name: string }[]; shots: TShot[];
  conflicts: { n: number; title: string; proposal: string; shots: string[] }[]; open_questions?: { shot: string; items: string[] }[] };

const COLS: [string, string][] = [
  ['shot', 'song_id TEXT'], ['shot', 'code TEXT'], ['shot', 'end_s REAL'], ['shot', 'title TEXT'], ['shot', 'source TEXT'],
  ['shot', 'kind TEXT'], ['shot', 'note TEXT'], ['shot', 'segment_id TEXT'], ['shot', 'conflicts TEXT'], ['shot', 'questions TEXT']
];
export function migrateTimeline(db: DB) {
  for (const [t, c] of COLS) { try { db.exec(`ALTER TABLE ${t} ADD COLUMN ${c}`); } catch { /* exists */ } }
  db.exec(`CREATE TABLE IF NOT EXISTS conflict (id TEXT PRIMARY KEY, song_id TEXT NOT NULL, n INTEGER NOT NULL, title TEXT NOT NULL, proposal TEXT,
    shots TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'open', decision TEXT, decided_at TEXT)`);
}

/** Replace the song's segments by ones built from the timeline. Refuses when any segment already has work in it. */
export function applyTimeline(db: DB, songId: string, tl: Timeline, opts: { beatOffset?: number } = {}): { segments: number; shots: number } {
  const song = db.prepare('SELECT * FROM song WHERE id = ?').get(songId) as Record<string, unknown>;
  const worked = db.prepare(`SELECT count(*) AS n FROM segment WHERE song_id = ? AND (status <> 'idea' OR refs <> '[]' OR prompt_partial <> '' OR video_asset_id IS NOT NULL)`).get(songId) as { n: number };
  if (worked.n) throw new Error('فيه مقاطع اتشغل عليها');
  const bpm = Number(song.bpm), off = opts.beatOffset ?? Number(song.beat_offset ?? 0), L = barLength(bpm);
  const dur = tl.duration || Number(song.duration);
  const snap = (t: number) => Math.min(dur, Math.max(0, snapToBar(t, bpm, off)));
  // anything before the first section belongs to it (e.g. H1 at 0:00 before the intro's first line at 0:01)
  const sectionOf = (t: number) => Math.max(0, tl.sections.findIndex((s, i) => t >= (i === 0 ? -1 : s.from - 0.6) && t < (tl.sections[i + 1]?.from ?? dur + 1) - 0.6));

  // group shots into segments
  type G = { shots: TShot[]; start: number };
  const groups: G[] = [];
  for (const sh of [...tl.shots].sort((a, b) => a.from - b.from)) {
    const g = groups[groups.length - 1];
    const s = snap(sh.from);
    const sameSection = g && sectionOf(g.shots[0].from) === sectionOf(sh.from);
    const curLen = g ? s - g.start : 0;
    const wouldBe = g ? snap(sh.to) - g.start : 0;
    if (!g || !sameSection || curLen >= 4 * L - 0.01 || wouldBe > 8 * L + 0.01) {
      if (g && s <= g.start + 0.01) { g.shots.push(sh); continue; } // snapped onto the same bar: keep together
      groups.push({ shots: [sh], start: groups.length ? s : 0 });
    } else g.shots.push(sh);
  }
  // merge a short trailing group into the previous one when they share a section
  for (let i = groups.length - 1; i > 0; i--) {
    const end = i + 1 < groups.length ? groups[i + 1].start : dur;
    if (end - groups[i].start < 2 * L && sectionOf(groups[i].shots[0].from) === sectionOf(groups[i - 1].shots[0].from)) { groups[i - 1].shots.push(...groups[i].shots); groups.splice(i, 1); }
  }

  const cues = JSON.parse(String(song.srt ?? '[]')) as Cue[];
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM segment WHERE song_id = ?').run(songId);
    db.prepare('DELETE FROM shot WHERE song_id = ?').run(songId);
    db.prepare('DELETE FROM conflict WHERE song_id = ?').run(songId);
    const conflictsOf = (code: string) => tl.conflicts.filter(c => c.shots.includes(code)).map(c => c.n);
    const insSeg = db.prepare(`INSERT INTO segment (id, song_id, idx, start_s, end_s, label, group_label, lyric, direction, tool, draft) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'higgsfield-kling', 0)`);
    const insShot = db.prepare(`INSERT INTO shot (id, project_id, idx, label, start_s, end_s, status, song_id, code, title, source, kind, note, segment_id, conflicts, questions)
      VALUES (?, 'iatw', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    groups.forEach((g, i) => {
      const start = g.start, end = i + 1 < groups.length ? groups[i + 1].start : dur;
      const id = randomUUID();
      const codes = g.shots.map(s => s.code);
      const label = codes.length > 1 ? `${codes[0]}–${codes[codes.length - 1]}` : codes[0];
      const sec = tl.sections[sectionOf(g.shots[0].from)]?.name ?? '';
      insSeg.run(id, songId, i + 1, +start.toFixed(3), +end.toFixed(3), label, sec, cues.filter(c => c.s < end && c.e > start).map(c => c.t).join(' / '),
        g.shots.map(s => `${s.code} · ${s.title}`).join('\n'));
      for (const s of g.shots) insShot.run(randomUUID(), s.n, s.code, s.from, s.to, s.status, songId, s.code, s.title, s.source, s.kind ?? null, s.note ?? null, id,
        JSON.stringify(conflictsOf(s.code)), JSON.stringify(tl.open_questions?.find(q => q.shot === s.code)?.items ?? []));
    });
    for (const c of tl.conflicts) db.prepare('INSERT INTO conflict (id, song_id, n, title, proposal, shots) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), songId, c.n, c.title, c.proposal, JSON.stringify(c.shots));
    db.prepare(`UPDATE song SET duration = ?, beat_offset = ?, sections = ?, plan_note = ? WHERE id = ?`).run(dur, off,
      JSON.stringify(tl.sections.map(s => ({ name: s.name, start: s.from }))), `الربط من ${tl.source}. حدود المقاطع على شبكة ${bpm} BPM مؤقتة لحد ما ملف الصوت يتقاس.`, songId);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { segments: groups.length, shots: tl.shots.length };
}

export async function timelineRoutes(app: FastifyInstance, db: DB) {
  migrateTimeline(db);
  app.get('/api/songs/:id/shots', async req => {
    const { id } = req.params as { id: string };
    const shots = (db.prepare('SELECT * FROM shot WHERE song_id = ? ORDER BY start_s').all(id) as Record<string, unknown>[]).map(s => ({ ...s, conflicts: JSON.parse(String(s.conflicts || '[]')), questions: JSON.parse(String(s.questions || '[]')) }));
    const conflicts = (db.prepare('SELECT * FROM conflict WHERE song_id = ? ORDER BY n').all(id) as Record<string, unknown>[]).map(c => ({ ...c, shots: JSON.parse(String(c.shots)) }));
    return { shots, conflicts };
  });
  // record the user's decision on a conflict (only through the UI, after the user decides)
  app.post('/api/conflicts/:id/decide', async req => {
    const { id } = req.params as { id: string }; const { decision } = req.body as { decision: string };
    db.prepare(`UPDATE conflict SET status = 'decided', decision = ?, decided_at = datetime('now') WHERE id = ?`).run(decision, id);
    return { ok: true };
  });
}

/** Seed: link the v44 timeline to I Am The World the first time, replacing the tentative v7 cut if nothing was worked on. */
export async function seedTimelineV44(db: DB, path: string) {
  migrateTimeline(db);
  if (!db.prepare(`SELECT 1 FROM song WHERE id = 'iatw-v44'`).get()) return;
  if (db.prepare(`SELECT 1 FROM shot WHERE song_id = 'iatw-v44'`).get()) return;
  const tl = JSON.parse(await readFile(path, 'utf8').catch(() => 'null')) as Timeline | null; if (!tl) return;
  try { applyTimeline(db, 'iatw-v44', tl, { beatOffset: 1.0 }); } catch { /* work exists: leave it */ }
}
