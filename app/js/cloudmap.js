// Online books layout: how the books (the app's stores) are kept as documents in the artifact's database,
// and how they are read back. Pure functions, shared by the page (cloud.js) and by the books runner tools.
//
//   settings/<key>   { k, value, audit[] }
//   items/<id>       { k, r, audit[] }                         r = the item record
//   parties/<id>     { k, r, audit[] }
//   docs/<id>        { k, r, ledger[], stock[], prints[], audit[] }
//   meta/clock       { rev, pending, at, by, layout, seeded }
//
// One record is one document, and everything a posting writes (entries, stock moves, print log, audit lines)
// lives inside the document of the invoice or voucher it belongs to. So a posting is ONE write: it is either
// all there or not there at all. Number sequences are not stored: they are read from the posted documents.
export const LAYOUT = 1;
export const COLLECTIONS = ['settings', 'items', 'parties', 'docs'];
// The store hands a document's fields back in its own order (alphabetical), so two records are compared
// by content, never by the order of their fields.
export const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((f) => [f, x[f]])) : x));
const bySeq = (a, b) => a.seq - b.seq;
const byKey = (f) => (a, b) => (a[f] < b[f] ? -1 : a[f] > b[f] ? 1 : 0);

// which record an audit line belongs to, from the line itself (used when existing books move online)
export function auditOwner(row, data) {
  const { action, ref, detail, at } = row;
  if (action === 'setting') return 'settings/' + ref;
  const m = /^(items|parties):(.*)$/.exec(ref || '');
  if (m) {
    let c = (data[m[1]] || []).filter((x) => String(x.code) === m[2]);
    if (c.length > 1 && action === 'create') { const n = c.filter((x) => x.name === detail); if (n.length) c = n; }
    if (c.length > 1) { const t = Date.parse(at); c = [...c].sort((x, y) => Math.abs(Date.parse(x.updatedAt) - t) - Math.abs(Date.parse(y.updatedAt) - t)); }
    if (c[0]) return `${m[1]}/${c[0].id}`;
  }
  const docs = data.docs || [];
  const d = docs.find((x) => x.id === detail) || docs.find((x) => x.number && x.number === ref);
  if (d) return 'docs/' + d.id;
  return 'meta/auditlog';
}

// books → documents. owner: Map(audit seq → path) when the caller already knows it (the running page).
export function toCloud(data, owner = null) {
  const out = {};
  for (const s of data.settings || []) out['settings/' + s.key] = { k: s.key, value: s.value, audit: [] };
  for (const st of ['items', 'parties']) for (const r of data[st] || []) out[`${st}/${r.id}`] = { k: r.id, r, audit: [] };
  for (const r of data.docs || []) out['docs/' + r.id] = { k: r.id, r, ledger: [], stock: [], prints: [], audit: [] };
  const into = (rows, field) => { for (const row of rows || []) { const d = out['docs/' + row.docId]; if (!d) throw new Error(`${field} row ${row.seq} has no document`); d[field].push(row); } };
  into(data.ledger, 'ledger'); into(data.stock, 'stock'); into(data.printlog, 'prints');
  for (const row of data.audit || []) {
    const p = (owner && owner.get(row.seq)) || auditOwner(row, data);
    if (!out[p]) { if (p === 'meta/auditlog') out[p] = { k: 'auditlog', audit: [] }; else throw new Error(`audit line ${row.seq} has no record (${p})`); }
    out[p].audit.push(row);
  }
  for (const d of Object.values(out)) for (const f of ['ledger', 'stock', 'prints', 'audit']) if (d[f]) d[f].sort(bySeq);
  return out;
}

// one record's document, rebuilt from the stores as they stand (view: store name → Map)
export function docBody(path, view, owner) {
  const [col, id] = path.split('/');
  const audit = [...view('audit').values()].filter((a) => owner.get(a.seq) === path).sort(bySeq);
  if (col === 'settings') { const s = view('settings').get(id); return { k: id, value: s.value, audit }; }
  if (col === 'items' || col === 'parties') return { k: id, r: view(col).get(id), audit };
  const rows = (st) => [...view(st).values()].filter((x) => x.docId === id).sort(bySeq);
  return { k: id, r: view('docs').get(id), ledger: rows('ledger'), stock: rows('stock'), prints: rows('printlog'), audit };
}

// documents → books. cols: { settings: [body…], items: […], parties: […], docs: […], auditlog?: body }
export function fromCloud(cols) {
  const data = { settings: [], items: [], parties: [], docs: [], ledger: [], stock: [], seqs: [], printlog: [], audit: [] };
  const owner = new Map();
  const take = (path, b) => { for (const a of b.audit || []) { data.audit.push(a); owner.set(a.seq, path); } };
  for (const b of cols.settings || []) { data.settings.push({ key: b.k, value: b.value }); take('settings/' + b.k, b); }
  for (const st of ['items', 'parties']) for (const b of cols[st] || []) { data[st].push(b.r); take(`${st}/${b.k}`, b); }
  for (const b of cols.docs || []) {
    data.docs.push(b.r); data.ledger.push(...(b.ledger || [])); data.stock.push(...(b.stock || [])); data.printlog.push(...(b.prints || []));
    take('docs/' + b.k, b);
  }
  if (cols.auditlog) take('meta/auditlog', cols.auditlog);
  data.settings.sort(byKey('key')); for (const st of ['items', 'parties', 'docs']) data[st].sort(byKey('id'));
  for (const st of ['ledger', 'stock', 'printlog', 'audit']) data[st].sort(bySeq);
  data.seqs = deriveSeqs(data.docs);
  return { data, owner };
}

// the number sequences, read from the documents that carry a number (posted and voided alike)
export function deriveSeqs(docs) {
  const m = {};
  for (const d of docs) {
    if (!d.series || !d.seqNo) continue;
    const s = (m[d.series] ||= { series: d.series, next: 1, lastDate: '' });
    if (d.seqNo + 1 > s.next) s.next = d.seqNo + 1;
    if (d.date > s.lastDate) s.lastDate = d.date;
  }
  return Object.values(m).sort(byKey('series'));
}

// what must be true of books kept this way; returns a list of problems (empty = sound)
export function checkBooks(data) {
  const bad = [];
  const dr = data.ledger.reduce((s, e) => s + e.debitC, 0), cr = data.ledger.reduce((s, e) => s + e.creditC, 0);
  if (dr !== cr) bad.push(`ledger not balanced: ${dr} / ${cr}`);
  const seen = new Set();
  for (const d of data.docs) if (d.number) { if (seen.has(d.number)) bad.push('number used twice: ' + d.number); seen.add(d.number); }
  for (const st of ['items', 'parties']) { const c = new Set(); for (const r of data[st]) { const k = (r.kind || '') + ':' + r.code; if (c.has(k)) bad.push(`${st} code used twice: ${r.code}`); c.add(k); } }
  for (const st of ['ledger', 'stock', 'printlog', 'audit']) { const c = new Set(); for (const r of data[st]) { if (c.has(r.seq)) bad.push(`${st} line number used twice: ${r.seq}`); c.add(r.seq); } }
  return bad;
}
