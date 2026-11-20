// Books runner: Claude keeps the books through the app's own engine.
// It opens a books file (the app's backup format), applies operations through the same code the app uses
// (same numbering, postings, rounding, audit log), writes the books file back, and prints PDFs.
// No data lives in this file or in the repository: the books file and any import files are passed in.
//
//   node app/tools/books.cjs --ops ops.json --out books.json [--in books.json] [--pdf outdir] [--url http://127.0.0.1:8765/index.html]
//
// ops.json is a list, run in order:
//   { "op": "settings", "values": { "companyNameAr": "...", "contacts": "..." } }
//   { "op": "import", "file": "/path/prepared.json" }                 items, parties, one invoice draft
//   { "op": "party", "party": { "kind": "customer", "name": "..." } }   add a customer or supplier (next code of its kind)
//   { "op": "partyset", "party": { "kind": "customer", "code": "1001", "region": "south" } }  change a party's definition (by code)
//   { "op": "draft", "doc": { "type": "SI", "partyCode": "1001", "date": "2026-11-10", "lines": [...] } }
//   { "op": "edit", "ref": "last" | "<docId>", "lines": [{ "itemCode": "1001", "price": 9, "disc": 10 }], "set": { "notes": "..." } }
//                                                                       change lines of a saved draft (by item code)
//   { "op": "items", "set": [{ "code": "1001", "buyPrice": 9 }] }     change item definitions (by code)
//   { "op": "post", "ref": "last" | "<docId>" | "<number>" }           post a saved draft
//   { "op": "print", "ref": "last" | "<docId>" | "<number>", "name": "file.pdf" }
//   { "op": "report", "route": "#/balances", "name": "balances.pdf" }  print any report screen
// Every op is reported on stdout as one JSON line.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const OPS = JSON.parse(fs.readFileSync(arg('ops'), 'utf8'));
const OUT = arg('out');
const IN = arg('in');
const PDF = arg('pdf', path.dirname(OUT || '.'));
const URL = arg('url', 'http://127.0.0.1:8765/index.html');
const say = (o) => console.log(JSON.stringify(o));

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  p.on('dialog', (d) => d.accept());
  await p.addInitScript(() => { localStorage.setItem('lang', 'ar'); sessionStorage.setItem('role', 'admin'); sessionStorage.setItem('user', 'Claude'); window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  await p.goto(URL + '#/dashboard'); await p.waitForTimeout(500);
  const dbx = (fn, a) => p.evaluate(async ([src, a]) => { const db = await import('./js/db.js'); return (0, eval)(src)(db, a); }, [fn.toString(), a]);
  if (IN && fs.existsSync(IN)) {
    const books = JSON.parse(fs.readFileSync(IN, 'utf8'));
    await dbx(async (db, bk) => db.restoreAll(bk), books);
    say({ op: 'open', file: IN, exportedAt: books.exportedAt });
  }
  let last = null;
  const find = async (ref) => dbx(async (db, r) => {
    const docs = await db.all('docs');
    return (docs.find((d) => d.id === r || d.number === r) || null)?.id || null;
  }, ref === 'last' ? last : ref);
  const reload = async (hash) => { await p.goto(URL + '?r=' + Date.now() + (hash || '#/dashboard')); await p.waitForTimeout(500); };
  const pdfOf = async (name) => {
    await p.evaluate(() => document.body.classList.add('printing')); await p.emulateMedia({ media: 'print' }); await p.evaluate(() => document.fonts.ready);
    const file = path.join(PDF, name); await p.pdf({ path: file, format: 'A4', printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } });
    await p.emulateMedia({ media: 'screen' }); await p.evaluate(() => document.body.classList.remove('printing'));
    return file;
  };
  for (const o of OPS) {
    try {
      if (o.op === 'settings') {
        await dbx(async (db, v) => { for (const [k, x] of Object.entries(v)) await db.setSetting(k, x, 'Claude'); }, o.values);
        say({ op: 'settings', keys: Object.keys(o.values) });
      } else if (o.op === 'import') {
        await reload('#/import'); await p.waitForSelector('#json');
        await p.fill('#json', fs.readFileSync(o.file, 'utf8')); await p.click('#importJson'); await p.waitForSelector('#doImport');
        await p.click('#doImport'); await p.waitForTimeout(3000);
        const h = await p.evaluate(() => location.hash); last = h.startsWith('#/doc/') ? h.slice(6) : last;
        say({ op: 'import', file: path.basename(o.file), draft: last });
      } else if (o.op === 'party') {
        const r = await dbx(async (db, c) => {
          const core = await import('./js/core.js');
          const parties = await db.all('parties'); const kind = c.kind || 'customer';
          if (parties.some((x) => x.kind === kind && x.name === c.name)) throw new Error('party exists: ' + c.name);
          const code = String(c.code || core.nextNumericCode(parties.filter((x) => x.kind === kind).map((x) => x.code)));
          if (parties.some((x) => x.kind === kind && x.code === code)) throw new Error('code exists: ' + code);
          const rec = await db.saveMaster('parties', { kind, code, name: c.name, phone: String(c.phone || ''), address: c.address || '', region: c.region || (kind === 'customer' ? 'gaza' : ''), type: c.type || (kind === 'customer' ? 'pharmacy' : ''), creditLimit: Number(c.creditLimit) || '' }, 'Claude');
          return { code: rec.code, id: rec.id, kind };
        }, o.party);
        say({ op: 'party', ...r });
      } else if (o.op === 'partyset') {
        const r = await dbx(async (db, c) => {
          const kind = c.kind || 'customer';
          const p = (await db.all('parties')).find((x) => x.kind === kind && x.code === String(c.code)); if (!p) throw new Error('party not found: ' + c.code);
          const { code, kind: k, ...v } = c; const rec = await db.saveMaster('parties', { ...p, ...v }, 'Claude');
          return { code: rec.code, kind, set: Object.keys(v) };
        }, o.party);
        say({ op: 'partyset', ...r });
      } else if (o.op === 'draft') {
        last = await dbx(async (db, d) => {
          const parties = await db.all('parties'); const items = await db.all('items');
          const kind = ['PI', 'PR', 'PV'].includes(d.type) ? 'supplier' : 'customer';
          const party = parties.find((x) => x.kind === kind && (x.code === String(d.partyCode) || x.name === d.partyName));
          if (!party && d.type !== 'OS') throw new Error('party not found: ' + (d.partyCode || d.partyName));
          const lines = (d.lines || []).map((l) => { const it = items.find((i) => i.code === String(l.itemCode)); if (!it) throw new Error('item not found: ' + l.itemCode); return { itemId: it.id, itemText: it.code, qty: l.qty, bonus: l.bonus || '', price: l.price, disc: l.disc || '', batch: l.batch || '', expiry: l.expiry || '' }; });
          const rec = await db.saveDraft({ type: d.type, date: d.date, partyId: party?.id || '', reference: d.reference || '', notes: d.notes || '', lines, invoiceDiscount: d.invoiceDiscount || 0,
            amount: d.amount || '', method: d.method || 'cash', cashAccount: d.cashAccount || '1100', chequeNo: d.chequeNo || '', chequeBank: d.chequeBank || '', dueDate: d.dueDate || '', salesman: d.salesman || '' }, 'Claude');
          return rec.id;
        }, o.doc);
        say({ op: 'draft', type: o.doc.type, id: last });
      } else if (o.op === 'edit') {
        const id = await find(o.ref || 'last');
        const r = await dbx(async (db, [id, ch, set]) => {
          const d = (await db.all('docs')).find((x) => x.id === id); if (!d) throw new Error('draft not found');
          const items = await db.all('items'); const byCode = Object.fromEntries(items.map((i) => [i.code, i.id]));
          let n = 0; const miss = [];
          for (const c of ch) { const iid = byCode[String(c.itemCode)]; const ls = d.lines.filter((l) => l.itemId === iid); if (!ls.length) { miss.push(c.itemCode); continue; }
            for (const l of ls) { for (const [k, v] of Object.entries(c)) if (k !== 'itemCode') l[k] = v; n++; } }
          for (const [k, v] of Object.entries(set || {})) if (['date', 'reference', 'notes', 'invoiceDiscount', 'salesman'].includes(k)) d[k] = v;
          await db.saveDraft(d, 'Claude'); return { changed: n, missing: miss };
        }, [id, o.lines || [], o.set]);
        last = id; say({ op: 'edit', id, ...r });
      } else if (o.op === 'items') {
        const r = await dbx(async (db, set) => {
          const items = await db.all('items'); let n = 0; const miss = [];
          for (const c of set) { const it = items.find((i) => i.code === String(c.code)); if (!it) { miss.push(c.code); continue; } const { code, ...v } = c; await db.saveMaster('items', { ...it, ...v }, 'Claude'); n++; }
          return { changed: n, missing: miss };
        }, o.set);
        say({ op: 'items', ...r });
      } else if (o.op === 'post') {
        const id = await find(o.ref || 'last');
        const r = await dbx(async (db, id) => { const s = await db.getSettings(); const d = await db.post(id, 'Claude', s); return { number: d.number, totalC: d.totalC }; }, id);
        last = id; say({ op: 'post', id, ...r });
      } else if (o.op === 'print') {
        const id = await find(o.ref || 'last');
        await reload('#/doc/' + id); await p.waitForSelector('#printBtn, #printdraft');
        if (await p.locator('#printBtn').count()) await p.click('#printBtn'); else await p.click('#printdraft');
        await p.waitForTimeout(800);
        say({ op: 'print', id, file: await pdfOf(o.name || id + '.pdf') });
      } else if (o.op === 'report') {
        await reload(o.route); await p.waitForTimeout(800);
        await p.click('#pr'); await p.waitForTimeout(500);
        say({ op: 'report', route: o.route, file: await pdfOf(o.name || 'report.pdf') });
      } else throw new Error('unknown op ' + o.op);
    } catch (e) { say({ op: o.op, error: e.message }); process.exitCode = 1; break; }
  }
  if (OUT && !process.exitCode) {
    const books = await dbx(async (db) => db.exportAll());
    fs.writeFileSync(OUT, JSON.stringify(books));
    const counts = Object.fromEntries(Object.entries(books.data).map(([k, v]) => [k, v.length]));
    say({ op: 'save', file: OUT, sha256: books.sha256, counts });
  }
  if (errors.length) say({ pageErrors: errors });
  await b.close();
})();
