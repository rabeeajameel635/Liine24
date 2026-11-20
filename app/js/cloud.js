// Online books: when the page runs as a claude.ai artifact, the books live in the artifact's database
// (layout in cloudmap.js) and this page holds only a working copy in memory. Claude reads and writes the
// same documents from any conversation, so the page and Claude keep ONE set of books.
//
// Every write goes through `commit`: check that nobody changed the books since this page read them
// (meta/clock.rev), write the one document, move the clock. A posting is a single document write.
import { createMem } from './memidb.js';
import { toCloud, fromCloud, docBody, checkBooks, canon, LAYOUT, COLLECTIONS } from './cloudmap.js';

let cdb = null, mem = null, rev = 0, owner = new Map(), onRemote = null, unsub = null, inflight = 0;
// this page's name on the clock and on the write lease; kept for the tab, so a reload is still the same writer
const sid = (() => { const mk = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  try { let v = sessionStorage.getItem('ledger-sid'); if (!v) { v = mk(); sessionStorage.setItem('ledger-sid', v); } return v; } catch { return mk(); } })();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAGE = 500;
export const stale = () => Object.assign(new Error('The books were changed from another place. Refreshing…'), { code: 'stale' });

// the capability, or null when this page is not running as an artifact (then the books stay in this browser)
export async function connect() {
  try { if (!window.claude?.use) return null; cdb = await window.claude.use('db'); } catch { cdb = null; }
  return cdb;
}
export async function who() {
  try {
    const u = await window.claude.use('user'); if (!u) return { admin: true, name: '' };
    const [own, edit, me] = await Promise.all([u.isOwner(), u.canEdit(), u.me?.().catch(() => null)]);
    return { admin: !!(own || edit), owner: !!own, name: me?.name || '' };
  } catch { return { admin: true, name: '' }; }
}

// a store call, retried a few times when the platform says "try again"
async function call(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      const c = e?.code;
      if ((c === 'unavailable' || c === 'resource_exhausted') && i < 4) { await sleep(400 * 2 ** i + Math.random() * 300); continue; }
      if (c === 'quota_exceeded') throw new Error('The online books are full. Tell Claude: the database has reached its limit.');
      if (c === 'revoked' || c === 'not_granted' || c === 'capability_disabled') throw new Error('The online books cannot be reached from this view. Open the program from its own link.');
      throw e;
    }
  }
}
const clockRef = () => cdb.doc('meta/clock');
async function getClock() { const s = await call(() => clockRef().get()); return s.exists ? s.data() : null; }
async function readAll(col) {
  const out = []; let last = null;
  for (;;) {
    const base = cdb.collection(col);
    const q = (last === null ? base : base.where('k', '>', last)).orderBy('k').limit(PAGE);
    const s = await call(() => q.get());
    for (const d of s.docs) out.push(structuredClone(d.data()));
    if (s.docs.length < PAGE) return out;
    last = out[out.length - 1].k;
  }
}
async function readBooks() {
  for (let i = 0; i < 6; i++) {
    const c1 = await getClock();
    if (!c1) return { clock: null, cols: {} };
    if (c1.pending && Date.now() - Date.parse(c1.at) < 15000) { await sleep(1500); continue; }   // someone is mid-write
    const cols = {}; for (const c of COLLECTIONS) cols[c] = await readAll(c);
    const al = await call(() => cdb.doc('meta/auditlog').get()); if (al.exists) cols.auditlog = al.data();
    const c2 = await getClock();
    if (c2 && c2.rev === c1.rev && !c2.pending === !c1.pending) return { clock: c1, cols };
  }
  throw new Error('The books are being written from another place. Try again in a moment.');
}

// open the online books into memory. Returns { mem, empty }.
export async function openBooks(STORES) {
  mem = createMem(STORES, { commit });
  const { clock, cols } = await readBooks();
  const empty = !clock || !clock.seeded;
  if (!empty) { const { data, owner: o } = fromCloud(cols); mem.load(data); owner = o; rev = clock.rev; }
  if (!unsub) unsub = clockRef().onSnapshot((s) => {
    const c = s.exists ? s.data() : null;
    if (!c || inflight || c.pending || c.rev === rev || c.by === sid) return;
    onRemote && onRemote();
  }, () => { unsub = null; });
  return { mem, empty, interrupted: !!clock && !clock.seeded };
}
export const watch = (fn) => { onRemote = fn; };
export const revision = () => rev;

