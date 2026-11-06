// Test take: a short local clip made with ffmpeg (no generator, no network, nothing paid), dropped into the same Inbox
// the app watches, so the shot-code auto-link, the take and the check all run exactly as for a real file.
// The name carries the shot code and TEST, so the app marks it test = 1: «تجربة» in the sheet, never in the gallery.
// Usage: node scripts/make-test-take.ts [--code H2] [--seconds 14] [--inbox <dir>] [--wait <port>]
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const run = promisify(execFile);
const arg = (k: string, d?: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const code = (arg('code', 'H2') ?? 'H2').replace(/[^A-Za-z0-9]/g, '');
const seconds = Math.min(30, Math.max(2, Number(arg('seconds', '14')) || 14));
const dataDir = process.env.GHORFA_DATA ?? join(homedir(), 'Library', 'Application Support', 'Ghorfa');
const inbox = arg('inbox') ?? process.env.GHORFA_INBOX ?? join(dataDir, 'Inbox');
const port = arg('wait');

// a font that has Arabic (Mac first, then common Linux paths); without one the clip is a plain colour pattern
const FONTS = ['/System/Library/Fonts/GeezaPro.ttc', '/System/Library/Fonts/Supplemental/Arial Unicode.ttf', '/Library/Fonts/Arial Unicode.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf'];
const font = FONTS.find(f => existsSync(f));

// the newest test take before this run, so --wait can tell the new one
const before = port ? (((await fetch(`http://127.0.0.1:${port}/api/takes/by-code/${code}`).then(r => r.json()).catch(() => null)) as { takes?: { n: number; test: boolean }[] } | null)?.takes ?? []).filter(x => x.test).reduce((m, x) => Math.max(m, x.n), 0) : 0;

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const name = `IATW_${code}_TEST_${stamp}.mp4`;
await mkdir(inbox, { recursive: true });
const tmp = join(inbox, `.${name}`); // the watcher skips dot-files, so it only sees the finished file
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
// 1280×720 (under the 1080p cap), 25 fps, silent; the time stamp makes every run a new file (new SHA-256)
const base = `testsrc2=size=1280x720:rate=25:duration=${seconds},hue=s=0.35`;
const text = font ? [
  `drawbox=x=0:y=ih/2-110:w=iw:h=220:color=black@0.6:t=fill`,
  `drawtext=fontfile='${esc(font)}':text='${esc('تجربة · مش إنتاج')}':fontsize=72:fontcolor=white:x=(w-text_w)/2:y=h/2-text_h-6`,
  `drawtext=fontfile='${esc(font)}':text='${esc(`${code}  ${stamp}`)}':fontsize=40:fontcolor=white@0.85:x=(w-text_w)/2:y=h/2+24`
].join(',') : '';
try {
  await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', text ? `${base},${text}` : base,
    '-metadata', `comment=ghorfa test take ${code}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '28', '-preset', 'veryfast', '-movflags', '+faststart', '-f', 'mp4', tmp]);
  await rename(tmp, join(inbox, name));
} catch (e) { await rm(tmp, { force: true }); throw e; }
console.log(JSON.stringify({ file: join(inbox, name), code, seconds, text: !!font }));

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
