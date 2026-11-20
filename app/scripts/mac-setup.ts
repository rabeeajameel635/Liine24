// npm run mac-setup — first run on the Mac, in order:
//   ١ الأدوات (Node, ffmpeg, Claude Code)  ٢ الحزم  ٣ موديلات الوش (SHA-256)  ٤ الواجهة  ٥ قاعدة البيانات والبرنامج  ٦ يفتح «أول تشغيل»
// It never asks for anything that isn't in «اللي محتاجه مني على الماك» (docs/mac-checklist.md).
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('..', import.meta.url));
const data = process.env.GHORFA_DATA ?? join(homedir(), 'Library', 'Application Support', 'Ghorfa');
const PORT = Number(process.env.PORT ?? 4317);
const url = `http://127.0.0.1:${PORT}/#/setup`;
const say = (n: string, t: string) => console.log(`\n${n}  ${t}`);
const has = (bin: string) => { try { execFileSync('which', [bin], { stdio: 'ignore' }); return true; } catch { return false; } };
const step = (cmd: string, args: string[], env: Record<string, string> = {}) => new Promise<number>(res => {
  const p = spawn(cmd, args, { cwd: app, stdio: 'inherit', env: { ...process.env, GHORFA_DATA: data, ...env } }); p.on('close', c => res(c ?? 1)); p.on('error', () => res(1));
});
let problems = 0;

say('١', 'الأدوات');
const node = Number(process.versions.node.split('.')[0]);
if (node < 24) { console.log(`✗ Node ${process.versions.node} قديم. البرنامج محتاج Node 24 أو أحدث (عندك Node 26 في ~/.local).`); process.exit(1); }
console.log(`✓ Node ${process.versions.node}`);
for (const b of ['ffmpeg', 'ffprobe']) { if (has(b)) console.log(`✓ ${b}`); else { console.log(`✗ ${b} مش موجود. في Terminal: brew install ffmpeg`); process.exit(1); } }
if (has('claude')) console.log('✓ Claude Code'); else { console.log('! Claude Code مش موجود: الفحص البصري والإلهام هيستنوه. باقي البرنامج شغال.'); problems++; }
if (platform() !== 'darwin') console.log('! ده مش ماك: الدخول هيتحفظ في ملف محمي بدل Keychain (للتجربة بس).');

say('٢', 'الحزم');
if (!existsSync(join(app, 'node_modules', 'fastify'))) { if (await step('npm', ['install']) !== 0) { console.log('✗ npm install وقع. ابعت اللي فوق للمساعد.'); process.exit(1); } }
console.log('✓ الحزم جاهزة');

say('٣', 'موديلات الوش (YuNet + SFace) والتأكد من الـ SHA-256');
if (await step('node', ['scripts/fetch-models.ts']) !== 0) { console.log('! الموديلات ما نزلتش كلها. البرنامج هيفتح والوش هيفضل «مستني»، وتقدر تعيد السكريبت بعدين.'); problems++; }

say('٤', 'الواجهة');
if (await step('npm', ['run', 'build']) !== 0) { console.log('✗ بناء الواجهة وقع.'); process.exit(1); }

say('٥', 'قاعدة البيانات والبرنامج');
const up = async () => { try { return (await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok; } catch { return false; } };
if (await up()) console.log(`✓ البرنامج شغال قبل كده على ${PORT}`);
else {
  // the server creates the database in ${data} and seeds the plan, the decisions and the confirmed MCP addresses
  const srv = spawn('node', ['server/index.ts'], { cwd: app, stdio: 'inherit', env: { ...process.env, GHORFA_DATA: data, PORT: String(PORT) } });
  srv.on('close', c => process.exit(c ?? 0));
  for (let i = 0; i < 60 && !(await up()); i++) await new Promise(r => setTimeout(r, 500));
  if (!(await up())) { console.log('✗ البرنامج ما اشتغلش. ابعت اللي فوق للمساعد.'); srv.kill(); process.exit(1); }
  console.log(`✓ قاعدة البيانات في ${data}`);
}

say('٦', `«أول تشغيل» · ${url}`);
if (platform() === 'darwin') spawn('open', [url], { stdio: 'ignore', detached: true }).unref(); else console.log(`افتح ${url}`);
console.log(problems ? `\nفيه ${problems} حاجة ناقصة مكتوبة فوق بـ «!». باقي الخطوات في الشاشة.` : '\nكل حاجة جاهزة. كمّل الخطوات في الشاشة.');
console.log('البرنامج شغال هنا. اقفل الـ Terminal أو دوس Ctrl+C عشان توقفه.');
