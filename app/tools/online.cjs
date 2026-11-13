// Claude's side of the online books (the program published as a claude.ai artifact; layout in js/cloudmap.js).
// Claude reads the documents with the artifact database tools, turns them into a books file the books runner
// (tools/books.cjs) works on, and turns the runner's result back into the few documents that changed.
//
//   node app/tools/online.cjs pull settings=F items=F parties=F docs=F clock=F [auditlog=F] --out books.json --state state.json
//        F: a file holding the output of db_list for that collection (db_get for clock / auditlog), as the tool gave it
//   node app/tools/online.cjs plan --before books.json --after books2.json --state state.json --out ops.json
//        ops.json: the db_write ops (changed records + the clock), to send in ONE call so they commit together
//   node app/tools/online.cjs check --books books.json
// After writing: pull again and compare with books2.json (plan --before books2.json --after <pulled> must give 0 records).
const fs = require('fs'); const path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const text = (f) => { let t = fs.readFileSync(f, 'utf8'); try { const j = JSON.parse(t); if (Array.isArray(j)) t = j.map((x) => x.text || '').join('\n'); } catch {} return t; };
const rows = (f) => text(f).split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{"data"')).map((l) => JSON.parse(l));
const one = (f) => { const t = text(f); const v = /"version":\s*(\d+)/.exec(t); const line = t.split('\n').map((l) => l.trim()).find((l) => l.startsWith('{') && !l.startsWith('{"exists"') && !l.startsWith('{"notice"'));
  return /"exists":\s*false/.test(t) || !line ? null : { data: line.startsWith('{"data"') ? JSON.parse(line).data : JSON.parse(line), version: v ? Number(v[1]) : null }; };
(async () => {
  const { toCloud, fromCloud, checkBooks, LAYOUT, COLLECTIONS } = await import(path.join(__dirname, '..', 'js', 'cloudmap.js'));
  const cmd = process.argv[2];
  if (cmd === 'pull') {
    const src = Object.fromEntries(process.argv.slice(3).filter((a) => /^\w+=/.test(a)).map((a) => [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]));
    const cols = {}, versions = {};
    for (const c of COLLECTIONS) { if (!src[c]) throw new Error('missing ' + c + '=FILE'); cols[c] = rows(src[c]).map((r) => { versions[`${c}/${r.id}`] = r.version; return r.data; }); }
    const clock = one(src.clock); if (!clock || !clock.data.seeded) throw new Error('the online books are not set up (no seeded clock)');
    if (clock.data.pending) throw new Error('a write is in progress on the online books (clock.pending): read again in a moment');
    if (src.auditlog) { const a = one(src.auditlog); if (a) { cols.auditlog = a.data; versions['meta/auditlog'] = a.version; } }
    const { data, owner } = fromCloud(cols);
    const bad = checkBooks(data); if (bad.length) throw new Error('books not sound: ' + bad.join('; '));
    fs.writeFileSync(arg('out'), JSON.stringify({ app: 'ledger-app', schema: 1, exportedAt: new Date().toISOString(), data }));
    fs.writeFileSync(arg('state'), JSON.stringify({ versions, owner: [...owner], clock: clock.data, clockVersion: clock.version }));
    console.log(JSON.stringify({ pulled: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])), rev: clock.data.rev }));
  } else if (cmd === 'plan') {
    const A = JSON.parse(fs.readFileSync(arg('before'), 'utf8')).data, B = JSON.parse(fs.readFileSync(arg('after'), 'utf8')).data;
    const st = JSON.parse(fs.readFileSync(arg('state'), 'utf8')); const owner = new Map(st.owner);
    const bad = checkBooks(B); if (bad.length) throw new Error('result not sound: ' + bad.join('; '));
    const a = toCloud(A, owner), b = toCloud(B, owner);
    for (const p of Object.keys(a)) if (!b[p]) throw new Error('a record disappeared: ' + p + ' (records are never deleted)');
    const ops = Object.keys(b).filter((p) => JSON.stringify(a[p]) !== JSON.stringify(b[p])).map((p) => ({ op: 'set', path: p, data: b[p], ...(st.versions[p] ? { ifVersion: st.versions[p] } : {}) }));
    const records = ops.length;
    if (records) ops.push({ op: 'set', path: 'meta/clock', data: { ...st.clock, rev: st.clock.rev + 1, pending: '', at: new Date().toISOString(), by: 'claude', layout: LAYOUT, seeded: true }, ifVersion: st.clockVersion });
    if (ops.length > 50) throw new Error(`${ops.length} documents changed: more than one db_write call holds (50). Split the work.`);
    fs.writeFileSync(arg('out'), JSON.stringify(ops));
    console.log(JSON.stringify({ records, paths: ops.map((o) => o.path), bytes: Buffer.byteLength(JSON.stringify(ops)) }));
  } else if (cmd === 'check') {
    const d = JSON.parse(fs.readFileSync(arg('books'), 'utf8')).data; console.log(JSON.stringify({ problems: checkBooks(d), counts: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.length])) }));
  } else { console.error('pull | plan | check'); process.exit(1); }
})().catch((e) => { console.error(e.message); process.exit(1); });
