// Online books, end to end, against a stand-in for the claude.ai runtime (test/mock-claude.js):
// empty start, postings as single documents, reload, the program's own question boxes, PDF paper,
// two pages on the same books, a failed write, and moving existing books online.
//   node test/cloud.cjs [--books /path/books.json]     (--books: also move a real backup online and compare)
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const URL = process.env.APP_URL || 'http://127.0.0.1:8765/index.html';
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-claude.js'), 'utf8');
const bi = process.argv.indexOf('--books'); const BOOKS = bi > 0 ? process.argv[bi + 1] : null;
let fails = 0; const ok = (name, cond, extra = '') => { console.log((cond ? '  ok  ' : '  FAIL ') + name + (extra ? ' · ' + extra : '')); if (!cond) fails++; };
const dbx = (p, fn, a) => p.evaluate(async ([src, a]) => { const db = await import('./js/db.js'); return (0, eval)(src)(db, a); }, [fn.toString(), a]);
const store = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('__mockdb') || '{}'));
const booted = async (p) => { await p.waitForSelector('#main h1, #retryBoot', { timeout: 60000 }); await p.waitForTimeout(300); };
const open = async (ctx, seed) => { const p = await ctx.newPage(); p.errors = []; p.on('pageerror', (e) => p.errors.push(e.message));
  await p.route('**/seed/books.js', (r) => (seed ? r.fulfill({ contentType: 'text/javascript', body: 'export default ' + JSON.stringify(seed) + ';' }) : r.fulfill({ status: 404, body: '' })));
  // the built online package loads its libraries from cdnjs and its font from Google Fonts: serve them from here
  await p.route('https://cdnjs.cloudflare.com/**', (r) => { const f = path.join(__dirname, '..', 'vendor', path.basename(r.request().url())); return fs.existsSync(f) ? r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(f) }) : r.fulfill({ status: 404, body: '' }); });
  await p.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await p.goto(URL); await booted(p); return p; };

