// The books in memory, behind the same small interface db.js uses on IndexedDB (transaction → objectStore →
// get / getAll / put / add / index). Used when the books live online: the browser keeps nothing, the page
// holds a working copy, and every write transaction is handed to `commit` BEFORE it counts as done.
// If `commit` fails, nothing changes here either. Write transactions run one after another.
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function createMem(STORES, hooks = {}) {
  let main = {};
  const fresh = () => { main = {}; for (const n of Object.keys(STORES)) main[n] = new Map(); };
  fresh();
  let chain = Promise.resolve();
  const keyOf = (n, v) => v[STORES[n].keyPath];
  const sorted = (m) => [...m.entries()].sort(([a], [b]) => cmp(a, b)).map(([, v]) => v);

  // run fn alone, after the write transactions already queued
  const exclusive = (fn) => { const run = chain.then(fn); chain = run.catch(() => {}); return run; };
  const load = (data) => { fresh(); for (const n of Object.keys(STORES)) for (const r of data[n] || []) main[n].set(keyOf(n, r), clone(r)); };
  const dump = () => Object.fromEntries(Object.keys(STORES).map((n) => [n, sorted(main[n]).map(clone)]));

  function transaction(names, mode = 'readonly') {
    const rw = mode === 'readwrite';
    const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
    let staged = null, pending = 0, finished = false, aborted = false, timer = null, release = () => {};
    const changes = [];
    const ready = rw ? (() => { const prev = chain; chain = new Promise((r) => (release = r)); return prev.then(() => { staged = {}; }); })() : Promise.resolve();
    const view = (n) => (staged && staged[n]) || main[n];
    const wview = (n) => (staged[n] ||= new Map(main[n]));
    const finish = async () => {
      if (finished || pending) return;
      finished = true;
      try {
        if (aborted) { tx.onabort && tx.onabort(); return; }
        if (rw && changes.length && hooks.commit) await hooks.commit(changes, view);
        if (rw && staged) for (const n of Object.keys(staged)) main[n] = staged[n];
        tx.oncomplete && tx.oncomplete();
      } catch (e) { tx.error = e; (tx.onabort || tx.onerror || (() => {}))(); } finally { release(); }
    };
    const arm = () => { clearTimeout(timer); timer = setTimeout(finish, 0); };
    const R = (fn) => {
      const r = {}; pending++;
      ready.then(() => { if (aborted) throw new Error('Transaction aborted'); r.result = fn(); })
        .then(() => { pending--; r.onsuccess && r.onsuccess(); arm(); }, (e) => { pending--; r.error = e; r.onerror && r.onerror(); arm(); });
      return r;
    };
    ready.then(arm);
    tx.abort = () => { aborted = true; arm(); };
    tx.objectStore = (n) => {
      const kp = STORES[n].keyPath;
      const write = (v, isAdd) => R(() => {
        if (!rw) throw new Error('read-only transaction');
        const rec = clone(v); const m = wview(n);
        if (rec[kp] == null) { if (!STORES[n].autoIncrement) throw new Error(`${n}: no key`); let mx = 0; for (const k of m.keys()) if (k > mx) mx = k; rec[kp] = mx + 1; }
        else if (isAdd && m.has(rec[kp])) throw new Error(`${n}: key ${rec[kp]} already exists`);
        m.set(rec[kp], rec); changes.push({ store: n, key: rec[kp] }); return rec[kp];
      });
      return {
        get: (k) => R(() => clone(view(n).get(k))),
        getAll: () => R(() => sorted(view(n)).map(clone)),
        put: (v) => write(v, false),
        add: (v) => write(v, true),
        index: (i) => ({
          getAll: (val) => R(() => sorted(view(n)).filter((r) => r[i] === val).map(clone)),
          count: (val) => R(() => { let c = 0; for (const r of view(n).values()) if (r[i] === val) c++; return c; }),
        }),
      };
    };
    return tx;
  }
  return { transaction, load, dump, exclusive, get stores() { return main; } };
}
