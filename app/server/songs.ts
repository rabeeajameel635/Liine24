// Songs and the segment board. Segments sit on whole bars; every change is saved immediately with a version for undo.
import type { FastifyInstance } from 'fastify';
import { randomUUID, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { join, extname } from 'node:path';
import type { DB } from './db.ts';
import { importFile } from './media.ts';
import { decode, peaks, tempo, beatOffset, parseSrt, sectionsFromCues, makeGrid, trackBeats, type Cue } from './audio.ts';

const run = promisify(execFile);
type Row = Record<string, unknown>;

/** Generators. mode: mcp = sent straight through the official MCP once connected; bridge = numbered kit + prompt + audio clip. */
export const TOOLS: Record<string, { name: string; via: string; mode: 'mcp' | 'bridge'; url: string }> = {
  'wan': { name: 'Wan 3.0', via: 'Wan', mode: 'bridge', url: 'https://wan.video' },
  'higgsfield-kling': { name: 'Kling', via: 'Higgsfield', mode: 'mcp', url: 'https://higgsfield.ai' },
  'higgsfield-minimax': { name: 'MiniMax', via: 'Higgsfield', mode: 'mcp', url: 'https://higgsfield.ai' },
  'higgsfield-seedance': { name: 'Seedance', via: 'Higgsfield', mode: 'mcp', url: 'https://higgsfield.ai' },
  'runway': { name: 'Runway', via: 'Runway', mode: 'mcp', url: 'https://app.runwayml.com' },
  'grok': { name: 'Grok Imagine', via: 'Grok', mode: 'bridge', url: 'https://grok.com/imagine' },
  'flow': { name: 'Veo', via: 'Google Flow', mode: 'bridge', url: 'https://labs.google/fx/tools/flow' },
  'stills': { name: 'صور + مونتاج', via: 'المونتاج', mode: 'bridge', url: '' }
};
const FIELDS = ['lyric', 'status', 'direction', 'prompt_partial', 'tool', 'backup', 'refs', 'video_asset_id', 'notes', 'start_s', 'end_s', 'label', 'group_label'] as const;
const STATUSES = ['idea', 'ready', 'generating', 'done', 'editing'];

export async function songRoutes(app: FastifyInstance, db: DB, dataDir: string) {
  const peaksDir = join(dataDir, 'peaks'); await mkdir(peaksDir, { recursive: true });
  const song = (id: string) => db.prepare('SELECT * FROM song WHERE id = ?').get(id) as Row | undefined;
  const segs = (songId: string) => db.prepare('SELECT * FROM segment WHERE song_id = ? ORDER BY start_s').all(songId) as Row[];
  const shapeSeg = (r: Row) => ({ ...r, refs: JSON.parse(String(r.refs || '[]')), backup: JSON.parse(String(r.backup || '{}')) });
  const audioPath = (s: Row) => s.audio_asset_id ? (db.prepare('SELECT work_path FROM asset WHERE id = ?').get(String(s.audio_asset_id)) as { work_path?: string } | undefined)?.work_path : undefined;

  const snapshot = (id: string) => { const r = db.prepare('SELECT * FROM segment WHERE id = ?').get(id) as Row; db.prepare('INSERT INTO segment_version (segment_id, snapshot) VALUES (?, ?)').run(id, JSON.stringify(r)); };
  const reindex = (songId: string) => segs(songId).forEach((r, i) => db.prepare('UPDATE segment SET idx = ? WHERE id = ?').run(i + 1, String(r.id)));

  /** Cut [0,duration) into segments of ~seconds, each a whole number of bars. */
  function cut(s: Row, seconds: number) {
    const grid = makeGrid(s), L = grid.bar;
    const bars = Math.max(1, Math.round(seconds / L)), dur = Number(s.duration);
    const cues = JSON.parse(String(s.srt ?? '[]')) as Cue[];
    const out: { start: number; end: number }[] = []; let t = 0;
    for (let k = 1; t < dur - 0.01; k++) { const next = Math.min(dur, grid.at(k * bars)); out.push({ start: +t.toFixed(3), end: +next.toFixed(3) }); t = next; }
    if (out.length > 1 && out[out.length - 1].end - out[out.length - 1].start < L) { out[out.length - 2].end = out[out.length - 1].end; out.pop(); }
    db.prepare('DELETE FROM segment WHERE song_id = ?').run(String(s.id));
    const ins = db.prepare('INSERT INTO segment (id, song_id, idx, start_s, end_s, lyric) VALUES (?,?,?,?,?,?)');
    out.forEach((g, i) => ins.run(randomUUID(), String(s.id), i + 1, g.start, g.end, cues.filter(c => c.s < g.end && c.e > g.start).map(c => c.t).join(' / ')));
    db.prepare('UPDATE song SET segment_seconds = ? WHERE id = ?').run(seconds, String(s.id));
  }

  async function analyze(songId: string) {
    const s = song(songId)!; const p = audioPath(s); if (!p) return;
    const x = await decode(p); const dur = x.length / 11025;
    const cands = tempo(x).map(c => ({ ...c, offset: beatOffset(x, c.bpm) })); const bpm = Number(s.bpm) || cands[0].bpm;
    // the tracker follows the real beats (drift included); its whole-song mean leads the candidates
    const beats = trackBeats(x, bpm < 100 ? bpm * 2 : bpm, bpm < 100 ? 8 : 4);
    cands.unshift({ bpm: beats.mean, conf: 1, offset: beats.downbeats[0], tracked: true } as typeof cands[number]);
    db.prepare('UPDATE song SET downbeats = ?, tempo_local = ? WHERE id = ?').run(JSON.stringify(beats.downbeats), JSON.stringify(beats.local), songId);
    await writeFile(join(peaksDir, songId + '.json'), JSON.stringify(peaks(x)));
    const cues = JSON.parse(String(s.srt ?? '[]')) as Cue[];
    db.prepare(`UPDATE song SET duration = ?, bpm_candidates = ?, bpm = COALESCE(bpm, ?), bpm_source = COALESCE(bpm_source, 'measured'), beat_offset = COALESCE(beat_offset, ?),
      sections = CASE WHEN sections IS NULL OR sections = '[]' THEN ? ELSE sections END WHERE id = ?`).run(
      +dur.toFixed(3), JSON.stringify(cands), bpm, beatOffset(x, bpm), JSON.stringify(sectionsFromCues(cues, dur)), songId);
  }

  app.get('/api/songs', async () => {
    const rows = db.prepare('SELECT s.*, p.title AS project FROM song s JOIN project p ON p.id = s.project_id ORDER BY s.created_at').all() as Row[];
    return { songs: rows.map(s => {
      const list = segs(String(s.id));
      const done = list.filter(g => g.status === 'done' || g.status === 'editing').length;
      const resume = list.find(g => g.status !== 'done' && g.status !== 'editing');
      return { id: s.id, title: s.title, bpm: s.bpm, bpm_approved: !!s.bpm_approved, duration: s.duration, poster: s.poster_asset_id ? `/media/${s.poster_asset_id}/thumb` : null,
        total: list.length, done, resume: resume?.id ?? null, has_audio: !!s.audio_asset_id };
    }) };
  });

  app.get('/api/songs/:id', async (req, reply) => {
    const { id } = req.params as { id: string }; const s = song(id);
    if (!s) return reply.code(404).send({ what: 'الأغنية مش موجودة', fix: 'ارجع للرئيسية واختار أغنية.' });
    const pk = join(peaksDir, id + '.json');
    return {
      ...s, sections: JSON.parse(String(s.sections || '[]')), srt: JSON.parse(String(s.srt || '[]')), bpm_candidates: JSON.parse(String(s.bpm_candidates || '[]')),
      bar: makeGrid(s).bar, tempo_local: JSON.parse(String(s.tempo_local || '[]')), grid_measured: makeGrid(s).measured, peaks: existsSync(pk) ? JSON.parse(await readFile(pk, 'utf8')) : null,
      poster: s.poster_asset_id ? `/media/${s.poster_asset_id}/work` : null, audio: s.audio_asset_id ? `/api/songs/${id}/audio` : null,
      segments: segs(id).map(shapeSeg), tools: TOOLS, master_missing: !s.master_asset_id
    };
  });

  app.get('/api/songs/:id/audio', async (req, reply) => {
    const s = song((req.params as { id: string }).id); const p = s && audioPath(s);
    if (!p) return reply.code(404).send({ what: 'ملف الأغنية مش موجود', fix: 'اسحب الملف على صفحة الأغنية.' });
    return reply.redirect(`/media/${s!.audio_asset_id}/work`);
  });

  // new song: audio (+ optional SRT) → analysed, cut into ~15 s segments on whole bars
  app.post('/api/songs', async req => {
    const tmp = join(dataDir, 'tmp'); await mkdir(tmp, { recursive: true });
    let audio: string | null = null, audioName = '', srt = '', title = '';
    for await (const part of req.parts()) {
      if (part.type === 'field') { if (part.fieldname === 'title') title = String(part.value); continue; }
      const dst = join(tmp, randomUUID() + extname(part.filename));
      await pipeline(part.file, createWriteStream(dst));
      if (/\.srt$/i.test(part.filename)) { srt = await readFile(dst, 'utf8'); await rm(dst); } else { audio = dst; audioName = part.filename; }
    }
    if (!audio) return { what: 'مفيش ملف صوت', fix: 'اسحب ملف الأغنية (mp3 / wav / flac).' };
    const a = await importFile(db, dataDir, audio, { name: audioName, source: 'drop', projectId: 'iatw' }); await rm(audio, { force: true });
    const id = randomUUID();
    db.prepare(`INSERT INTO song (id, project_id, title, audio_asset_id, srt, created_at) VALUES (?, 'iatw', ?, ?, ?, datetime('now'))`).run(id, title || audioName.replace(/\.[^.]+$/, ''), a.id, JSON.stringify(srt ? parseSrt(srt) : []));
    await analyze(id); cut(song(id)!, 15);
    return { id };
  });

  // attach / replace the audio of an existing song (e.g. the FINAL flac); the measured BPM is a candidate until approved
  app.post('/api/songs/:id/audio', async req => {
    const { id } = req.params as { id: string };
    const tmp = join(dataDir, 'tmp'); await mkdir(tmp, { recursive: true });
    for await (const part of req.files()) {
      const dst = join(tmp, randomUUID() + extname(part.filename)); await pipeline(part.file, createWriteStream(dst));
      const a = await importFile(db, dataDir, dst, { name: part.filename, source: 'drop', projectId: 'iatw' }); await rm(dst, { force: true });
      db.prepare('UPDATE song SET audio_asset_id = ? WHERE id = ?').run(a.id, id);
    }
    await analyze(id); return { ok: true };
  });

  app.patch('/api/songs/:id', async req => {
    const { id } = req.params as { id: string }; const b = req.body as Row;
    if (b.bpm != null) db.prepare(`UPDATE song SET bpm = ?, bpm_source = 'manual', bpm_approved = 0 WHERE id = ?`).run(Number(b.bpm), id);
    if (b.bpm_approved) db.prepare('UPDATE song SET bpm_approved = 1 WHERE id = ?').run(id);
    if (b.beat_offset != null) db.prepare('UPDATE song SET beat_offset = ? WHERE id = ?').run(Number(b.beat_offset), id);
    return { ok: true };
  });

  // re-cut: only while nothing has started, so no work is lost
  app.post('/api/songs/:id/split', async (req, reply) => {
    const { id } = req.params as { id: string }; const { seconds } = req.body as { seconds: number };
    if (segs(id).some(g => g.status !== 'idea' || JSON.parse(String(g.refs)).length || g.prompt_partial)) return reply.code(409).send({ what: 'فيه مقاطع اتشغل عليها', fix: 'عدّل الحدود من عرض الشريط، أو ادمج وقسّم مقطع مقطع.' });
    cut(song(id)!, Number(seconds) || 15); return { ok: true };
  });

  app.patch('/api/segments/:id', async (req, reply) => {
    const { id } = req.params as { id: string }; const b = req.body as Row;
    const cur = db.prepare('SELECT * FROM segment WHERE id = ?').get(id) as Row | undefined;
    if (!cur) return reply.code(404).send({ what: 'المقطع مش موجود' });
    if (b.status === 'done' && !(b.video_asset_id ?? cur.video_asset_id)) return reply.code(409).send({ what: 'مفيش فيديو في المقطع', fix: 'حط الفيديو في الخانة الأول.' });
    if (b.status && !STATUSES.includes(String(b.status))) return reply.code(400).send({ what: 'حالة مش معروفة' });
    // keep one version per burst of typing: snapshot only if the last version is older than 20 s
    const last = db.prepare(`SELECT at FROM segment_version WHERE segment_id = ? ORDER BY id DESC LIMIT 1`).get(id) as { at: string } | undefined;
    if (!last || Date.now() - Date.parse(last.at + 'Z') > 20000 || b.status || b.refs || b.video_asset_id) snapshot(id);
    const set: string[] = [], args: (string | number | null)[] = [];
    for (const f of FIELDS) if (f in b) { set.push(`${f} = ?`); const v = b[f]; args.push(v == null ? null : typeof v === 'object' ? JSON.stringify(v) : (v as string | number)); }
    if (!set.length) return { ok: true };
    db.prepare(`UPDATE segment SET ${set.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...args, id);
    if ('prompt_partial' in b || 'refs' in b || 'direction' in b) db.prepare('UPDATE segment SET draft = 0 WHERE id = ?').run(id);
    if (b.status === 'done') db.prepare(`INSERT OR IGNORE INTO approval (id, subject_type, subject_id, stage) VALUES (?, 'segment', ?, 'done')`).run(randomUUID(), id);
    return shapeSeg(db.prepare('SELECT * FROM segment WHERE id = ?').get(id) as Row);
  });

  app.get('/api/segments/:id/versions', async req => ({ versions: db.prepare('SELECT id, at FROM segment_version WHERE segment_id = ? ORDER BY id DESC LIMIT 50').all((req.params as { id: string }).id) }));
  app.post('/api/segments/:id/undo', async (req, reply) => {
    const { id } = req.params as { id: string }; const { version } = (req.body ?? {}) as { version?: number };
    const v = (version ? db.prepare('SELECT * FROM segment_version WHERE id = ? AND segment_id = ?').get(version, id) : db.prepare('SELECT * FROM segment_version WHERE segment_id = ? ORDER BY id DESC LIMIT 1').get(id)) as { id: number; snapshot: string } | undefined;
    if (!v) return reply.code(409).send({ what: 'مفيش نسخة أقدم' });
    const snap = JSON.parse(v.snapshot) as Row;
    db.prepare(`UPDATE segment SET ${FIELDS.map(f => `${f} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...FIELDS.map(f => (snap[f] ?? null) as string | number | null), id);
    db.prepare('DELETE FROM segment_version WHERE segment_id = ? AND id >= ?').run(id, v.id);
    return shapeSeg(db.prepare('SELECT * FROM segment WHERE id = ?').get(id) as Row);
  });

  // move a boundary: snaps to the bar grid and moves the neighbour with it
  app.post('/api/segments/:id/edge', async (req, reply) => {
    const { id } = req.params as { id: string }; const { side, t } = req.body as { side: 'start' | 'end'; t: number };
    const g = db.prepare('SELECT * FROM segment WHERE id = ?').get(id) as Row; const s = song(String(g.song_id))!;
    const list = segs(String(s.id)), i = list.findIndex(x => x.id === id);
    const grid = makeGrid(s), L = grid.bar, snapped = grid.snap(t);
    const lo = side === 'start' ? (i > 0 ? Number(list[i - 1].start_s) + L : 0) : Number(g.start_s) + L;
    const hi = side === 'start' ? Number(g.end_s) - L : (i < list.length - 1 ? Number(list[i + 1].end_s) - L : Number(s.duration));
    const v = Math.min(hi, Math.max(lo, snapped));
    if (side === 'start' && i === 0) return reply.code(409).send({ what: 'أول مقطع بيبدأ من الصفر' });
    snapshot(id);
    if (side === 'start') { db.prepare('UPDATE segment SET start_s = ? WHERE id = ?').run(v, id); db.prepare('UPDATE segment SET end_s = ? WHERE id = ?').run(v, String(list[i - 1].id)); }
    else { db.prepare('UPDATE segment SET end_s = ? WHERE id = ?').run(v, id); if (i < list.length - 1) db.prepare('UPDATE segment SET start_s = ? WHERE id = ?').run(v, String(list[i + 1].id)); }
    return { t: v };
  });

  app.post('/api/segments/:id/split', async (req, reply) => {
    const { id } = req.params as { id: string };
    const g = db.prepare('SELECT * FROM segment WHERE id = ?').get(id) as Row; const s = song(String(g.song_id))!;
    const mid = makeGrid(s).snap((Number(g.start_s) + Number(g.end_s)) / 2);
    if (mid <= Number(g.start_s) + 0.5 || mid >= Number(g.end_s) - 0.5) return reply.code(409).send({ what: 'المقطع أقصر من إنه يتقسم على البار' });
    snapshot(id); db.prepare('UPDATE segment SET end_s = ? WHERE id = ?').run(mid, id);
    db.prepare(`INSERT INTO segment (id, song_id, idx, start_s, end_s, lyric, tool) VALUES (?,?,?,?,?,?,?)`).run(randomUUID(), String(s.id), 0, mid, Number(g.end_s), String(g.lyric), String(g.tool));
    reindex(String(s.id)); return { ok: true };
  });

  app.post('/api/segments/:id/merge', async (req, reply) => {
    const { id } = req.params as { id: string };
    const g = db.prepare('SELECT * FROM segment WHERE id = ?').get(id) as Row; const list = segs(String(g.song_id)); const i = list.findIndex(x => x.id === id);
    const n = list[i + 1]; if (!n) return reply.code(409).send({ what: 'ده آخر مقطع' });
    if (n.status !== 'idea' || n.video_asset_id) return reply.code(409).send({ what: 'المقطع اللي بعده اتشغل عليه', fix: 'ادمج من المقطع اللي بعده لو حابب.' });
    snapshot(id); db.prepare('UPDATE segment SET end_s = ?, lyric = ? WHERE id = ?').run(Number(n.end_s), [g.lyric, n.lyric].filter(Boolean).join(' / '), id);
    db.prepare('DELETE FROM segment WHERE id = ?').run(String(n.id)); reindex(String(g.song_id)); return { ok: true };
  });

  // «جهّز للتوليد»: MCP tools wait for the connection step; bridge tools get one numbered kit (images + prompt + audio clip)
  app.post('/api/segments/:id/prepare', async (req, reply) => {
    const { id } = req.params as { id: string }; const { prompt, which } = req.body as { prompt: string; which?: 'primary' | 'backup' };
    const g = db.prepare('SELECT * FROM segment WHERE id = ?').get(id) as Row; const s = song(String(g.song_id))!;
    const toolKey = which === 'backup' ? (JSON.parse(String(g.backup || '{}')).tool ?? g.tool) : g.tool; const tool = TOOLS[String(toolKey)];
    if (!tool) return reply.code(400).send({ what: 'أداة مش معروفة' });
    const open = db.prepare(`SELECT c.n, c.title FROM conflict c, shot s WHERE s.segment_id = ? AND c.song_id = s.song_id AND c.status = 'open' AND EXISTS (SELECT 1 FROM json_each(s.conflicts) j WHERE j.value = c.n)`).all(id) as { n: number; title: string }[];
    const blockedShot = db.prepare(`SELECT code, blocked FROM shot WHERE segment_id = ? AND blocked IS NOT NULL`).get(id) as { code: string; blocked: string } | undefined;
    if (blockedShot) return reply.code(409).send({ what: `${blockedShot.code} مقفولة: ${blockedShot.blocked}`, fix: 'ابعت الأصول الناقصة، وبعدها القفل يتفك.' });
    const nums = [...new Set(open.map(o => o.n))];
    if (nums.length) return reply.code(409).send({ what: `فيه ${nums.length === 1 ? 'تعارض' : `${nums.length} تعارضات`} مستني قرارك (${nums.map(n => '#' + n).join('، ')})`, fix: 'قرّر في التعارض الأول. المقطع ده مش هيتولّد قبلها.' });
    if (tool.mode === 'mcp') {
      const conn = db.prepare('SELECT status FROM connection WHERE id = ?').get(tool.via.toLowerCase()) as { status?: string } | undefined;
      return reply.code(409).send(conn?.status === 'connected'
        ? { what: `${tool.via} متوصل، والإرسال المباشر بييجي في الخطوة الجاية`, fix: 'لحد ساعتها جهّز البديلة أو استخدم جسر.' }
        : { what: `${tool.via} مش متوصل لسه`, fix: 'من «الاتصالات» دوس «اختبر الاتصال» وسجّل دخول بحسابك (على الماك).' });
    }
    const code = String(g.kit_code || randomBytes(3).toString('hex'));
    const slug = String(s.title).replace(/[^A-Za-z0-9]+/g, '').slice(0, 10) || 'SONG';
    const name = `${slug}_${String(g.idx).padStart(2, '0')}_${code}`;
    const dir = join(dataDir, 'kits', name); await rm(dir, { recursive: true, force: true }); await mkdir(dir, { recursive: true });
    const refs = JSON.parse(String(g.refs || '[]')) as string[];
    const blocked = refs.map(r => db.prepare('SELECT label FROM asset WHERE id = ? AND no_generation = 1').get(r) as { label?: string } | undefined).filter(Boolean);
    if (blocked.length) return reply.code(409).send({ what: `${blocked.map(b => b!.label).join('، ')} ممنوع كمرجع توليد`, fix: 'شيله من خانات الصور، أو استخدم نسخة من غير المشكلة.' });
    for (const [n, aid] of refs.entries()) {
      const a = db.prepare('SELECT work_path, label FROM asset WHERE id = ?').get(aid) as { work_path?: string; label?: string } | undefined;
      if (a?.work_path) await copyFile(a.work_path, join(dir, `${String(n + 1).padStart(2, '0')}${extname(a.work_path)}`));
    }
    await writeFile(join(dir, 'prompt.txt'), prompt);
    const ap = audioPath(s);
    if (ap) await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(g.start_s), '-to', String(g.end_s), '-i', ap, '-c:a', 'aac', '-b:a', '192k', join(dir, 'audio.m4a')]);
    await writeFile(join(dir, 'README.txt'), `${s.title} — مقطع ${g.idx}\nالأداة: ${tool.name} (${tool.via})\nالصور بالترتيب: ${refs.length}\nسمّي الفيديو اللي يطلع بأي اسم فيه ${name} وحطه في فولدر Inbox، وهيترتبط بالمقطع لوحده.\n`);
    await run('zip', ['-qrj', dir + '.zip', dir]).catch(() => {});
    db.prepare(`UPDATE segment SET kit_code = ?, kit_path = ?, status = CASE WHEN status IN ('idea','ready') THEN 'generating' ELSE status END, updated_at = datetime('now') WHERE id = ?`).run(code, dir, id);
    return { kit: name, zip: existsSync(dir + '.zip') ? `/api/kits/${name}.zip` : null, files: refs.length, audio: !!ap, open: tool.url, mode: tool.mode };
  });

  app.get('/api/kits/:name', async (req, reply) => {
    const f = join(dataDir, 'kits', (req.params as { name: string }).name.replace(/[^A-Za-z0-9_.-]/g, ''));
    if (!existsSync(f)) return reply.code(404).send({ what: 'الكيت مش موجود' });
    reply.header('Content-Disposition', `attachment; filename="${(req.params as { name: string }).name}"`).type('application/zip'); return reply.send(createReadStream(f));
  });

  // FCPXML for Final Cut: finished segments on the song timeline, audio underneath
  app.get('/api/songs/:id/fcpxml', async (req, reply) => {
    const { id } = req.params as { id: string }; const s = song(id)!;
    const fps = 25, fr = (t: number) => `${Math.round(t * fps)}/${fps}s`;
    const done = segs(id).filter(g => (g.status === 'done' || g.status === 'editing') && g.video_asset_id);
    const assets: string[] = [], clips: string[] = [];
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const ap = audioPath(s);
    if (ap) assets.push(`<asset id="a0" name="${esc(String(s.title))}" start="0s" duration="${fr(Number(s.duration))}" hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000"><media-rep kind="original-media" src="file://${esc(ap)}"/></asset>`);
    done.forEach((g, i) => {
      const a = db.prepare('SELECT work_path, duration FROM asset WHERE id = ?').get(String(g.video_asset_id)) as { work_path: string; duration: number };
      const len = Math.min(Number(g.end_s) - Number(g.start_s), Number(a.duration ?? 0) || 999);
      assets.push(`<asset id="v${i + 1}" name="${esc(`${g.idx}`)}" start="0s" duration="${fr(Number(a.duration ?? len))}" hasVideo="1" format="r1"><media-rep kind="original-media" src="file://${esc(a.work_path)}"/></asset>`);
      clips.push(`<asset-clip ref="v${i + 1}" lane="1" offset="${fr(Number(g.start_s))}" start="0s" duration="${fr(len)}" name="مقطع ${g.idx}"/>`);
    });
    const dur = fr(Number(s.duration ?? 0));
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.10">\n<resources>\n<format id="r1" name="FFVideoFormat1080p25" frameDuration="1/25s" width="1920" height="1080"/>\n${assets.join('\n')}\n</resources>\n<library><event name="${esc(String(s.title))}"><project name="${esc(String(s.title))} — مونتاج أولي"><sequence format="r1" duration="${dur}" tcStart="0s"><spine>\n${ap ? `<asset-clip ref="a0" offset="0s" start="0s" duration="${dur}" name="الأغنية">\n${clips.join('\n')}\n</asset-clip>` : `<gap offset="0s" duration="${dur}">\n${clips.join('\n')}\n</gap>`}\n</spine></sequence></project></event></library>\n</fcpxml>\n`;
    reply.header('Content-Disposition', `attachment; filename="${String(s.title).replace(/[^A-Za-z0-9]+/g, '_')}.fcpxml"`).type('application/xml'); return xml;
  });
}

/** Called by the watched folder: a file whose name carries a kit code is attached to its segment. */
export function attachFromInbox(db: DB, assetId: string, fileName: string) {
  const m = fileName.match(/_([0-9a-f]{6})(?:[._\-\s]|$)/i); if (!m) return;
  const g = db.prepare('SELECT id, status FROM segment WHERE kit_code = ?').get(m[1].toLowerCase()) as { id: string; status: string } | undefined;
  if (g) db.prepare(`UPDATE segment SET video_asset_id = ?, updated_at = datetime('now') WHERE id = ?`).run(assetId, g.id);
}

/** First song: I Am The World, imported from the director's map (v7 shots, v7.1 long-take groups) in studio/data.js. */
const IATW_NOTE = 'تقسيم مبدئي من خريطة v7. محتوى كل مقطع (اللقطات والبرومبت) هييجي من التايم لاين الجديد v44.';
export async function seedIatw(db: DB, repoRoot: string) {
  if (db.prepare(`SELECT 1 FROM song WHERE id = 'iatw-v44'`).get()) {
    db.prepare(`UPDATE song SET plan_note = ? WHERE id = 'iatw-v44' AND plan_note IS NULL`).run(IATW_NOTE);
    // only the old v7 cut is tentative; once the v44 timeline is linked (shots exist) this no longer applies
    try { if (!db.prepare(`SELECT 1 FROM shot WHERE song_id = 'iatw-v44'`).get()) db.prepare(`UPDATE segment SET draft = 1 WHERE song_id = 'iatw-v44' AND label IS NOT NULL AND status = 'idea' AND draft = 0 AND prompt_partial = ''`).run(); } catch { /* shot columns not migrated yet */ }
    return;
  }
  const src = await readFile(join(repoRoot, 'studio', 'data.js'), 'utf8').catch(() => null); if (!src) return;
  const D = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1)) as { shots: Row[]; longs: Row[]; cues: Cue[]; sections: { name: string; start: number }[] };
  const poster = db.prepare(`SELECT id FROM asset WHERE label = 'Departure'`).get() as { id?: string } | undefined;
  db.prepare(`INSERT INTO song (id, project_id, title, bpm, bpm_source, bpm_approved, sections, srt, duration, beat_offset, poster_asset_id, segment_seconds, created_at)
    VALUES ('iatw-v44', 'iatw', 'I Am The World', 71.9, 'قياس سابق', 0, ?, ?, 256, 1.3, ?, 15, datetime('now'))`).run(JSON.stringify(D.sections), JSON.stringify(D.cues), poster?.id ?? null);
  db.prepare(`UPDATE song SET plan_note = ? WHERE id = 'iatw-v44'`).run(IATW_NOTE);
  const toolOf = (t: string) => /H3/.test(t) ? 'higgsfield-minimax' : /Kling/.test(t) ? 'higgsfield-kling' : /Veo/.test(t) ? 'flow' : 'stills';
  const groupOf = (n: number) => { for (const l of D.longs) { const nums = (String(l.from_).match(/\d+/g) || []).map(Number); const rng = /→/.test(String(l.from_)) ? Array.from({ length: nums[1] - nums[0] + 1 }, (_, k) => nums[0] + k) : nums; if (rng.includes(n)) return String(l.id); } return null; };
  const ins = db.prepare(`INSERT INTO segment (id, song_id, idx, start_s, end_s, label, group_label, lyric, direction, tool, backup, draft) VALUES (?, 'iatw-v44', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`);
  for (const sh of D.shots) {
    const tool = toolOf(String(sh.tool));
    ins.run(randomUUID(), Number(sh.n), Number(sh.start), Number(sh.end), String(sh.n).padStart(2, '0'), groupOf(Number(sh.n)), String(sh.lyric), String(sh.desc),
      tool, JSON.stringify({ tool: tool === 'stills' ? 'stills' : 'stills', direction: 'صور ثابتة على البيت + مونتاج (خطة الإنقاذ)' }));
  }
}