(async () => {
  const { checkBooks, fromCloud, canon } = await import(path.join(__dirname, '..', 'js', 'cloudmap.js'));
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } }); await ctx.addInitScript(MOCK);
  console.log('▶ empty online books');
  const p = await open(ctx, null);
  ok('opens online, nothing asked of the browser', await p.evaluate(() => document.documentElement.dataset.cloud === '1' && location.hash === ''), await p.textContent('h1'));
  ok('owner is admin', /Admin|مدير/.test(await p.textContent('#whoami')));
  ok('clock started', (await store(p))['meta/clock']?.seeded === true);

  console.log('▶ records and postings');
  const made = await dbx(p, async (db) => {
    const s = await db.getSettings(); await db.setSetting('vatRate', 0, 'T'); await db.setSetting('companyNameAr', 'شركة تجربة', 'T');
    const i1 = await db.saveMaster('items', { code: '1001', name: 'Alpha 500 mg', unit: 'PCS', buyPrice: 10, pricePharmacist: 12, active: true }, 'T');
    const i2 = await db.saveMaster('items', { code: '1002', name: 'Beta syrup', unit: 'PCS', buyPrice: 5, pricePharmacist: 7, active: true }, 'T');
    const sup = await db.saveMaster('parties', { kind: 'supplier', code: '1001', name: 'مورد تجربة' }, 'T');
    const cus = await db.saveMaster('parties', { kind: 'customer', code: '1001', name: 'صيدلية تجربة', region: 'south', type: 'pharmacy' }, 'T');
    const line = (it, qty, bonus, price) => ({ itemId: it.id, itemText: it.code, qty, bonus, price, disc: '', batch: '', expiry: '' });
    const pi = await db.saveDraft({ type: 'PI', date: '2026-01-05', partyId: sup.id, reference: '', notes: '', lines: [line(i1, 100, 10, 10), line(i2, 50, '', 5)], invoiceDiscount: 0 }, 'T');
    const piP = await db.post(pi.id, 'T', await db.getSettings());
    const si = await db.saveDraft({ type: 'SI', date: '2026-01-06', partyId: cus.id, reference: '', notes: '', lines: [line(i1, 10, 1, 12)], invoiceDiscount: 0 }, 'T');
    const siP = await db.post(si.id, 'T', await db.getSettings());
    const draft = await db.saveDraft({ type: 'SI', date: '2026-01-07', partyId: cus.id, reference: '', notes: '', lines: [line(i2, 4, '', 7)], invoiceDiscount: 0 }, 'T');
    return { pi: piP.number, si: siP.number, siId: siP.id, draftId: draft.id, cusId: cus.id, i1: i1.id, had: s.vatRate };
  });
  ok('numbers', made.pi.endsWith('000001') && made.si.endsWith('000001'), made.pi + ' ' + made.si);
  let st = await store(p);
  const sd = st['docs/' + made.siId];
  ok('a posting is one document: record + entries + stock + audit', sd.r.status === 'posted' && sd.ledger.length >= 2 && sd.stock.length === 1 && sd.audit.some((a) => a.action === 'post'), `${sd.ledger.length} entries, ${sd.stock.length} move`);
  ok('saved draft has no entries', st['docs/' + made.draftId].ledger.length === 0 && st['docs/' + made.draftId].r.status === 'draft');
  ok('no stray collections', Object.keys(st).every((k) => /^(settings|items|parties|docs)\/|^meta\/clock$/.test(k)));
  const before = await dbx(p, async (db) => (await db.exportAll()).data);
  await p.reload(); await booted(p);
  const after = await dbx(p, async (db) => (await db.exportAll()).data);
  ok('reload reads the same books back', canon(before) === canon(after), Object.keys(before).filter((k) => canon(before[k]) !== canon(after[k])).join(','));
  ok('number sequences come back from the documents', JSON.stringify(after.seqs.map((s) => [s.series, s.next])) === JSON.stringify(before.seqs.map((s) => [s.series, s.next])), JSON.stringify(after.seqs));

  console.log('▶ the program\'s own boxes, and paper as PDF');
  await p.click('#nav a[href="#/docs?type=SI"]'); await p.waitForTimeout(700);
  ok('links route inside the program', (await p.locator('#dl .drow, .drow').count()) > 0 && await p.evaluate(() => location.hash === ''));
  await p.evaluate((id) => { const a = document.createElement('a'); a.href = '#/doc/' + id; a.id = 'tlink'; a.textContent = 'open'; document.querySelector('#main').prepend(a); }, made.siId); await p.click('#tlink'); await p.waitForSelector('#printBtn');
  await p.click('#printBtn'); await p.waitForSelector('dialog.paper[open]');
  ok('paper preview opens', (await p.locator('dialog.paper .doc-print').count()) >= 1, await p.locator('dialog.paper .stamp').first().textContent());
  await p.screenshot({ path: '/tmp/cloud-paper.png' });
  await p.click('dialog.paper [data-v=pdf]'); await p.waitForFunction(() => window.__saved.length > 0, null, { timeout: 60000 });
  const sv = await p.evaluate(() => window.__saved[0]);
  ok('PDF handed to the host', sv.head === '%PDF-' && sv.size > 20000 && /\.pdf$/.test(sv.filename), `${sv.filename} · ${sv.size} bytes`);
  await p.click('dialog.paper [data-v=close]');
  await p.waitForSelector('#void'); await p.click('#void'); await p.waitForSelector('dialog.ask .ans');
  await p.fill('dialog.ask .ans', 'test void'); await p.click('dialog.ask [data-v=yes]'); await p.waitForTimeout(1200);
  st = await store(p);
  ok('void: reversal inside the same document, number kept', st['docs/' + made.siId].r.status === 'voided' && st['docs/' + made.siId].ledger.length >= 4 && st['docs/' + made.siId].r.number === made.si);
  ok('browser boxes never called', !(await p.evaluate(() => window.__refused)));

  console.log('▶ two pages, one set of books');
  const q = await open(ctx, null);
  const n1 = await dbx(p, async (db, a) => { const d = await db.saveDraft({ type: 'SI', date: '2026-01-08', partyId: a.cusId, reference: '', notes: '', lines: [{ itemId: a.i1, itemText: '1001', qty: 2, bonus: '', price: 12, disc: '', batch: '', expiry: '' }], invoiceDiscount: 0 }, 'T'); return (await db.post(d.id, 'T', await db.getSettings())).number; }, made);
  const n2 = await dbx(q, async (db, a) => { const d = await db.saveDraft({ type: 'SI', date: '2026-01-08', partyId: a.cusId, reference: '', notes: '', lines: [{ itemId: a.i1, itemText: '1001', qty: 3, bonus: '', price: 12, disc: '', batch: '', expiry: '' }], invoiceDiscount: 0 }, 'T'); return (await db.post(d.id, 'T', await db.getSettings())).number; }, made);
  ok('the second page takes the next number, never the same one', n1 !== n2 && n1.endsWith('000002') && n2.endsWith('000003'), n1 + ' ' + n2);
  await p.waitForTimeout(1800);
  const seenByP = await dbx(p, async (db) => (await db.all('docs')).filter((d) => d.number).length);
  ok('the first page sees the other page\'s posting', seenByP === 4, String(seenByP));

  console.log('▶ a write that fails changes nothing');
  const r = await dbx(q, async (db, a) => { window.__failWrites = true; let err = ''; const n0 = (await db.all('ledger')).length;
    try { const d = (await db.all('docs')).find((x) => x.id === a.draftId); await db.post(d.id, 'T', await db.getSettings(), { allowBackdate: true, backdateReason: 'test' }); } catch (e) { err = e.message || e.code; }
    window.__failWrites = false; const d2 = (await db.all('docs')).find((x) => x.id === a.draftId); return { err, status: d2.status, same: (await db.all('ledger')).length === n0 }; }, made);
  ok('failed posting: still a draft, no entries', r.err === 'mock failure' && r.status === 'draft' && r.same, r.err);
  const r2 = await dbx(q, async (db, a) => { const d = await db.post(a.draftId, 'T', await db.getSettings(), { allowBackdate: true, backdateReason: 'test' }); return d.number; }, made);
  ok('and it posts afterwards with the next number', r2.endsWith('000004'), r2);

  const regroup = (m) => { const c = { settings: [], items: [], parties: [], docs: [] }; for (const [k, v] of Object.entries(m)) { const col = k.split('/')[0]; if (col === 'meta') { if (k === 'meta/auditlog') c.auditlog = v; } else c[col].push(v); } return c; };
  st = await store(q);
  ok('books sound after all of it', checkBooks(fromCloud(regroup(st)).data).length === 0, checkBooks(fromCloud(regroup(st)).data).join('; '));
  const exported = await dbx(q, async (db) => db.exportAll());
  ok('no page errors', !p.errors.length && !q.errors.length, [...p.errors, ...q.errors].join(' | '));
  await ctx.close();

  for (const [label, seed] of [['the test books', exported], ...(BOOKS ? [['the given backup', JSON.parse(fs.readFileSync(BOOKS, 'utf8'))]] : [])]) {
    console.log('▶ moving ' + label + ' online');
    const c2 = await b.newContext({ viewport: { width: 420, height: 860 } }); await c2.addInitScript(MOCK);
    const m = await open(c2, seed);
    const got = await dbx(m, async (db) => (await db.exportAll()).data);
    const diff = Object.keys(seed.data).filter((k) => canon(seed.data[k]) !== canon(got[k]));
    ok('every store identical to the file', diff.length === 0, diff.join(','));
    const s2 = await store(m);
    ok('seed recorded on the clock', s2['meta/clock'].seeded === true && s2['meta/clock'].rev === 1 && s2['meta/clock'].seed.records === Object.keys(s2).length - 1, JSON.stringify(s2['meta/clock'].seed));
    await m.reload(); await booted(m);
    const got2 = await dbx(m, async (db) => (await db.exportAll()).data);
    ok('second visit does not move anything again', canon(got2) === canon(got) && (await store(m))['meta/clock'].rev === 1);
    ok('home shows', (await m.locator('#main h1').count()) === 1 && !m.errors.length, m.errors.join(' | '));
    await m.screenshot({ path: `/tmp/cloud-home-${BOOKS && label !== 'the test books' ? 'real' : 'test'}.png` });
    await c2.close();
  }
  await b.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall online-books checks passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