// read the books again (after a change from another place)
export async function refresh() {
  return mem.exclusive(async () => {
    const { clock, cols } = await readBooks();
    if (!clock || !clock.seeded) return false;
    const { data, owner: o } = fromCloud(cols); mem.load(data); owner = o; rev = clock.rev; return true;
  });
}

// ---- writing ----
async function lease() {
  for (let i = 0; i < 3; i++) {
    const r = await call(() => clockRef().acquire({ holder: sid, ttlMs: 6000 }));
    if (r.acquired) return;
    const wait = Math.min(6000, Math.max(300, Date.parse(r.expiresAt || '') - Date.now() || 1500));
    await sleep(wait + Math.random() * 300);
  }
  throw new Error('The books are busy on another device. Try again in a few seconds.');
}
// the hook memidb calls with a finished write transaction: changes = [{store, key}], view(store) → Map as it will be
async function commit(changes, view) {
  const paths = new Set(); let critical = false; const newAudit = [];
  for (const { store, key } of changes) {
    if (store === 'settings') paths.add('settings/' + key);
    else if (store === 'items' || store === 'parties') { paths.add(`${store}/${key}`); critical = true; }
    else if (store === 'docs') { paths.add('docs/' + key); const d = view('docs').get(key); if (d && d.status !== 'draft' && d.status !== 'cancelled') critical = true; }
    else if (store === 'ledger' || store === 'stock' || store === 'printlog') { paths.add('docs/' + view(store).get(key).docId); critical = true; }
    else if (store === 'audit') newAudit.push(key);
  }
  const list = [...paths];
  const primary = list.find((p) => p.startsWith('docs/')) || list.find((p) => !p.startsWith('settings/')) || list[0];
  if (!primary) throw new Error('Nothing to write');
  const own = new Map(owner); for (const seq of newAudit) own.set(seq, primary);
  const bodies = list.map((p) => [p, docBody(p, view, own)]);
  inflight++;
  try {
    if (critical) await lease();
    const c = await getClock();
    if (!c || c.rev !== rev) throw stale();
    const next = { rev: rev + 1, at: new Date().toISOString(), by: sid, layout: LAYOUT, seeded: true };
    if (critical) await call(() => clockRef().set({ ...next, pending: primary }));
    for (const [p, body] of bodies) await call(() => cdb.doc(p).set(body));
    await call(() => clockRef().set({ ...next, pending: '' }));
    rev = next.rev; owner = own;
  } finally { inflight--; }
}

// ---- moving existing books online (once), and starting empty books ----
// backup: the app's backup file. report(done, total) for the progress line.
export async function seed(backup, report = () => {}) {
  const docs = Object.entries(toCloud(backup.data));
  const stamp = { at: new Date().toISOString(), by: sid, layout: LAYOUT };
  await call(() => clockRef().set({ rev: 0, pending: 'seed', seeded: false, ...stamp }));
  let n = 0;
  for (const [p, body] of docs) { await call(() => cdb.doc(p).set(body)); report(++n, docs.length); if (n % 20 === 0) await sleep(250); }
  // read everything back and compare with the file, record by record
  const cols = {}; for (const c of COLLECTIONS) cols[c] = await readAll(c);
  const al = await call(() => cdb.doc('meta/auditlog').get()); if (al.exists) cols.auditlog = al.data();
  const back = fromCloud(cols);
  const want = fromCloud(regroup(toCloud(backup.data))).data;
  const diff = Object.keys(want).filter((k) => canon(want[k]) !== canon(back.data[k]));
  const bad = checkBooks(back.data);
  if (diff.length || bad.length) throw new Error('The online copy does not match the file: ' + [...diff, ...bad].join(', '));
  await call(() => clockRef().set({ rev: 1, pending: '', seeded: true, seed: { sha256: backup.sha256 || '', exportedAt: backup.exportedAt || '', records: docs.length }, ...stamp }));
  mem.load(back.data); owner = back.owner; rev = 1;
  return { records: docs.length };
}
export async function startEmpty() {
  await call(() => clockRef().set({ rev: 1, pending: '', seeded: true, at: new Date().toISOString(), by: sid, layout: LAYOUT }));
  rev = 1;
}
function regroup(map) {
  const cols = { settings: [], items: [], parties: [], docs: [] };
  for (const [p, b] of Object.entries(map)) { const c = p.split('/')[0]; if (c === 'meta') cols.auditlog = b; else cols[c].push(b); }
  return cols;
}
