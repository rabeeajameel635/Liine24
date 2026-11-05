// الفحص والتقييم: every generated picture or video is checked before Rabee sees it.
//   الوش (SFace vs baseline A) · الثوابت (المشبك، اللوفر، مجوهرات: خاتم الحب بس في L1–L5) · الاحتشام (الصدر والضهر)
//   الإيقاع (طول الفيديو على البارات المقاسة للمقطع) · الدقة (فيديو ≤1080p، صورة ≤2K)
// Score = the weakest check (out of 100), with one line saying why. Under 95 → «محتاج إعادة».
// The check only recommends: «اعتمد» stays Rabee's, and nothing here ever approves.
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DB } from './db.ts';
import { CAP } from './media.ts';
import { modelsReady, decodeRGB, faceScore } from './face.ts';

const run = promisify(execFile);
export const PASS = 95;

export type CheckKey = 'face' | 'clip' | 'loafers' | 'jewelry' | 'modesty' | 'rhythm' | 'resolution';
export type Check = { key: CheckKey; label: string; state: 'pass' | 'fail' | 'na' | 'pending' | 'error'; score: number | null; line: string };
export type QcResult = { asset_id: string; score: number | null; status: 'pass' | 'redo' | 'pending'; reason: string; checks: Check[]; at: string };
const LABEL: Record<CheckKey, string> = { face: 'الوش', clip: 'المشبك', loafers: 'اللوفر', jewelry: 'المجوهرات', modesty: 'الاحتشام', rhythm: 'الإيقاع', resolution: 'الدقة' };
const ar = (n: number, d = 0) => n.toLocaleString('ar-EG', { maximumFractionDigits: d });

