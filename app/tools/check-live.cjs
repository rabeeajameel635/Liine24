// Before every publish: is the live page exactly what Claude published from the repository?
//   node app/tools/check-live.cjs LIVE_DIR
// LIVE_DIR holds the page's files as they are now (read them with the Artifact tool, action "read", paths: all).
// The seal in js/app.js names the commit the live page was built from; that commit is built again here and
// every file is compared. SAME everywhere = nobody but Claude changed the program. Any DIFF = stop and look
// (a change from the page's own editor, another session, or someone else), bring it into the repository first.
const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
const LIVE = process.argv[2]; if (!LIVE) { console.error('usage: check-live.cjs LIVE_DIR'); process.exit(2); }
const app = fs.readFileSync(path.join(LIVE, 'js/app.js'), 'utf8');
const m = app.match(/const BUILD = \{ commit: '([0-9a-f]{7,40})', at: '([^']*)' \};/);
const ROOT = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'live-')); const src = path.join(tmp, 'src'), out = path.join(tmp, 'out');
const commit = m ? m[1] : process.argv[3];
if (!commit) { console.log('NO SEAL: this live page was published before the seal existed. Give the commit to compare with as a 2nd argument.'); process.exit(3); }
execSync(`git worktree add -f "${src}" ${commit} -q`, { cwd: ROOT });
try {
  execSync(`node "${path.join(src, 'app/tools/build-online.cjs')}" --out "${out}" --dirty`, { stdio: 'ignore' });
  const files = []; const walk = (d, r = '') => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f), q = r ? r + '/' + f : f; fs.statSync(p).isDirectory() ? walk(p, q) : files.push(q); } }; walk(out);
  let bad = 0;
  for (const f of files) {
    const lp = path.join(LIVE, f); if (!fs.existsSync(lp)) { console.log('MISSING', f); continue; }
    let a = fs.readFileSync(path.join(out, f), 'utf8'), b = fs.readFileSync(lp, 'utf8');
    if (f === 'js/app.js') { const re = /const BUILD = \{[^\n]*\};/; a = a.replace(re, ''); b = b.replace(re, ''); }   // the build time differs, the code must not
    if (f === 'index.html') { const re = /<title>[^<]*<\/title>/; a = a.replace(re, ''); b = b.replace(re, ''); }      // the page title is kept by the host
    if (a === b) console.log('SAME   ', f); else { bad++; console.log('DIFF   ', f); }
  }
  console.log(bad ? `\n${bad} file(s) changed outside Claude and the repository since ${commit}. Do not publish over them: bring them in first.` : `\nThe live page is exactly commit ${commit}${m ? ' (sealed ' + m[2] + ')' : ''}.`);
  process.exitCode = bad ? 1 : 0;
} finally { execSync(`git worktree remove --force "${src}"`, { cwd: ROOT }); fs.rmSync(tmp, { recursive: true, force: true }); }
