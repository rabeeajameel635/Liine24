// Build the program as a claude.ai artifact (the online program).
//   node app/tools/build-online.cjs --out DIR [--seed books.json]
// Copies the page's own files and points the three libraries and the print font at the hosts an artifact may
// load from (cdnjs, Google Fonts), so nothing third-party is published with it. --seed adds the books to move
// online on the owner's first visit (seed/books.js); it is data, lives outside the repository, and is removed
// from the artifact once the move is confirmed. Prints the file list for publishing.
const fs = require('fs'); const path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const APP = path.join(__dirname, '..'); const OUT = arg('out'); const SEED = arg('seed');
if (!OUT) { console.error('--out DIR is required'); process.exit(1); }
const CDN = {
  'vendor/xlsx.full.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'vendor/html2canvas.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'vendor/jspdf.umd.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
};
const FONT = 'IBM Plex Sans Arabic';
const FONT_LINK = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap">';
const must = (s, a, name) => { if (!s.includes(a)) throw new Error(`${name}: expected ${a}`); return s; };
const put = (rel, text) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return rel; };
const read = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8');
fs.rmSync(OUT, { recursive: true, force: true });
const files = [];
let html = read('index.html');
html = must(html, 'src="vendor/xlsx.full.min.js"', 'index.html').replace('src="vendor/xlsx.full.min.js"', `src="${CDN['vendor/xlsx.full.min.js']}"`);
html = must(html, '<link rel="stylesheet" href="css/app.css">', 'index.html').replace('<link rel="stylesheet" href="css/app.css">', FONT_LINK + '\n  <link rel="stylesheet" href="css/app.css">');
files.push(put('index.html', html));
let css = read('css/app.css');
const n = (css.match(/^@font-face \{ font-family: 'Plex Arabic';.*$/gm) || []).length; if (n !== 8) throw new Error('app.css: expected 8 bundled font faces, found ' + n);
css = css.replace(/^@font-face \{ font-family: 'Plex Arabic';.*\n/gm, '').replaceAll("'Plex Arabic'", `'${FONT}'`);
files.push(put('css/app.css', css));
for (const f of fs.readdirSync(path.join(APP, 'js')).filter((x) => x.endsWith('.js'))) {
  let js = read('js/' + f);
  if (f === 'app.js') { for (const k of ['vendor/html2canvas.min.js', 'vendor/jspdf.umd.min.js']) js = must(js, `'${k}'`, f).replaceAll(`'${k}'`, `'${CDN[k]}'`); js = must(js, '"Plex Arabic"', f).replaceAll('"Plex Arabic"', `"${FONT}"`); }
  files.push(put('js/' + f, js));
}
files.push(put('manifest.webmanifest', read('manifest.webmanifest')));
if (SEED) { const b = JSON.parse(fs.readFileSync(SEED, 'utf8')); if (b.app !== 'ledger-app' || !b.data) throw new Error('--seed is not a books file'); files.push(put('seed/books.js', 'export default ' + JSON.stringify(b) + ';\n')); }
const left = files.filter((f) => /\.(js|css|html)$/.test(f) && !f.startsWith('seed/')).filter((f) => /['"(]\.{0,2}\/?vendor\//.test(fs.readFileSync(path.join(OUT, f), 'utf8')));
if (left.length) throw new Error('still points at vendor/: ' + left.join(', '));
console.log(JSON.stringify({ out: OUT, files: files.map((f) => ({ as: f, path: path.resolve(OUT, f), bytes: fs.statSync(path.join(OUT, f)).size })) }, null, 1));
