// A stand-in for the claude.ai artifact runtime, for tests: window.claude.use('db' | 'user' | 'downloads').
// The store is kept in localStorage so a reload, or a second page in the same browser, sees the same online
// books. Like the real frame, confirm / prompt / print are refused.
(() => {
  const KEY = '__mockdb';
  const read = () => JSON.parse(localStorage.getItem(KEY) || '{}');
  const write = (o) => localStorage.setItem(KEY, JSON.stringify(o));
  const subs = []; const fire = () => subs.slice().forEach((f) => f());
  window.addEventListener('storage', (e) => { if (e.key === KEY) fire(); });
  const delay = () => new Promise((r) => setTimeout(r, 2));
  const meta = { fromCache: false, hasPendingWrites: false };
  const snap = (path, o) => ({ id: path.split('/').pop(), exists: path in o, data: () => (path in o ? Object.freeze(o[path]) : undefined), metadata: meta });
  const check = (path, even) => { if ((path.split('/').length % 2 === 0) !== even) throw new TypeError('bad path: ' + path); if (!/^[\w\-.~:@+/]+$/.test(path)) throw new TypeError('bad segment: ' + path); };
  const big = (d) => { if (new TextEncoder().encode(JSON.stringify(d)).length > 262144) throw { code: 'invalid_argument', message: 'document over 256 KiB' }; };
  window.__dbCalls = 0;
  const docRef = (path) => { check(path, true); return { id: path.split('/').pop(), path,
    get: async () => { window.__dbCalls++; await delay(); return snap(path, read()); },
    set: async (d) => { window.__dbCalls++; await delay(); if (window.__failWrites) throw { code: 'unavailable', message: 'mock failure' }; big(d); const o = read(); o[path] = JSON.parse(JSON.stringify(d)); write(o); fire(); },
    update: async (d) => { await delay(); const o = read(); if (!(path in o)) throw { code: 'invalid_argument', message: 'missing' }; o[path] = { ...o[path], ...JSON.parse(JSON.stringify(d)) }; write(o); fire(); },
    delete: async () => { await delay(); const o = read(); delete o[path]; write(o); fire(); },
    acquire: async ({ holder, ttlMs }) => { const k = KEY + ':lease:' + path; const L = JSON.parse(localStorage.getItem(k) || 'null'); const now = Date.now();
      if (L && L.holder !== holder && L.exp > now) return { acquired: false, expiresAt: new Date(L.exp).toISOString() };
      const exp = now + Math.min(600000, Math.max(1000, ttlMs || 30000)); localStorage.setItem(k, JSON.stringify({ holder, exp })); return { acquired: true, holder, expiresAt: new Date(exp).toISOString() }; },
    onSnapshot: (next) => { let last; const f = () => { const o = read(); const j = JSON.stringify(o[path]); if (j !== last) { last = j; next(snap(path, o)); } }; subs.push(f); setTimeout(f, 5); return () => { const i = subs.indexOf(f); if (i >= 0) subs.splice(i, 1); }; },
    collection: (p) => colRef(path + '/' + p) }; };
  const ops = { '==': (a, b) => a === b, '!=': (a, b) => a !== b, '>': (a, b) => a > b, '>=': (a, b) => a >= b, '<': (a, b) => a < b, '<=': (a, b) => a <= b };
  const colRef = (path, filters = [], order = null, lim = null) => { check(path, false); return { path,
    where: (f, op, v) => colRef(path, [...filters, [f, op, v]], order, lim), orderBy: (f, dir = 'asc') => colRef(path, filters, [f, dir], lim), limit: (n) => colRef(path, filters, order, n),
    get: async () => { window.__dbCalls++; await delay(); const o = read(); const depth = path.split('/').length + 1;
      let rows = Object.keys(o).filter((p) => p.startsWith(path + '/') && p.split('/').length === depth).sort().map((p) => ({ p, d: o[p] }));
      for (const [f, op, v] of filters) rows = rows.filter(({ d }) => ops[op](d[f], v));
      if (order) rows.sort((a, b) => { const x = a.d[order[0]], y = b.d[order[0]]; return (x < y ? -1 : x > y ? 1 : 0) * (order[1] === 'desc' ? -1 : 1); });
      if (lim) rows = rows.slice(0, lim);
      const docs = rows.map(({ p }) => snap(p, o)); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: meta }; },
    doc: (id) => docRef(path + '/' + (id || crypto.randomUUID())) }; };
  window.__saved = [];
  const caps = { db: { doc: docRef, collection: (p) => colRef(p) },
    user: { isOwner: async () => true, canEdit: async () => true, can: async () => true, id: async () => 'u1', me: async () => ({ id: 'u1', name: 'Tester' }) },
    downloads: { save: async ({ filename, data }) => { const buf = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : new TextEncoder().encode(String(data)); window.__saved.push({ filename, size: buf.length, head: String.fromCharCode(...buf.slice(0, 5)) }); return { status: 'saved' }; } } };
  window.claude = { use: async (n) => caps[n] ?? null };
  const refuse = (v) => () => { window.__refused = (window.__refused || 0) + 1; return v; };
  window.confirm = refuse(false); window.prompt = refuse(null); window.print = refuse(undefined);
})();
