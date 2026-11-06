// Test take: a short local clip made with ffmpeg from the real H2 pictures (the three corridor paintings), with a slow,
// quiet camera move and a small «تجربة» mark. No generator, no network, nothing paid. The paintings are only read, never changed.
// The clip is dropped into the same Inbox the app watches, so the shot-code auto-link, the take and the check run exactly as
// for a real file. The name carries the shot code and TEST, so the app marks it test = 1: «تجربة» in the sheet, never in the gallery.
// Usage: node scripts/make-test-take.ts [--code H2] [--seconds <segment length>] [--frames a.png,b.png,c.png] [--inbox <dir>] [--wait <port>]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const run = promisify(execFile);
const arg = (k: string, d?: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const code = (arg('code', 'H2') ?? 'H2').replace(/[^A-Za-z0-9]/g, '');
const dataDir = process.env.GHORFA_DATA ?? join(homedir(), 'Library', 'Application Support', 'Ghorfa');
// length: --seconds, else the length of the segment that holds the shot (the rhythm check measures the clip against it)
function segmentSeconds(): number | null {
  const file = join(dataDir, 'ghorfa.sqlite'); if (!existsSync(file)) return null;
  const db = new DatabaseSync(file, { readOnly: true });
  try { const r = db.prepare(`SELECT g.end_s - g.start_s AS d FROM shot s JOIN segment g ON g.id = s.segment_id WHERE upper(s.code) = upper(?)`).get(code) as { d: number } | undefined; return r?.d ?? null; }
  catch { return null; } finally { db.close(); }
}
const seconds = Math.min(30, Math.max(3, Number(arg('seconds')) || segmentSeconds() || 8.5));
const inbox = arg('inbox') ?? process.env.GHORFA_INBOX ?? join(dataDir, 'Inbox');
const port = arg('wait');

// the pictures: --frames, or the H2 corridor paintings from the library, in the order they light up (العُقدة، الانفصال، بعد المطر)
function libraryFrames(): string[] {
  const file = join(dataDir, 'ghorfa.sqlite'); if (!existsSync(file)) return [];
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare(`SELECT label, work_path FROM asset WHERE kind = 'image' AND folder LIKE 'H2%' AND work_path IS NOT NULL ORDER BY created_at`).all() as { label: string; work_path: string }[];
    const rank = (l: string) => l.includes('الرحيل') ? 0 : l.includes('الشهرة') ? 1 : l.includes('الحب') ? 2 : 3;
    return rows.sort((a, b) => rank(a.label) - rank(b.label)).map(r => r.work_path).filter(p => existsSync(p));
  } finally { db.close(); }
}
const frames = (arg('frames')?.split(',').filter(Boolean) ?? libraryFrames()).slice(0, 4);
if (!frames.length) { console.error('مفيش صور H2 في المكتبة. اعمل مزامنة المكتبة الأول، أو ادّي --frames'); process.exit(1); }

// a font that has Arabic (Mac first, then common Linux paths)
const FONTS = ['/System/Library/Fonts/GeezaPro.ttc', '/System/Library/Fonts/Supplemental/Arial Unicode.ttf', '/Library/Fonts/Arial Unicode.ttf',
  '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'];
const font = FONTS.find(f => existsSync(f));

// the newest test take before this run, so --wait can tell the new one
const before = port ? (((await fetch(`http://127.0.0.1:${port}/api/takes/by-code/${code}`).then(r => r.json()).catch(() => null)) as { takes?: { n: number; test: boolean }[] } | null)?.takes ?? []).filter(x => x.test).reduce((m, x) => Math.max(m, x.n), 0) : 0;

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const name = `IATW_${code}_TEST_${stamp}.mp4`;
await mkdir(inbox, { recursive: true });
const tmp = join(inbox, `.${name}`); // the watcher skips dot-files, so it only sees the finished file
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");

// 1280×720, 25 fps, silent. Each picture gets one slow push-in with a small sideways drift (alternating), then a long dissolve.
// The source is scaled up first so the move is sub-pixel smooth. Grade: a little cooler and softer, like the corridor's cold light.
const FPS = 25, XF = 0.9, n = frames.length;
const clip = (seconds + XF * (n - 1)) / n, N = Math.round(clip * FPS);
const inputs = frames.flatMap(f => ['-loop', '1', '-framerate', String(FPS), '-t', clip.toFixed(3), '-i', f]);
const parts = frames.map((_, i) => {
  const dir = i % 2 ? -1 : 1;
  return `[${i}:v]scale=3840:-2:flags=lanczos,setsar=1,` +
    `zoompan=z='1.02+0.05*on/${N}':x='iw/2-(iw/zoom/2)+${dir}*iw*0.018*(on/${N}-0.5)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=${FPS},` +
    `eq=saturation=0.86:contrast=1.03,colorbalance=bs=0.035:bm=0.02:rh=-0.02,format=yuv420p[c${i}]`;
});
let last = 'c0', chain: string[] = [];
for (let i = 1; i < n; i++) { const out = `x${i}`; chain.push(`[${last}][c${i}]xfade=transition=fade:duration=${XF}:offset=${(i * (clip - XF)).toFixed(3)}[${out}]`); last = out; }
const mark = font ? `,drawbox=x=36:y=ih-84:w=118:h=48:color=black@0.32:t=fill,drawtext=fontfile='${esc(font)}':text='${esc('تجربة')}':fontsize=26:fontcolor=white@0.9:x=36+(118-text_w)/2:y=h-84+(48-text_h)/2` : '';
const finish = `[${last}]vignette=angle=PI/5,fade=t=in:st=0:d=0.6,fade=t=out:st=${(seconds - 0.7).toFixed(2)}:d=0.7${mark},format=yuv420p[v]`;
const graph = [...parts, ...chain, finish].join(';');
try {
  await run('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', graph, '-map', '[v]', '-t', seconds.toFixed(2), '-r', String(FPS),
    '-metadata', `comment=ghorfa test take ${code} (H2 paintings, local)`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'medium', '-movflags', '+faststart', '-f', 'mp4', tmp],
    { maxBuffer: 1 << 24 });
  await rename(tmp, join(inbox, name));
} catch (e) { await rm(tmp, { force: true }); throw e; }
console.log(JSON.stringify({ file: join(inbox, name), code, seconds, frames: frames.length, mark: !!font }));

// --wait <port>: poll the running app until the new take shows up on the shot's segment, with its check
if (port) {
  type T = { id: string; n: number; test: boolean; status: string; qc: { score: number | null; status: string; reason: string } | null };
  const takes = async () => ((await fetch(`http://127.0.0.1:${port}/api/takes/by-code/${code}`).then(r => r.json()).catch(() => null)) as { takes?: T[] } | null)?.takes ?? [];
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const t = (await takes()).filter(x => x.test).sort((a, b) => b.n - a.n)[0];
    if (t && t.n > before && t.qc) { console.log(JSON.stringify({ take: t.id, n: t.n, test: t.test, status: t.status, qc: t.qc })); process.exit(0); }
  }
  console.error('الفيديو ما اتربطش في دقيقة ونص'); process.exit(1);
}
