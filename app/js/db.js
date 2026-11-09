// Local database (IndexedDB). Phase 1 storage; Phase 3 mirrors the same records to the cloud.
// There is intentionally NO delete function in this module. Posted records are append-only.
import { buildPosting, reverse, seriesKey, formatNumber, isBalanced, SCHEMA_VERSION, computeTotals } from './core.js';

const DB_NAME = 'ledger-app';
const STORES = {
  settings: { keyPath: 'key' },
  items: { keyPath: 'id', indexes: ['code'] },
  parties: { keyPath: 'id', indexes: ['kind', 'code'] },
  docs: { keyPath: 'id', indexes: ['type', 'status', 'partyId'] },
  ledger: { keyPath: 'seq', autoIncrement: true, indexes: ['docId', 'partyId', 'account'] },
  stock: { keyPath: 'seq', autoIncrement: true, indexes: ['docId', 'itemId'] },
  seqs: { keyPath: 'series' },
  printlog: { keyPath: 'seq', autoIncrement: true, indexes: ['docId'] },
  audit: { keyPath: 'seq', autoIncrement: true },
};

let db;
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (tx) => new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('Transaction aborted')); });
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));
const now = () => new Date().toISOString();

export async function open() {
  db = await new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, SCHEMA_VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const [name, o] of Object.entries(STORES)) {
        if (d.objectStoreNames.contains(name)) continue;
        const s = d.createObjectStore(name, { keyPath: o.keyPath, autoIncrement: !!o.autoIncrement });
        for (const i of o.indexes || []) s.createIndex(i, i);
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  return db;
}

export async function all(store) { return req(db.transaction(store).objectStore(store).getAll()); }
export async function get(store, key) { return req(db.transaction(store).objectStore(store).get(key)); }
export async function byIndex(store, index, value) {
  return req(db.transaction(store).objectStore(store).index(index).getAll(value));
}

export async function getSettings() {
  const rows = await all('settings');
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    companyName: 'My Company', companyNameAr: '', taxNo: '', address: '', phone: '',
    vatRate: 16, pricesIncludeVat: true, fontScale: 'normal', adminPin: '', branch: '',
    ...s,
  };
}
export async function setSetting(key, value, user) {
  const tx = db.transaction(['settings', 'audit'], 'readwrite');
  tx.objectStore('settings').put({ key, value });
  tx.objectStore('audit').add({ at: now(), user, action: 'setting', ref: key, detail: key === 'adminPin' ? '***' : value });
  return done(tx);
}

// master data: items and parties can be added or edited, never deleted (deactivate instead)
export async function saveMaster(store, obj, user) {
  const tx = db.transaction([store, 'audit'], 'readwrite');
  const before = obj.id ? await req(tx.objectStore(store).get(obj.id)) : null;
  if (before && before.code && obj.code !== before.code) throw new Error('Codes are permanent and cannot be changed');
  const rec = { ...before, ...obj, id: obj.id || uid(), updatedAt: now(), createdAt: before?.createdAt || now() };
  tx.objectStore(store).put(rec);
  const changes = before ? Object.keys(rec).filter((k) => !['updatedAt'].includes(k) && JSON.stringify(before[k] ?? '') !== JSON.stringify(rec[k] ?? ''))
    .map((k) => `${k}: ${before[k] ?? ''} → ${rec[k] ?? ''}`).join(' · ') : rec.name;
  tx.objectStore('audit').add({ at: now(), user, action: before ? 'edit' : 'create', ref: `${store}:${rec.code}`, detail: changes });
  await done(tx);
  return rec;
}

export async function saveDraft(doc, user) {
  const tx = db.transaction(['docs', 'audit'], 'readwrite');
  const before = doc.id ? await req(tx.objectStore('docs').get(doc.id)) : null;
  if (before && before.status !== 'draft') throw new Error('Posted documents cannot be edited');
  const rec = { ...doc, id: doc.id || uid(), status: 'draft', createdAt: before?.createdAt || now(), createdBy: before?.createdBy || user, updatedAt: now() };
  tx.objectStore('docs').put(rec);
  tx.objectStore('audit').add({ at: now(), user, action: before ? 'edit draft' : 'create draft', ref: rec.type, detail: rec.id });
  await done(tx);
  return rec;
}