export function migrateQc(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS qc_run (id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, score REAL, status TEXT NOT NULL, reason TEXT NOT NULL, checks TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
}

// ---------- the checks that run anywhere ----------
/** Resolution of the copy that is actually used (the library caps it on import; the original is kept untouched beside it). */
export function checkResolution(kind: string, w: number, h: number, ow?: number, oh?: number): Check {
  const c = (state: Check['state'], score: number | null, line: string): Check => ({ key: 'resolution', label: LABEL.resolution, state, score, line });
  if (!w || !h) return c('na', null, 'المقاس مش معروف');
  const dim = (x: number, y: number) => `\u2066${x}×${y}\u2069`; // keep 2048×1144 left-to-right inside Arabic text
  const orig = ow && oh && (ow !== w || oh !== h) ? ` · الأصل ${dim(ow, oh)} محفوظ` : '';
  if (kind === 'video') return Math.max(w, h) <= CAP.videoW && Math.min(w, h) <= CAP.videoH ? c('pass', 100, `${dim(w, h)}${orig}`) : c('fail', 80, `${dim(w, h)} فوق ١٠٨٠p`);
  return Math.max(w, h) <= CAP.imageLong ? c('pass', 100, `${dim(w, h)}${orig}`) : c('fail', 80, `${dim(w, h)} فوق 2K`);
}

/** The clip must cover its segment, which is a whole number of MEASURED bars. Longer is fine (trimmed); shorter is not. */
export function checkRhythm(duration: number | null, target: { seconds: number; bars: number } | null): Check {
  const c = (state: Check['state'], score: number | null, line: string): Check => ({ key: 'rhythm', label: LABEL.rhythm, state, score, line });
  if (!target) return c('na', null, 'مش مربوط بمقطع');
  if (duration == null) return c('na', null, 'صورة');
  const short = target.seconds - duration;
  if (short > 0.04) return c('fail', Math.max(0, Math.round(duration / target.seconds * 100)), `أقصر من المقطع بـ ${ar(short, 2)} ث (المقطع ${ar(target.bars)} بار)`);
  return c('pass', 100, `بيغطي ${ar(target.bars)} بار${duration - target.seconds > 0.5 ? ` · زيادة ${ar(duration - target.seconds, 1)} ث هتتقص` : ''}`);
}

export function summarize(checks: Check[]): Pick<QcResult, 'score' | 'status' | 'reason'> {
  const scored = checks.filter(c => c.score != null) as (Check & { score: number })[];
  const worst = [...scored].sort((a, b) => a.score - b.score)[0];
  const score = worst ? worst.score : null;
  const pending = checks.some(c => c.state === 'pending' || c.state === 'error');
  if (score != null && score < PASS) return { score, status: 'redo', reason: `${worst.label}: ${worst.line}` };
  if (pending) { const p = checks.find(c => c.state === 'pending' || c.state === 'error')!; return { score, status: 'pending', reason: `${p.label}: ${p.line}` }; }
  return { score, status: 'pass', reason: 'كله معدّي' };
}

// ---------- the look (Claude Code, file reading only, inside a temp folder) ----------
const LOOK_SCHEMA = { type: 'object', additionalProperties: false, required: ['people', 'clip', 'loafers', 'jewelry', 'modesty'], properties: {
  people: { type: 'integer', minimum: 0 },
  clip: { type: 'object', additionalProperties: false, required: ['state', 'ar'], properties: { state: { enum: ['yes', 'no', 'not_visible'] }, ar: { type: 'string' } } },
  loafers: { type: 'object', additionalProperties: false, required: ['state', 'ar'], properties: { state: { enum: ['same', 'different', 'not_visible'] }, ar: { type: 'string' } } },
  jewelry: { type: 'object', additionalProperties: false, required: ['state', 'ar'], properties: { state: { enum: ['none', 'ring_only', 'other', 'unsure', 'not_visible'] }, ar: { type: 'string' } } },
  modesty: { type: 'object', additionalProperties: false, required: ['state', 'ar'], properties: { state: { enum: ['covered', 'not_covered', 'unsure', 'not_visible'] }, ar: { type: 'string' } } } } };
type Look = { people: number; clip: { state: string; ar: string }; loafers: { state: string; ar: string }; jewelry: { state: string; ar: string }; modesty: { state: string; ar: string } };

async function look(files: string[], refs: { clip?: string; loafers?: string }, claudeBin = 'claude'): Promise<Look> {
  const dir = await mkdtemp(join(tmpdir(), 'ghorfa-qc-'));
  try {
    const names: string[] = [];
    for (const [i, f] of files.entries()) { const n = `pic_${i + 1}.jpg`; await copyFile(f, join(dir, n)); names.push(n); }
    if (refs.clip) await run('ffmpeg', ['-v', 'error', '-y', '-i', refs.clip, '-vf', "scale='min(900,iw)':-2", join(dir, 'ref_clip.jpg')]);
    if (refs.loafers) await run('ffmpeg', ['-v', 'error', '-y', '-i', refs.loafers, '-vf', "scale='min(900,iw)':-2", join(dir, 'ref_loafers.jpg')]);
    const prompt = `You are checking a generated picture of the character Donia against her locked rules, before the director sees it.
Read every file: ${names.map(n => './' + n).join(', ')}${names.length > 1 ? ' (the first is the whole picture or frame; any others are close-ups or other frames of the same thing — use them to see small details such as earrings)' : ''}.
${refs.clip ? 'Reference of her hair clip: ./ref_clip.jpg. ' : ''}${refs.loafers ? 'Reference of her shoes: ./ref_loafers.jpg.' : ''}
Rules:
- clip: she always wears the crimson velvet claw clip «سِرّ» in her hair. yes / no / not_visible (hair not in frame).
- loafers: exactly the same white loafers as the reference. same / different / not_visible (feet not in frame).
- jewelry: NO jewelry at all — no earrings, necklaces, bracelets, piercings — except one ring (the love ring) which is allowed. none / ring_only / other / unsure / not_visible. Look hard at earlobes in the close-ups. Use not_visible when ears, neck and hands are all out of frame or hidden; use unsure ONLY when something is visible but you cannot tell what it is.
- modesty: chest and back covered, no added sheerness; fitted cuts and one bare shoulder are fine. covered / not_covered / unsure / not_visible.
- people: how many people are visible.
For each, "ar" is at most 5 Egyptian Arabic words saying what you saw (e.g. «حلق صغير في الودن»، «المشبك ظاهر»). Describe only what is visible.`;
    const out = await new Promise<string>((res, rej) => {
      const p = spawn(claudeBin, ['-p', '--restricted', '--tools', 'Read', '--strict-mcp-config', '--output-format', 'json', '--json-schema', JSON.stringify(LOOK_SCHEMA)], { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
      let o = '', e = ''; const t = setTimeout(() => { p.kill(); rej(new Error('الفحص ما ردّش في ٤ دقايق')); }, 240000);
      p.stdout.on('data', d => { o += d; }); p.stderr.on('data', d => { e += d; });
      p.on('error', err => { clearTimeout(t); rej(err); });
      p.on('close', code => { clearTimeout(t); code === 0 ? res(o) : rej(new Error(e.slice(0, 160) || `exit ${code}`)); });
      p.stdin.end(prompt);
    });
    const r = JSON.parse(out) as { structured_output?: Look };
    if (!r.structured_output) throw new Error('الفحص ما رجّعش نتيجة');
    return r.structured_output;
  } finally { await rm(dir, { recursive: true, force: true }); }
}

function lookChecks(l: Look): Check[] {
  const mk = (key: CheckKey, state: Check['state'], score: number | null, line: string): Check => ({ key, label: LABEL[key], state, score, line });
  if (l.people === 0) return (['clip', 'loafers', 'jewelry', 'modesty'] as CheckKey[]).map(k => mk(k, 'na', null, 'مفيش حد في الكادر'));
  return [
    l.clip.state === 'yes' ? mk('clip', 'pass', 100, l.clip.ar || 'ظاهر') : l.clip.state === 'no' ? mk('clip', 'fail', 85, l.clip.ar || 'مش موجود') : mk('clip', 'na', null, l.clip.ar || 'الشعر مش في الكادر'),
    l.loafers.state === 'same' ? mk('loafers', 'pass', 100, l.loafers.ar || 'نفس اللوفر') : l.loafers.state === 'different' ? mk('loafers', 'fail', 85, l.loafers.ar || 'جزمة تانية') : mk('loafers', 'na', null, l.loafers.ar || 'الرجلين مش في الكادر'),
    l.jewelry.state === 'none' ? mk('jewelry', 'pass', 100, 'مفيش') : l.jewelry.state === 'ring_only' ? mk('jewelry', 'pass', 100, 'خاتم بس · مسموح في L1–L5 بس')
      : l.jewelry.state === 'other' ? mk('jewelry', 'fail', 80, l.jewelry.ar || 'فيه مجوهرات') : l.jewelry.state === 'not_visible' ? mk('jewelry', 'na', null, l.jewelry.ar || 'مش في الكادر')
      : mk('jewelry', 'fail', 94, `مش متأكد: ${l.jewelry.ar || 'محتاج عينك'}`),
    l.modesty.state === 'covered' ? mk('modesty', 'pass', 100, 'متغطية') : l.modesty.state === 'not_covered' ? mk('modesty', 'fail', 60, l.modesty.ar || 'مكشوفة')
      : l.modesty.state === 'unsure' ? mk('modesty', 'fail', 94, `مش متأكد: ${l.modesty.ar || 'محتاج عينك'}`) : mk('modesty', 'na', null, 'مش في الكادر')
  ];
}

// ---------- one run ----------
export async function runQc(db: DB, dataDir: string, assetId: string): Promise<QcResult> {
  migrateQc(db);
  const a = db.prepare('SELECT * FROM asset WHERE id = ?').get(assetId) as Record<string, string | number | null> | undefined;
  if (!a) throw new Error('مش موجود');
  const kind = String(a.kind); const work = String(a.work_path ?? ''); if (!work || !existsSync(work)) throw new Error('الملف لسه ما نزلش');
  const checks: Check[] = [];
  const { stdout: dims } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', work]);
  const [ww, wh] = dims.trim().split(',').map(Number);
  checks.push(checkResolution(kind, ww, wh, Number(a.width), Number(a.height)));
  // rhythm: the segment this video is attached to, measured on its bars
  const seg = db.prepare(`SELECT s.start_s, s.end_s, g.downbeats, g.bpm FROM segment s JOIN song g ON g.id = s.song_id WHERE s.video_asset_id = ?`).get(assetId) as { start_s: number; end_s: number; downbeats: string | null; bpm: number } | undefined;
  let target: { seconds: number; bars: number } | null = null;
  if (seg) { const db_ = JSON.parse(seg.downbeats || '[]') as number[]; const inBars = db_.filter(t => t >= seg.start_s - 0.05 && t < seg.end_s - 0.05).length; target = { seconds: seg.end_s - seg.start_s, bars: inBars || Math.round((seg.end_s - seg.start_s) / (240 / seg.bpm)) }; }
  checks.push(checkRhythm(kind === 'video' ? Number(a.duration) : null, target));

  // frames to look at: a still = whole + four quarters (small things like earrings need full resolution); a video = three frames
  const tmp = await mkdtemp(join(tmpdir(), 'ghorfa-frames-')); const frames: string[] = [];
  try {
    if (kind === 'video') {
      const d = Number(a.duration) || 1;
      for (const [i, t] of [0.15, 0.5, 0.85].entries()) { const f = join(tmp, `f${i}.jpg`); await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(d * t), '-i', work, '-frames:v', '1', '-vf', "scale='min(1600,iw)':-2", f]); frames.push(f); }
    } else {
      const f = join(tmp, 'whole.jpg'); await run('ffmpeg', ['-v', 'error', '-y', '-i', work, '-vf', "scale='min(1600,iw)':-2", f]); frames.push(f);
      for (const [i, [x, y]] of [[0, 0], [1, 0], [0, 1], [1, 1]].entries()) { const q = join(tmp, `q${i}.jpg`); await run('ffmpeg', ['-v', 'error', '-y', '-i', work, '-vf', `crop=iw/2:ih/2:${x}*iw/2:${y}*ih/2`, q]); frames.push(q); }
    }
    // constants + modesty
    const ref = (label: string) => (db.prepare('SELECT work_path FROM asset WHERE label = ?').get(label) as { work_path?: string } | undefined)?.work_path;
    try { checks.push(...lookChecks(await look(frames, { clip: ref('الشعر والمشبك «سِرّ»'), loafers: ref('الجزمة') }))); }
    catch (e) { checks.push({ key: 'clip', label: 'الثوابت', state: 'error', score: null, line: `ما اشتغلش: ${(e as Error).message.slice(0, 60)}` }); }
    // face
    if (!modelsReady(dataDir)) checks.push({ key: 'face', label: LABEL.face, state: 'pending', score: null, line: 'مستني الماك (موديلات الوش)' });
    else {
      try {
        const imgs = await Promise.all((kind === 'video' ? frames : [frames[0]]).map(f => decodeRGB(f, 1600)));
        const r = await faceScore(db, dataDir, imgs);
        checks.push(r.pct == null ? { key: 'face', label: LABEL.face, state: 'na', score: null, line: 'مفيش وش في الكادر' }
          : { key: 'face', label: LABEL.face, state: r.pct >= PASS ? 'pass' : 'fail', score: r.pct, line: `${ar(r.pct)}٪ من خط الأساس` });
      } catch (e) { checks.push({ key: 'face', label: LABEL.face, state: 'error', score: null, line: (e as Error).message.slice(0, 60) }); }
    }
  } finally { await rm(tmp, { recursive: true, force: true }); }

  const sum = summarize(checks);
  const res: QcResult = { asset_id: assetId, ...sum, checks, at: new Date().toISOString() };
  db.prepare('INSERT INTO qc_run (id, asset_id, score, status, reason, checks) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), assetId, sum.score, sum.status, sum.reason, JSON.stringify(checks));
  return res;
}

// ---------- queue + routes ----------
const queue: string[] = []; let busy = false;
export function queueQc(db: DB, dataDir: string, assetId: string, log?: (m: string) => void) {
  if (!queue.includes(assetId)) queue.push(assetId);
  if (busy) return; busy = true;
  (async () => { while (queue.length) { const id = queue.shift()!; try { await runQc(db, dataDir, id); } catch (e) { log?.(`qc ${id}: ${(e as Error).message}`); } } busy = false; })();
}

export async function qcRoutes(app: FastifyInstance, db: DB, dataDir: string) {
  migrateQc(db);
  const latest = (id: string) => { const r = db.prepare('SELECT * FROM qc_run WHERE asset_id = ? ORDER BY created_at DESC LIMIT 1').get(id) as Record<string, string | number | null> | undefined; return r ? { ...r, checks: JSON.parse(String(r.checks)) } : null; };
  app.get('/api/assets/:id/qc', async req => ({ qc: latest((req.params as { id: string }).id), running: queue.includes((req.params as { id: string }).id) || false }));
  app.post('/api/assets/:id/qc', async (req, reply) => {
    const { id } = req.params as { id: string };
    try { return { qc: await runQc(db, dataDir, id) }; } catch (e) { return reply.code(409).send({ what: (e as Error).message }); }
  });
  app.get('/api/qc', async () => ({ items: db.prepare(`SELECT q.asset_id, q.score, q.status, q.reason FROM qc_run q WHERE q.created_at = (SELECT max(created_at) FROM qc_run x WHERE x.asset_id = q.asset_id)`).all() }));
}