// Posting is one atomic transaction: number, ledger, stock and audit together or nothing.
export async function post(docId, user, settings, { allowBackdate = false, backdateReason = '' } = {}) {
  const items = Object.fromEntries((await all('items')).map((i) => [i.id, i]));
  const parties = Object.fromEntries((await all('parties')).map((p) => [p.id, p]));
  const tx = db.transaction(['docs', 'ledger', 'stock', 'seqs', 'audit'], 'readwrite');
  const docs = tx.objectStore('docs');
  const doc = await req(docs.get(docId));
  if (!doc) throw new Error('Document not found');
  if (doc.status !== 'draft') throw new Error('Already posted');
  const moves = await req(tx.objectStore('stock').getAll());
  const series = seriesKey(doc.type, doc.date, settings.branch);
  const seq = (await req(tx.objectStore('seqs').get(series))) || { series, next: 1, lastDate: '' };
  const backdated = seq.lastDate && doc.date < seq.lastDate;
  if (backdated && !allowBackdate) { tx.abort(); throw new Error(`Date is before the last posted ${doc.type} (${seq.lastDate}). Owner approval with a reason is required.`); }
  const posting = buildPosting(doc, { moves, items, settings });
  if (!isBalanced(posting.entries)) { tx.abort(); throw new Error('Posting is not balanced'); }
  const number = formatNumber(series, seq.next);
  const totals = posting.totals;
  const rec = {
    ...doc,
    // names are frozen at posting: renaming an item or customer later never changes a posted document
    partyCode: parties[doc.partyId]?.code || '', partyName: parties[doc.partyId]?.name || '',
    lines: (doc.lines || []).map((l) => ({ ...l, itemCode: items[l.itemId]?.code || '', itemName: items[l.itemId]?.name || '', unit: items[l.itemId]?.unit || '' })),
    status: 'posted', series, seqNo: seq.next, number, postedAt: now(), postedBy: user,
    backdated: !!backdated, backdateReason: backdated ? backdateReason : '',
    totalC: totals.totalC, vatC: totals.vatC || 0, netC: totals.netC ?? totals.totalC,
    qtyTotal: totals.qtyTotal || 0, bonusTotal: totals.bonusTotal || 0,
    settingsAtPost: { vatRate: settings.vatRate, pricesIncludeVat: settings.pricesIncludeVat },
  };
  docs.put(rec);
  tx.objectStore('seqs').put({ series, next: seq.next + 1, lastDate: doc.date > seq.lastDate ? doc.date : seq.lastDate });
  for (const e of posting.entries) tx.objectStore('ledger').add({ ...e, docId, date: doc.date, number, type: doc.type, at: now() });
  for (const m of posting.moves) tx.objectStore('stock').add({ ...m, docId, date: doc.date, number, type: doc.type, at: now() });
  tx.objectStore('audit').add({ at: now(), user, action: 'post', ref: number, detail: backdated ? 'BACKDATED: ' + backdateReason : '' });
  await done(tx);
  return rec;
}

export async function voidDoc(docId, reason, user) {
  if (!reason || reason.trim().length < 3) throw new Error('A reason is required');
  const tx = db.transaction(['docs', 'ledger', 'stock', 'audit'], 'readwrite');
  const doc = await req(tx.objectStore('docs').get(docId));
  if (!doc || doc.status !== 'posted') throw new Error('Only posted documents can be voided');
  const entries = await req(tx.objectStore('ledger').index('docId').getAll(docId));
  const moves = await req(tx.objectStore('stock').index('docId').getAll(docId));
  const strip = ({ seq, ...r }) => r;
  const rev = reverse({ entries: entries.map(strip), moves: moves.map(strip) });
  const date = new Date().toISOString().slice(0, 10);
  for (const e of rev.entries) tx.objectStore('ledger').add({ ...e, date, at: now() });
  for (const m of rev.moves) tx.objectStore('stock').add({ ...m, date, at: now() });
  tx.objectStore('docs').put({ ...doc, status: 'voided', voidedAt: now(), voidedBy: user, voidReason: reason });
  tx.objectStore('audit').add({ at: now(), user, action: 'void', ref: doc.number, detail: reason });
  await done(tx);
}

// Draft prints carry a watermark. The first output of a posted document is "Original", once in its life.
export async function logPrint(docId, user, channel = 'print', reason = '') {
  const tx = db.transaction(['docs', 'printlog', 'audit'], 'readwrite');
  const doc = await req(tx.objectStore('docs').get(docId));
  if (doc.status === 'draft') { await done(tx); return { label: 'DRAFT', copyNo: 0 }; }
  const prev = await req(tx.objectStore('printlog').index('docId').getAll(docId));
  const copyNo = prev.length + 1;
  tx.objectStore('printlog').add({ docId, at: now(), user, channel, copyNo, reason });
  tx.objectStore('audit').add({ at: now(), user, action: copyNo === 1 ? 'print original' : 'print copy', ref: doc.number, detail: reason });
  await done(tx);
  return { label: copyNo === 1 ? 'ORIGINAL' : 'COPY', copyNo };
}

export async function exportAll() {
  const out = { app: 'ledger-app', schema: SCHEMA_VERSION, exportedAt: now(), data: {} };
  for (const s of Object.keys(STORES)) out.data[s] = await all(s);
  const text = JSON.stringify(out.data);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  out.sha256 = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return out;
}

export async function isEmpty() {
  for (const s of ['items', 'parties', 'docs']) if ((await all(s)).length) return false;
  return true;
}

// Restore only into an empty database, so a restore can never overwrite existing books.
export async function restoreAll(backup) {
  if (!(await isEmpty())) throw new Error('Restore works only on an empty database. Use a new browser profile or device.');
  if (backup?.app !== 'ledger-app' || !backup.data) throw new Error('This is not a backup file from this app');
  const text = JSON.stringify(backup.data);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const hash = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (backup.sha256 && hash !== backup.sha256) throw new Error('Backup file is damaged (checksum mismatch)');
  const tx = db.transaction(Object.keys(STORES), 'readwrite');
  for (const [s, rows] of Object.entries(backup.data)) {
    if (!STORES[s]) continue;
    for (const r of rows) tx.objectStore(s).put(r);
  }
  await done(tx);
}

export { computeTotals };
