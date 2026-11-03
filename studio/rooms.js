/* غرفة الإخراج — rooms, drawer, timeline, QC, gallery, release, credits. Depends on studio.js (window.__RS). */
(() => {
'use strict';
const R = window.__RS;
const { $, $$, esc, uid, clamp, tc, tcShort, num, fmtN, toast, copy, download, svg, Media, srcOf, hydrate, mediaTag, probe, pickFiles,
  STATIONS, TOOLS, STATUS, GATE, STATE_TXT, REF_SLOTS, QC_CHECKS, DESTS, SHOTS, LONGS, ALL, shotById, D, SONG, RED_AT,
  save, shotState, stationById, stationState, barLen, gateOf, gateScore, continuity, estimateShot, spent, buildPrompt } = R;
const S = () => R.S;

const ROOMS = [['stations', 'المحطات'], ['timeline', 'التايم لاين'], ['storyboard', 'الستوري بورد'], ['qc', 'الفحص'], ['gallery', 'المعرض'], ['release', 'الإصدار'], ['credits', 'الكريدت']];
const view = $('#view');
let mountFn = null;

/* ================= routing ================= */
function route() {
  const [, room = 'stations', arg] = (location.hash || '').split('/');
  return { room: ROOMS.some(r => r[0] === room) ? room : 'stations', arg: arg ? decodeURIComponent(arg) : null };
}
const nav = (room, arg) => { location.hash = '#/' + room + (arg ? '/' + encodeURIComponent(arg) : ''); };
function render() {
  const { room, arg } = route();
  S().room = room; save();
  $('#rooms').innerHTML = ROOMS.map(([k, t]) => `<button class="room-btn" data-nav="${k}" ${k === room ? 'aria-current="page"' : ''}>${svg(k)}<span>${t}</span>${k === 'timeline' && continuity().length ? '<i class="dot"></i>' : ''}</button>`).join('');
  renderChips();
  mountFn = null;
  view.ondragover = view.ondragleave = view.ondrop = null;
  view.innerHTML = Rooms[room](arg);
  if (mountFn) mountFn(view);
  hydrate(view);
}
window.addEventListener('hashchange', render);
function rerender() { const y = view.scrollTop; render(); view.scrollTop = y; }

function curBalance() {
  const st = stationState('higgsfield');
  const base = num(st?.credits);
  if (base == null) return null;
  const since = st.creditsAt || '';
  return base - S().ledger.filter(e => e.station === 'higgsfield' && (e.date || '') > since).reduce((a, e) => a + (+e.credits || 0), 0);
}
function renderChips() {
  const s = S(), errs = continuity();
  const set = s.set === 'v71' ? LONGS : SHOTS;
  const appr = set.filter(x => s.shots[x.id]?.status === 'approved').length;
  const bal = curBalance();
  $('#chips').innerHTML = `
    <button class="chip ${bal != null && bal < 200 ? 'warn' : ''}" data-nav="credits"><i class="led"></i>Higgsfield <b>${bal == null ? '—' : fmtN(bal)}</b></button>
    <button class="chip ${s.bpm.confirmed ? '' : 'warn'}" data-nav="timeline"><i class="led"></i>BPM <b>${fmtN(s.bpm.value)}</b>${s.bpm.confirmed ? '' : ' غير مؤكد'}</button>
    <button class="chip" data-nav="storyboard"><i class="led"></i>معتمد <b>${appr}/${set.length}</b></button>
    <button class="chip ${errs.length ? 'bad' : ''}" data-nav="timeline"><i class="led"></i>الراكور <b>${errs.length ? errs.length + ' خطأ' : 'سليم'}</b></button>`;
}

/* ================= global events ================= */
document.addEventListener('click', e => {
  const n = e.target.closest('[data-nav]');
  if (n) { e.preventDefault(); closeDrawer(); nav(n.dataset.nav, n.dataset.arg); return; }
  if (e.target.closest('[data-close]')) closeDrawer();
  const ctl = e.target.closest('button,a,input,select,textarea,label');
  const sh = e.target.closest('[data-shot]');
  if (sh && (!ctl || ctl === sh)) { e.preventDefault(); openShot(sh.dataset.shot); return; }
  const tk = e.target.closest('[data-take]');
  if (tk && (!ctl || ctl === tk)) { e.preventDefault(); openTake(tk.dataset.take); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeDrawer();
  if (e.key === ' ' && route().room === 'timeline' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); togglePlay(); }
});

/* ================= drawer ================= */
const drawer = $('#drawer');
let drawerRefresh = null;
function openDrawer(html, onMount, refresh) {
  $('#drawer-body').innerHTML = html; drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false');
  drawerRefresh = refresh || null;
  if (onMount) onMount($('#drawer-body'));
  hydrate($('#drawer-body'));
}
function closeDrawer() {
  if (!drawer.classList.contains('open')) return;
  drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true');
  $$('#drawer-body video').forEach(v => v.pause());
  drawerRefresh = null; rerender();
}

/* ================= common bits ================= */
const statusTag = st => `<span class="tag ${STATUS[st]?.c || ''}">${STATUS[st]?.t || st}</span>`;
const stateTags = sh => ['H', 'W', 'D'].filter(k => sh.states[k]).map(k => {
  const v = sh.states[k]; return `<span class="tag ${k === 'W' && v.b === 4 ? 'bad' : ''}" title="${esc(STATE_TXT[k][v.b] || '')}">${k}${v.a}${v.b !== v.a ? '→' + v.b : ''}</span>`;
}).join('');
const setOf = () => S().set === 'v71' ? LONGS : SHOTS;
function segHTML(name, opts, cur) { return `<div class="seg" role="group">${opts.map(([v, t]) => `<button data-seg="${name}" data-v="${v}" aria-pressed="${v === cur}">${t}</button>`).join('')}</div>`; }
function bindSeg(root, name, fn) { $$(`[data-seg="${name}"]`, root).forEach(b => b.onclick = () => fn(b.dataset.v)); }
function guessFromName(name) {
  const out = {};
  const lower = name.toLowerCase();
  if (/^hf_|higgs/.test(lower)) out.station = 'higgsfield';
  else if (/runway|gen-?[34]/.test(lower)) out.station = 'runway';
  else if (/flow|veo/.test(lower)) { out.station = 'flow'; out.tool = 'Veo'; }
  else if (/grok/.test(lower)) out.station = 'grok';
  if (/minimax|h3/.test(lower)) out.tool = 'H3';
  if (/kling/.test(lower)) out.tool = 'Kling';
  if (/seedance/.test(lower)) out.tool = 'Seedance';
  const s = name.match(/(?:^|[^a-z0-9])s(\d{1,2})(?!\d)/i); if (s && SHOTS.find(x => x.n === +s[1])) out.shot = SHOTS.find(x => x.n === +s[1]).id;
  const a = name.match(/(?:^|[^a-z0-9])([ab]\d{1,2})(?!\d)/i); if (!out.shot && a) { const L = LONGS.find(l => l.label.toLowerCase() === a[1].toLowerCase()); if (L) out.shot = L.id; }
  return out;
}
async function addTakes(files, defaults = {}) {
  const ids = [];
  for (const f of files) {
    const meta = await probe(f);
    if (meta.kind === 'audio') continue;
    const id = 't_' + uid();
    await Media.put(id, f);
    const g = guessFromName(f.name);
    S().takes[id] = { id, key: id, name: f.name, kind: meta.kind, w: meta.w, h: meta.h, dur: meta.dur, size: f.size, created: new Date().toISOString(),
      shot: defaults.shot ?? g.shot ?? null, role: defaults.role || 'take', tool: defaults.tool ?? g.tool ?? '', station: defaults.station ?? g.station ?? (g.tool ? TOOLS[g.tool]?.station : '') ?? '', credits: '', dests: [], note: '', qc: null };
    const sid = S().takes[id].shot;
    if (sid) { const st = shotState(sid); if (!st.takes.includes(id)) st.takes.push(id); }
    ids.push(id);
  }
  save(); return ids;
}
function addLinkTake(url, defaults = {}) {
  const id = 't_' + uid();
  const kind = /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(url) ? 'image' : 'video';
  const g = guessFromName(url.split('/').pop() || '');
  S().takes[id] = { id, url, name: url.split('/').pop()?.split('?')[0] || url, kind, created: new Date().toISOString(),
    shot: defaults.shot ?? g.shot ?? null, role: defaults.role || 'take', tool: g.tool || '', station: /higgsfield/.test(url) ? 'higgsfield' : /runway/.test(url) ? 'runway' : /google/.test(url) ? 'flow' : (g.station || ''), credits: '', dests: [], note: '', qc: null };
  const sid = S().takes[id].shot; if (sid) shotState(sid).takes.push(id);
  save(); return id;
}
function syncLedger(t) {
  const L = S().ledger; const i = L.findIndex(e => e.take === t.id);
  const c = num(t.credits);
  if (!c) { if (i >= 0) L.splice(i, 1); return; }
  const e = { id: i >= 0 ? L[i].id : 'l_' + uid(), take: t.id, date: i >= 0 ? L[i].date : new Date().toISOString(), credits: c, station: t.station || TOOLS[t.tool]?.station || '', tool: t.tool, shot: t.shot, desc: t.name };
  if (i >= 0) L[i] = e; else L.push(e);
}

/* ================= ROOMS ================= */
const Rooms = {};

/* ---------- المحطات ---------- */
Rooms.stations = () => {
  const s = S();
  const all = [...STATIONS.map(x => ({ ...x, ...stationState(x.id) })), ...s.customStations];
  const active = all.filter(x => x.on !== false);
  const monthly = {}; active.forEach(x => { const c = num(x.cost); if (c) monthly[x.currency || 'USD'] = (monthly[x.currency || 'USD'] || 0) + c; });
  const today = new Date().toISOString().slice(0, 10);
  const daysTo = d => d ? Math.round((new Date(d) - new Date(today)) / 864e5) : null;
  const soon = active.filter(x => x.renew).map(x => ({ x, d: daysTo(x.renew) })).filter(o => o.d != null && o.d >= 0).sort((a, b) => a.d - b.d)[0];
  const bal = curBalance();
  mountFn = el => {
    $$('[data-edit-st]', el).forEach(b => b.onclick = () => editStation(b.dataset.editSt));
    $('#add-st', el).onclick = () => editStation(null);
    $('#exp', el).onclick = () => download(`rabee-control-${today}.json`, JSON.stringify(S(), null, 1), 'application/json');
    $('#imp', el).onclick = async () => {
      const [f] = await pickFiles({ accept: 'application/json' }); if (!f) return;
      try { const d = JSON.parse(await f.text()); if (d.v !== 1) throw 0; R.S = { ...R.defaults(), ...d }; save(); toast('رجع المشروع ✓ (الملفات نفسها تبقى بهالمتصفح)'); rerender(); }
      catch { toast('الملف مو نسخة من غرفة الإخراج'); }
    };
  };
  return `
  <div class="room-head">
    <div><h2 class="room-title">المحطات</h2><p class="room-sub">كل اشتراك في مكان واحد: وش دوره بالمشروع، رصيده، متى يتجدد، وكم يكلف. اضغط أي محطة تفتح شغلها مباشرة.</p></div>
    <div class="toolbar"><button class="btn" id="exp">تصدير المشروع</button><button class="btn" id="imp">استيراد</button><button class="btn gold" id="add-st">+ محطة</button></div>
  </div>
  <div class="summary">
    <div class="stat"><div class="stat-k">اشتراكات فعّالة</div><div class="stat-v">${active.length}</div></div>
    <div class="stat"><div class="stat-k">التكلفة الشهرية</div><div class="stat-v">${Object.keys(monthly).length ? Object.entries(monthly).map(([c, v]) => `${fmtN(v)} <small>${c}</small>`).join(' · ') : '<small>أضف أسعارك</small>'}</div></div>
    <div class="stat"><div class="stat-k">أقرب تجديد</div><div class="stat-v">${soon ? `${soon.d} <small>يوم · ${esc(soon.x.name)}</small>` : '<small>—</small>'}</div></div>
    <div class="stat"><div class="stat-k">رصيد Higgsfield المتوقع</div><div class="stat-v">${bal == null ? '—' : fmtN(bal)} <small>كريدت</small></div></div>
  </div>
  <div class="grid stations">
    ${all.map(x => {
      const d = daysTo(x.renew);
      const tools = Object.entries(TOOLS).filter(([, t]) => t.station === x.id).map(([, t]) => t.name);
      return `<article class="card st" style="--c:${x.c || 'var(--gold)'};${x.on === false ? 'opacity:.45' : ''}">
        <div class="st-top"><div class="st-logo">${esc((x.name || '?')[0])}</div><div><div class="st-name">${esc(x.name)}</div><div class="st-role">${esc(x.role || '')}</div></div></div>
        <div class="st-meta">
          ${x.plan ? `<span class="tag gold">${esc(x.plan)}</span>` : ''}
          ${num(x.cost) ? `<span class="tag">${fmtN(+x.cost)} ${esc(x.currency || 'USD')}/شهر</span>` : ''}
          ${x.renew ? `<span class="tag ${d != null && d <= 7 ? 'warn' : ''}">يتجدد ${esc(x.renew)}${d != null && d >= 0 ? ` · ${d} يوم` : ''}</span>` : ''}
          ${num(x.credits) != null ? `<span class="tag info">${fmtN(+x.credits)} ${esc(x.unit || 'كريدت')}${x.creditsAt ? ` · ${esc(x.creditsAt)}` : ''}</span>` : ''}
          ${tools.map(t => `<span class="tag">${esc(t)}</span>`).join('')}
        </div>
        <div class="st-actions"><a class="btn sm gold" href="${esc(x.url)}" target="_blank" rel="noopener">فتح ↗</a><button class="btn sm" data-edit-st="${esc(x.id)}">تعديل</button></div>
      </article>`;
    }).join('')}
  </div>
  <p class="dimmer" style="margin-top:22px;font-size:12.5px">كل شي محفوظ بهالمتصفح بس. الصور والفيديوهات تنحفظ بـ IndexedDB، و«تصدير المشروع» ياخذ نسخة من البيانات (بدون الملفات).</p>`;
};
function editStation(id) {
  const s = S();
  const base = id ? stationById(id) : null;
  const st = id ? stationState(id) : { id: 'c_' + uid(), name: '', url: 'https://', role: '', c: '#e4c28f', plan: '', cost: '', currency: 'USD', renew: '', credits: '', creditsAt: '', on: true, custom: true };
  const isCustom = !base || st.custom;
  openDrawer(`
    <h3 class="d-title">${esc(base?.name || 'محطة جديدة')}</h3>
    <p class="dim">${esc(base?.role || 'أي اشتراك ثاني: موديل، مكتبة صوت، أداة مونتاج…')}</p>
    <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:18px">
      ${isCustom ? `<label class="field">الاسم<input class="input" name="name" value="${esc(st.name)}"></label>
      <label class="field">الرابط<input class="input ltr" name="url" value="${esc(st.url)}"></label>
      <label class="field" style="grid-column:1/-1">الدور بالمشروع<input class="input" name="role" value="${esc(st.role)}"></label>` : ''}
      <label class="field">الباقة<input class="input" name="plan" value="${esc(st.plan)}" placeholder="Pro / Ultra…"></label>
      <label class="field">التكلفة الشهرية<input class="input ltr" name="cost" inputmode="decimal" value="${esc(st.cost)}"></label>
      <label class="field">العملة<select class="input" name="currency">${['USD', 'SAR', 'AED', 'KWD', 'IQD', 'EUR'].map(c => `<option ${c === st.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="field">تاريخ التجديد<input class="input" type="date" name="renew" value="${esc(st.renew)}"></label>
      <label class="field">الرصيد الحالي<input class="input ltr" name="credits" inputmode="decimal" value="${esc(st.credits)}"></label>
      <label class="field">تاريخ الرصيد<input class="input" type="date" name="creditsAt" value="${esc((st.creditsAt || '').slice(0, 10))}"></label>
      <label class="check" style="grid-column:1/-1"><input type="checkbox" name="on" ${st.on !== false ? 'checked' : ''}>الاشتراك فعّال</label>
    </div>
    <p class="dimmer" style="font-size:12.5px">${id === 'higgsfield' ? 'لما تحدّث الرصيد من Higgsfield، غرفة الكريدت تحسب المصروف من بعد هالتاريخ بس.' : ''}</p>
    <div class="toolbar" style="margin-top:14px"><button class="btn gold" id="st-save">حفظ</button>${isCustom && id ? '<button class="btn ghost" id="st-del">حذف</button>' : ''}</div>`,
  el => {
    $('#st-save', el).onclick = () => {
      $$('[name]', el).forEach(i => { st[i.name] = i.type === 'checkbox' ? i.checked : i.value; });
      if (st.name === undefined) st.name = base?.name;
      if (!id) s.customStations.push(st);
      save(); toast('انحفظ ✓'); closeDrawer();
    };
    const del = $('#st-del', el); if (del) del.onclick = () => { s.customStations = s.customStations.filter(x => x.id !== id); save(); closeDrawer(); };
  });
}

/* ---------- التايم لاين ---------- */
const AUDIO = new Audio(); AUDIO.preload = 'auto';
let PEAKS = null, raf = null, BUF = null;
async function loadAudio() {
  if (!S().audio || AUDIO.src) return;
  const u = await Media.url('audio'); if (u) AUDIO.src = u;
}
function togglePlay() { if (!AUDIO.src) { toast('ارفع ملف الأغنية أول'); return; } AUDIO.paused ? AUDIO.play() : AUDIO.pause(); }
async function decodeAudio() {
  if (BUF) return BUF;
  const b = await Media.get('audio'); if (!b) return null;
  const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 2, 22050);
  BUF = await ctx.decodeAudioData(await b.arrayBuffer());
  return BUF;
}
async function computePeaks() {
  const buf = await decodeAudio(); if (!buf) return null;
  const ch = buf.getChannelData(0), n = 4000, step = Math.floor(ch.length / n), out = new Float32Array(n);
  for (let i = 0; i < n; i++) { let m = 0; for (let j = i * step, e = j + step; j < e; j += 4) { const v = Math.abs(ch[j]); if (v > m) m = v; } out[i] = m; }
  PEAKS = { data: out, dur: buf.duration }; return PEAKS;
}
/* tempo: onset-strength autocorrelation over 60–180 BPM */
async function detectBPM() {
  const buf = await decodeAudio(); if (!buf) return null;
  const sr = buf.sampleRate, x = buf.getChannelData(0);
  const hop = Math.round(sr * 0.01), win = hop * 2;
  const from = Math.floor(Math.min(20, buf.duration * 0.1) * sr), to = Math.floor(Math.min(buf.duration - 5, 170) * sr);
  const env = [];
  let prev = 0;
  for (let i = from; i + win < to; i += hop) { let e = 0; for (let j = 0; j < win; j++) e += x[i + j] * x[i + j]; const l = Math.log(1e-9 + e); env.push(Math.max(0, l - prev)); prev = l; }
  const mean = env.reduce((a, b) => a + b, 0) / env.length; const o = env.map(v => v - mean);
  const fps = 100, res = [];
  for (let bpm = 60; bpm <= 180; bpm += 0.25) {
    const lag = 60 * fps / bpm; let s = 0;
    for (let k = 1; k <= 4; k++) { const L = lag * k, l0 = Math.floor(L), fr = L - l0; for (let i = 0; i + l0 + 1 < o.length; i += 2) s += o[i] * (o[i + l0] * (1 - fr) + o[i + l0 + 1] * fr) / k; }
    res.push({ bpm, s });
  }
  res.sort((a, b) => b.s - a.s);
  const picks = [];
  for (const r of res) { if (picks.every(p => Math.abs(p.bpm - r.bpm) > 3)) picks.push(r); if (picks.length === 4) break; }
  const top = picks[0].s; return picks.map(p => ({ bpm: p.bpm, conf: p.s / top }));
}
let taps = [];
Rooms.timeline = () => {
  const s = S(), px = s.tl.zoom, W = Math.round(SONG * px);
  const set = setOf(), errs = continuity(), errIds = new Set(errs.map(e => e.id));
  const bl = barLen();
  const x = t => (t * px).toFixed(1);
  const ruler = []; for (let t = 0; t <= SONG; t += 1) { const major = t % 10 === 0; if (px < 4 && t % 5) continue; ruler.push(`<i class="${major ? 'major' : ''}" style="left:${x(t)}px"></i>${major ? `<span style="left:${x(t)}px">${tcShort(t)}</span>` : ''}`); }
  const bars = []; for (let t = s.bpm.offset, b = 0; t <= SONG; t += bl, b++) bars.push(`<i class="${b % 4 === 0 ? 'b4' : ''}" style="left:${x(t)}px"></i>`);
  const secs = D.sections.map((sc, i) => { const e = D.sections[i + 1]?.start ?? SONG; return `<div class="tl-blk sec" style="left:${x(sc.start)}px;width:${x(e - sc.start)}px" title="${esc(sc.name)} · ${tc(sc.start)}">${esc(sc.name)}</div>`; }).join('');
  const cues = D.cues.map(c => `<div class="tl-blk cue" style="left:${x(c.s)}px;width:${x(c.e - c.s)}px" title="${tc(c.s)} ${esc(c.t)}">${esc(c.t)}</div>`).join('');
  const shotBlocks = set.filter(sh => sh.start != null).map(sh => {
    const st = s.shots[sh.id]?.status || 'idea';
    return `<div class="tl-blk s-${st} ${errIds.has(sh.id) ? 'err' : ''}" data-shot="${sh.id}" style="left:${x(sh.start)}px;width:${x(Math.max(1, sh.end - sh.start))}px;${sh.kind === 'B' ? 'top:34px;bottom:4px;background:rgba(95,211,200,.14)' : ''}" title="${esc(sh.label)} · ${tc(sh.start)}–${tc(sh.end)}\n${esc(sh.desc)}"><span class="n">${esc(sh.label)}</span>${esc(sh.desc.split(':')[0].slice(0, 60))}</div>`;
  }).join('');
  const colors = { H: ['#3a3226', '#5a4a33', '#7a6441', '#b8955c', '#e4c28f'], W: ['#2a2a35', '#3b3b52', '#55557a', '#9e1b32'], D: ['#16222a', '#1d3340', '#244456', '#2b566b', '#337085', '#4aa3b5'] };
  const stateLane = k => SHOTS.filter(sh => sh.states[k]).map(sh => {
    const v = sh.states[k], c = colors[k][(v.b - (k === 'D' ? 0 : 1))] || '#444';
    return `<div class="st-pill" style="left:${x(sh.start)}px;width:${x(sh.end - sh.start)}px;background:${c};color:${v.b >= 3 || k === 'D' ? '#f3ece2' : '#f3ece2'}" title="${k}${v.a}${v.a !== v.b ? '→' + v.b : ''} · ${esc(STATE_TXT[k][v.b] || '')}">${k}${v.a}${v.a !== v.b ? '→' + v.b : ''}</div>`;
  }).join('');
  const lane = (label, inner, cls = '') => `<div class="tl-lane ${cls}"><div class="tl-label">${label}</div><div class="inner" style="width:${W}px">${inner}</div></div>`;
  const chorus = [55.9, 106.1], gap = chorus[1] - chorus[0];
  const intBpm = [15, 16].map(k => 240 * k / gap);
  mountFn = el => {
    loadAudio();
    const head = $('.tl-head', el), tlc = $('#tl-time', el), scroll = $('.tl-scroll', el);
    const tick = () => { head.style.transform = `translateX(${AUDIO.currentTime * px}px)`; tlc.textContent = tc(AUDIO.currentTime); if (!AUDIO.paused) { const hx = AUDIO.currentTime * px + 110; if (hx > scroll.scrollLeft + scroll.clientWidth - 60 || hx < scroll.scrollLeft) scroll.scrollLeft = hx - 160; raf = requestAnimationFrame(tick); } };
    AUDIO.onplay = () => { cancelAnimationFrame(raf); tick(); $('#play', el).textContent = '❚❚'; };
    AUDIO.onpause = () => { cancelAnimationFrame(raf); tick(); $('#play', el).textContent = '▶'; };
    AUDIO.onseeked = tick; tick();
    $('#play', el).onclick = togglePlay;
    $('#play', el).textContent = AUDIO.paused ? '▶' : '❚❚';
    $('.tl', el).addEventListener('click', ev => {
      if (ev.target.closest('[data-shot],.tl-label')) return;
      const r = $('.tl', el).getBoundingClientRect();
      const t = clamp((ev.clientX - r.left - 110) / px, 0, SONG);
      if (AUDIO.src) AUDIO.currentTime = t; else { head.style.transform = `translateX(${t * px}px)`; tlc.textContent = tc(t); }
    });
    $('#zoom', el).oninput = e => { S().tl.zoom = +e.target.value; save(); rerender(); };
    bindSeg(el, 'set', v => { S().set = v; save(); rerender(); });
    $('#aud', el).onclick = async () => {
      const [f] = await pickFiles({ accept: 'audio/*' }); if (!f) return;
      await Media.put('audio', f); S().audio = { name: f.name, size: f.size }; BUF = null; PEAKS = null; AUDIO.removeAttribute('src'); save(); toast('انرفعت الأغنية ✓'); rerender();
    };
    $('#bpm-in', el).onchange = e => { const v = num(e.target.value); if (v) { Object.assign(S().bpm, { value: v, source: 'يدوي', confirmed: false }); save(); rerender(); } };
    $('#off-in', el).onchange = e => { const v = num(e.target.value); if (v != null) { S().bpm.offset = v; save(); rerender(); } };
    $('#bpm-ok', el).onclick = () => { S().bpm.confirmed = !S().bpm.confirmed; save(); rerender(); };
    $('#tap', el).onclick = () => {
      const now = performance.now(); taps = taps.filter(t => now - t < 3000); taps.push(now);
      if (taps.length >= 4) { const iv = (taps[taps.length - 1] - taps[0]) / (taps.length - 1); $('#tap-out', el).textContent = (60000 / iv).toFixed(1) + ' BPM'; $('#tap-out', el).dataset.v = (60000 / iv).toFixed(1); }
      else $('#tap-out', el).textContent = 'كمّل… ' + taps.length;
    };
    $('#tap-use', el).onclick = () => { const v = num($('#tap-out', el).dataset.v); if (v) { Object.assign(S().bpm, { value: v, source: 'تاب يدوي', confirmed: false }); save(); rerender(); } };
    const det = $('#detect', el);
    det.onclick = async () => {
      if (!S().audio) { toast('ارفع ملف الأغنية أول'); return; }
      det.disabled = true; det.textContent = 'أحلل…';
      try {
        const r = await detectBPM();
        $('#det-out', el).innerHTML = r.map((c, i) => `<button class="btn sm ${i ? '' : 'gold'}" data-bpm="${c.bpm}">${c.bpm.toFixed(2)} <span class="dim">${Math.round(c.conf * 100)}%</span></button>`).join('');
        $$('[data-bpm]', el).forEach(b => b.onclick = () => { Object.assign(S().bpm, { value: +b.dataset.bpm, source: 'تحليل الصوت', confirmed: false }); save(); rerender(); });
      } catch (err) { toast('ما قدرت أحلل الملف'); }
      det.disabled = false; det.textContent = 'حلل من الصوت';
    };
    (async () => {
      if (!S().audio) return;
      const p = PEAKS || await computePeaks().catch(() => null); if (!p) return;
      const cv = $('canvas.wave', el); if (!cv) return;
      const w = Math.round(p.dur * px), h = 70, dpr = devicePixelRatio || 1;
      cv.width = w * dpr; cv.height = h * dpr; cv.style.width = w + 'px';
      const g = cv.getContext('2d'); g.scale(dpr, dpr); g.fillStyle = 'rgba(228,194,143,.55)';
      for (let i = 0; i < w; i++) { const v = p.data[Math.floor(i / w * p.data.length)] || 0; const hh = Math.max(1, v * (h - 8)); g.fillRect(i, (h - hh) / 2, 1, hh); }
    })();
  };
  return `
  <div class="room-head">
    <div><h2 class="room-title">التايم لاين</h2><p class="room-sub">الأغنية، الأقسام، الكلمات، اللقطات، وحالات الراكور H/W/D على نفس المسطرة. المنطقة المخططة = الأحمر ممنوع قبل 2:46. اضغط أي لقطة تفتحها.</p></div>
    <div class="toolbar">${segHTML('set', [['v7', 'v7 · 30 لقطة'], ['v71', 'v7.1 · لقطات طويلة']], s.set)}</div>
  </div>
  <div class="tl-wrap">
    <div class="tl-controls">
      <button class="btn gold" id="play" aria-label="تشغيل">▶</button>
      <div class="tl-time" id="tl-time">0:00.0</div>
      <button class="btn sm" id="aud">${s.audio ? '↻ ' + esc(s.audio.name) : '+ ارفع v44.mp3'}</button>
      <label class="dim" style="display:flex;align-items:center;gap:8px;font-size:12.5px;margin-inline-start:auto">تكبير<input type="range" id="zoom" min="3" max="24" step="1" value="${px}"></label>
    </div>
    <div class="tl-scroll"><div class="tl" style="width:${W + 110}px">
      <div class="tl-red" style="left:110px;width:${x(RED_AT)}px"></div>
      <div class="tl-redline" style="left:${110 + RED_AT * px}px" title="2:46 — الأحمر يبدأ"></div>
      <div class="tl-lane" style="height:28px"><div class="tl-label">الزمن</div><div class="inner tl-ruler" style="width:${W}px">${ruler.join('')}</div></div>
      ${s.audio ? lane('الصوت', '<canvas class="wave"></canvas>', 'wave') : ''}
      ${lane(`المازورات <span class="mono" style="margin-inline-start:4px">${bl.toFixed(2)}ث</span>`, `<div class="tl-bars">${bars.join('')}</div>`)}
      ${lane('الأقسام', secs)}
      ${lane('الكلمات', cues)}
      ${lane(s.set === 'v71' ? 'اللقطات الطويلة' : 'اللقطات', shotBlocks, 'tall')}
      ${lane('H الشعر', stateLane('H'))}
      ${lane('W السوستة', stateLane('W'))}
      ${lane('D المي', stateLane('D'))}
      <div class="tl-head"></div>
    </div></div>
    <div class="legend">
      <span><i style="background:rgba(127,209,164,.5)"></i>معتمد</span><span><i style="background:rgba(143,184,255,.45)"></i>مرشّح</span>
      <span><i style="background:rgba(240,182,90,.4)"></i>قيد التحضير</span><span><i style="background:rgba(255,106,106,.45)"></i>يتعاد</span>
      <span><i style="background:var(--crimson)"></i>2:46 الأحمر</span><span class="dimmer">مسافة = تشغيل/إيقاف</span>
    </div>
  </div>

  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));margin-top:16px">
    <div class="card">
      <div class="sec-h" style="margin-top:0">الإيقاع — قبل ما تتحدد مدة أي لقطة</div>
      <div class="toolbar" style="margin-bottom:12px">
        <label class="field" style="width:110px">BPM<input class="input ltr" id="bpm-in" value="${s.bpm.value}"></label>
        <label class="field" style="width:130px">أول ضربة (ث)<input class="input ltr" id="off-in" value="${s.bpm.offset}"></label>
        <button class="btn ${s.bpm.confirmed ? 'gold' : ''}" id="bpm-ok" style="align-self:flex-end">${s.bpm.confirmed ? '✓ مؤكد' : 'أكّد الإيقاع'}</button>
      </div>
      <p class="dim" style="font-size:13px;margin:0 0 10px">المصدر: ${esc(s.bpm.source)} · المازورة ${bl.toFixed(3)} ث</p>
      <div class="note ${Math.abs(gap / bl - Math.round(gap / bl)) > 0.15 ? 'warn' : 'ok'}" style="margin-bottom:12px">
        بين الكورس الأول (0:55.9) والثاني (1:46.1) = <b class="mono">${gap.toFixed(2)}</b> ث = <b class="mono">${(gap / bl).toFixed(2)}</b> مازورة على ${fmtN(s.bpm.value)} BPM.
        ${Math.abs(gap / bl - Math.round(gap / bl)) > 0.15 ? `رقم مو صحيح — الإيقاع غالباً غلط. اللي يعطي مازورات كاملة: <span class="mono">${intBpm.map(v => v.toFixed(2)).join(' أو ')}</span>` : 'مازورات كاملة ✓'}
      </div>
      <div class="toolbar"><button class="btn" id="detect">حلل من الصوت</button><span id="det-out" class="toolbar"></span></div>
      <div class="toolbar" style="margin-top:10px"><button class="btn" id="tap">تاب مع الضربة</button><span id="tap-out" class="mono dim">اضغط 4 مرات أو أكثر</span><button class="btn sm ghost" id="tap-use">استخدم</button></div>
    </div>
    <div class="card">
      <div class="sec-h" style="margin-top:0">الراكور — ${errs.length ? `<span class="tag bad">${errs.length} خطأ</span>` : '<span class="tag ok">سليم</span>'}</div>
      ${errs.length ? `<table class="t"><tbody>${errs.map(e => `<tr data-shot="${e.id}" style="cursor:pointer"><td class="mono">${esc(shotById(e.id)?.label)}</td><td>${esc(e.msg)}</td></tr>`).join('')}</tbody></table>`
        : '<p class="dim" style="margin:0">الشعر والسوستة ماشيين لقدام بس، والأحمر ما يطلع قبل 2:46. الفحص يشمل نتائج تحليل الكادرات بغرفة الفحص.</p>'}
      <div class="sec-h">المفتاح</div>
      <dl class="kv" style="font-size:12.5px">${['H', 'W', 'D'].map(k => `<dt>${k}</dt><dd>${Object.entries(STATE_TXT[k]).map(([n, t]) => `<span class="mono">${k}${n}</span> ${esc(t)}`).join(' · ')}</dd>`).join('')}</dl>
    </div>
  </div>`;
};

/* ---------- الستوري بورد ---------- */
let sbFilter = 'all';
Rooms.storyboard = () => {
  const s = S(), set = setOf();
  const counts = {}; set.forEach(sh => { const st = s.shots[sh.id]?.status || 'idea'; counts[st] = (counts[st] || 0) + 1; });
  const list = set.filter(sh => sbFilter === 'all' || (s.shots[sh.id]?.status || 'idea') === sbFilter);
  mountFn = el => {
    bindSeg(el, 'set', v => { S().set = v; save(); rerender(); });
    $$('[data-filter]', el).forEach(b => b.onclick = () => { sbFilter = b.dataset.filter; rerender(); });
    $('#locks', el).onclick = openLocks;
  };
  return `
  <div class="room-head">
    <div><h2 class="room-title">الستوري بورد</h2><p class="room-sub">كل لقطة بكادر البداية والنهاية والحالة. الشريط الذهبي = بوابة الجاهزية (8 شروط). <b>لا توليد فيديو قبل ما تكتمل.</b></p></div>
    <div class="toolbar">${segHTML('set', [['v7', 'v7 · 30'], ['v71', 'v7.1 · طويلة']], s.set)}<button class="btn" id="locks">أقفال الإخراج</button></div>
  </div>
  <div class="status-strip">
    <button class="btn sm ${sbFilter === 'all' ? 'gold' : ''}" data-filter="all">الكل ${set.length}</button>
    ${Object.keys(STATUS).filter(k => counts[k]).map(k => `<button class="btn sm ${sbFilter === k ? 'gold' : ''}" data-filter="${k}">${STATUS[k].t} ${counts[k]}</button>`).join('')}
  </div>
  <div class="grid sb">
    ${list.map(sh => {
      const st = shotState(sh.id), g = gateOf(sh.id);
      const est = estimateShot(sh);
      const appr = st.approved && s.takes[st.approved];
      return `<article class="card shot" data-shot="${sh.id}" tabindex="0">
        <div class="shot-frames">
          <div>${st.start && s.takes[st.start] ? mediaTag(st.start, s.takes[st.start].kind) : 'بداية'}<span class="lbl">بداية</span></div>
          <div>${appr ? mediaTag(st.approved, appr.kind) : st.end && s.takes[st.end] ? mediaTag(st.end, s.takes[st.end].kind) : 'نهاية'}<span class="lbl">${appr ? 'المعتمد' : 'نهاية'}</span></div>
        </div>
        <div class="shot-body">
          <div class="shot-hd"><span class="shot-n">${esc(sh.label)}</span><span class="shot-tc">${tc(sh.start)}–${tc(sh.end)} · ${(sh.end - sh.start).toFixed(1)}ث</span></div>
          <div class="ready" title="جاهزية ${gateScore(sh.id)}/8">${GATE.map(([k]) => `<i class="${g[k] ? 'on' : ''}"></i>`).join('')}</div>
          <div class="shot-lyric">${esc(sh.lyric)}</div>
          <div class="shot-desc">${esc(sh.desc)}</div>
          <div class="shot-ft">${statusTag(st.status)}${stateTags(sh)}<span class="tag gold">${esc(TOOLS[st.tool]?.name || st.tool)}</span>${st.takes.length ? `<span class="tag">${st.takes.length} محاولة</span>` : ''}${st.fails >= 2 ? '<span class="tag bad">فشلت مرتين</span>' : ''}<span class="tag" title="تقدير">~${est.c}${est.unknown ? '+؟' : ''} كريدت</span></div>
        </div>
      </article>`;
    }).join('')}
  </div>`;
};
function openLocks() {
  const L = S().locks;
  openDrawer(`<h3 class="d-title">أقفال الإخراج</h3><p class="dim">تنحط تلقائياً بكل برومبت. عدّلها هنا مرة وحدة وتمشي على كل اللقطات.</p>
    <div class="grid" style="margin-top:16px">
      <label class="field">سطر الهوية (أول البرومبت دايماً)<textarea class="input ltr" name="identity">${esc(L.identity)}</textarea></label>
      <label class="field">اللبس الأسود — قبل 2:46 (طبقات كاملة)<textarea class="input ltr" name="black">${esc(L.black)}</textarea></label>
      <label class="field">اللبس القرمزي — من 2:46<textarea class="input ltr" name="crimson">${esc(L.crimson)}</textarea></label>
      <label class="field">الإكسسوار بالنفي<textarea class="input ltr" name="accessories" style="min-height:60px">${esc(L.accessories)}</textarea></label>
    </div>
    <div class="note warn" style="margin-top:14px">غلطة 6: كلمة jacket لحالها = بليزر. خلّ الوصف دايماً: light, short, youthful, collarless, zip-front, matte.</div>
    <div class="toolbar" style="margin-top:14px"><button class="btn gold" id="lk-save">حفظ</button></div>`,
  el => { $('#lk-save', el).onclick = () => { $$('[name]', el).forEach(i => L[i.name] = i.value); save(); toast('انحفظت الأقفال ✓'); closeDrawer(); }; });
}

/* ---------- shot drawer ---------- */
function openShot(id) {
  const sh = shotById(id); if (!sh) return;
  const gateHTML = () => {
    const st = shotState(id), g = gateOf(id), score = gateScore(id);
    return `<div class="sec-h">بوابة الجاهزية <span class="tag ${score === 8 ? 'ok' : 'warn'}">${score}/8</span></div>
    <div class="gate">${GATE.map(([k, t]) => k === 'refs'
      ? `<label class="check"><input type="checkbox" data-f="refs" ${st.refs ? 'checked' : ''}>${t} <span class="dimmer" style="font-size:12px">— FACE أول واحد دايماً</span></label>`
      : `<div class="check" style="cursor:default"><input type="checkbox" disabled ${g[k] ? 'checked' : ''}>${t}</div>`).join('')}</div>`;
  };
  const promptHTML = () => {
    const st = shotState(id), score = gateScore(id), P = buildPrompt(id), tool = TOOLS[st.tool];
    const locked = tool.kind === 'video' && score < 8, station = stationById(tool.station);
    return `<div class="sec-h">البرومبت — ${esc(tool.name)} <span class="dimmer mono">${P.words} كلمة</span></div>
    ${P.warns.map(w => `<div class="note warn" style="margin-bottom:8px">${esc(w)}</div>`).join('')}
    <div class="prompt-box" id="pbox">${esc(P.prompt)}</div>
    <div class="dim" style="font-size:12.5px;margin:8px 0">المدخلات بالترتيب: ${P.inputs.map(i => `<span class="tag">${esc(i)}</span>`).join(' ')}</div>
    ${locked ? `<div class="note bad">البوابة ${score}/8 — النسخ والتوليد مقفولين لين تكتمل اللقطة. (صور البداية والنهاية تقدر تولدها من أداة الصور.)</div>` : ''}
    <div class="toolbar" style="margin-top:10px">
      <button class="btn gold" data-copy ${locked ? 'disabled' : ''}>انسخ البرومبت</button>
      ${station ? `<a class="btn" href="${esc(station.url)}" target="_blank" rel="noopener" ${locked ? 'aria-disabled="true" style="pointer-events:none;opacity:.4"' : ''}>افتح ${esc(station.name)} ↗</a>` : ''}
      <button class="btn ghost" data-frameprompt>برومبت صورة الكادر</button>
    </div>`;
  };
  const draw = () => {
    const s = S(), st = shotState(id), g = gateOf(id), score = gateScore(id);
    const P = buildPrompt(id), tool = TOOLS[st.tool];
    const isVideo = tool.kind === 'video';
    const locked = isVideo && score < 8;
    const bl = barLen(), dur = sh.end - sh.start, sugBars = Math.max(1, Math.round(dur / bl));
    const station = stationById(tool.station);
    const takes = st.takes.map(t => s.takes[t]).filter(Boolean);
    const slot = (role, label) => {
      const tid = st[role], t = tid && s.takes[tid];
      return `<div class="slot ${t ? 'has' : ''}" data-slot="${role}">${t ? mediaTag(tid, t.kind) + `<span class="lbl">${label}</span><button class="x" data-unslot="${role}" aria-label="شيل">✕</button>` : `+ ${label}<br><span class="dimmer">ارفع صورة أو اختار من المحاولات</span>`}</div>`;
    };
    return `
    <div class="dim mono">${sh.set === 'v71' ? 'v7.1 · ' + esc(sh.time) : 'v7'} · ${tc(sh.start)}–${tc(sh.end)} · ${dur.toFixed(1)} ث ≈ ${(dur / bl).toFixed(1)} مازورة</div>
    <h3 class="d-title">لقطة ${esc(sh.label)}</h3>
    <div class="shot-lyric" style="font-size:18px;margin:4px 0 10px">${esc(sh.lyric)}</div>
    <p style="margin:0 0 12px;color:#d8d0c4">${esc(sh.desc)}</p>
    ${sh.covers ? `<p class="dim" style="font-size:12.5px">تجمع لقطات v7: ${sh.covers.map(c => `<a href="#" data-goto="${c}">${esc(shotById(c).label)}</a>`).join(' · ')} · الكاميرا: ${esc(sh.camera)}</p>` : ''}
    <div class="shot-ft" style="margin-bottom:16px">${stateTags(sh)}${['H', 'W', 'D'].filter(k => sh.states[k]).map(k => `<span class="dim" style="font-size:12px">${k}: ${esc(STATE_TXT[k][sh.states[k].b] || '')}</span>`).join(' · ')}</div>

    <div class="toolbar" style="margin-bottom:6px">
      <label class="field" style="width:170px">الحالة<select class="input" data-f="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === st.status ? 'selected' : ''}>${v.t}</option>`).join('')}</select></label>
      <label class="field" style="width:200px">الأداة<select class="input" data-f="tool">${Object.entries(TOOLS).map(([k, v]) => `<option value="${k}" ${k === st.tool ? 'selected' : ''}>${v.name}${v.cost != null ? ` · ${v.cost}${v.est ? '~' : ''}` : ' · ؟'}</option>`).join('')}</select></label>
      ${st.fails ? `<span class="tag ${st.fails >= 2 ? 'bad' : 'warn'}" style="align-self:flex-end;margin-bottom:8px">فشل ${st.fails}×</span>` : ''}
    </div>
    ${tool.note ? `<p class="dimmer" style="font-size:12.5px;margin:0 0 6px">${esc(tool.note)}</p>` : ''}
    ${st.fails >= 2 ? `<div class="note bad" style="margin:10px 0">فشلت مرتين → <b>خطة الإنقاذ</b>: صور + مونتاج بدل فيديو. <button class="btn sm" data-rescue>حوّلها لصور + مونتاج</button></div>` : ''}

    <div id="gatebox">${gateHTML()}</div>

    <div class="cols" style="margin-top:12px">${slot('start', 'صورة البداية')}${slot('end', 'صورة النهاية')}</div>

    <div class="grid" style="margin-top:14px">
      <label class="field">الفعل الواحد<input class="input" data-f="action" value="${esc(st.action)}" placeholder="مثال: she lowers one foot into the water onto a hidden stone"></label>
      <label class="field">وصف الكادر والكاميرا (بالكلام مو بالعدسة)<input class="input" data-f="camera" value="${esc(st.camera)}" placeholder="side view at water level, she is small in the frame"></label>
      <div class="cols">
        <label class="field">المدة بالمازورات <span class="dimmer">المقترح ${sugBars} (${(sugBars * bl).toFixed(1)} ث)</span><input class="input ltr" data-f="bars" inputmode="decimal" value="${esc(st.bars)}" placeholder="${sugBars}"></label>
        <label class="field">المعنى<input class="input" data-f="meaning" value="${esc(st.meaning)}" placeholder="الثقة الأولى"></label>
      </div>
      ${st.tool === 'H3' ? `<label class="field">الصوت (اختياري)<input class="input ltr" data-f="sound" value="${esc(st.sound)}" placeholder="soft breath, one drop"></label>` : ''}
    </div>

    <div id="promptzone">${promptHTML()}</div>

    <div class="sec-h">المحاولات <span class="dimmer mono">${takes.length}</span></div>
    <div class="takes">${takes.map(t => `<div class="card gi" data-take="${t.id}" style="padding:0"><div class="gi-media">${mediaTag(t.id, t.kind)}${t.id === st.approved ? '<span class="badge tag ok">معتمد</span>' : t.qc?.verdict === 'redo' ? '<span class="badge tag bad">يتعاد</span>' : ''}</div><div class="gi-body"><div class="gi-t">${esc(t.name)}</div></div></div>`).join('')}
      <div class="drop" data-addtake style="display:grid;place-items:center;min-height:100px">+ محاولة<br><span class="dimmer" style="font-size:12px">فيديو أو صورة</span></div></div>
    <label class="field" style="margin-top:16px">ملاحظات<textarea class="input" data-f="notes">${esc(st.notes)}</textarea></label>`;
  };
  const mount = el => {
    const st = shotState(id);
    $$('[data-f]', el).forEach(i => {
      const ev = i.tagName === 'SELECT' || i.type === 'checkbox' ? 'change' : 'input';
      i.addEventListener(ev, () => {
        st[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.value; save();
        if (i.tagName === 'SELECT') refresh(); else softRefresh(el);
      });
    });
    bindPrompt(el);
    $$('[data-goto]', el).forEach(a => a.onclick = e => { e.preventDefault(); openShot(a.dataset.goto); });
    const rescue = $('[data-rescue]', el); if (rescue) rescue.onclick = () => { st.tool = 'Montage'; st.status = 'rescue'; save(); refresh(); };
    $$('[data-unslot]', el).forEach(b => b.onclick = e => { e.stopPropagation(); st[b.dataset.unslot] = null; save(); refresh(); });
    $$('[data-slot]', el).forEach(sl => sl.onclick = async e => {
      if (e.target.closest('[data-unslot]')) return;
      const role = sl.dataset.slot;
      const imgs = Object.values(S().takes).filter(t => t.shot === id && t.kind === 'image' && t.id !== st.start && t.id !== st.end);
      if (imgs.length && !confirm('تبي تختار من صور هاللقطة؟ (إلغاء = رفع ملف جديد)')) { /* fall through to upload */ }
      else if (imgs.length) { st[role] = imgs[imgs.length - 1].id; save(); refresh(); return; }
      const [f] = await pickFiles({ accept: 'image/*' }); if (!f) return;
      const [tid] = await addTakes([f], { shot: id, role, tool: 'Image', station: 'higgsfield' });
      st[role] = tid; if (st.status === 'idea' || st.status === 'written') st.status = (st.start && st.end) ? 'frames' : st.status; save(); refresh();
    });
    $('[data-addtake]', el).onclick = async () => {
      const fs = await pickFiles({ multiple: true }); if (!fs.length) return;
      await addTakes(fs, { shot: id, tool: st.tool, station: TOOLS[st.tool]?.station });
      if (['idea', 'written', 'frames'].includes(st.status)) st.status = 'candidate'; save(); refresh(); toast('انضافت المحاولة — حط الكريدت من بطاقتها');
    };
  };
  const bindPrompt = el => {
    const st = shotState(id);
    $('[data-copy]', el).onclick = () => copy(buildPrompt(id).prompt);
    $('[data-frameprompt]', el).onclick = () => { const t = st.tool; st.tool = 'Image'; const p = buildPrompt(id).prompt; st.tool = t; copy(p); };
  };
  const softRefresh = el => {
    $('#gatebox', el).innerHTML = gateHTML();
    $('#promptzone', el).innerHTML = promptHTML();
    const r = $('#gatebox [data-f="refs"]', el); if (r) r.onchange = () => { shotState(id).refs = r.checked; save(); softRefresh(el); };
    bindPrompt(el);
  };
  const refresh = () => { const y = $('.drawer-panel').scrollTop; openDrawer(draw(), mount, refresh); $('.drawer-panel').scrollTop = y; };
  openDrawer(draw(), mount, refresh);
}

/* ---------- take drawer ---------- */
function openTake(tid) {
  const t = S().takes[tid]; if (!t) return;
  const opts = (sel) => `<option value="">—</option>` + ALL.map(sh => `<option value="${sh.id}" ${sh.id === sel ? 'selected' : ''}>${sh.set === 'v71' ? 'طويلة ' : ''}${esc(sh.label)} · ${tc(sh.start, 0)}</option>`).join('');
  const destOk = d => specCheck(t, d);
  openDrawer(`
    <div class="dim mono">${esc(t.kind === 'video' ? 'فيديو' : 'صورة')}${t.w ? ` · ${t.w}×${t.h}` : ''}${t.dur ? ` · ${t.dur.toFixed(1)} ث` : ''}${t.size ? ` · ${(t.size / 1048576).toFixed(1)} MB` : ''}</div>
    <h3 class="d-title ltr" style="text-align:right;font-size:18px;word-break:break-all">${esc(t.name)}</h3>
    <div style="margin:12px 0;border-radius:12px;overflow:hidden;background:#000">${t.kind === 'video' ? `<video data-media="${tid}" controls playsinline style="width:100%;max-height:52vh;display:block"></video>` : `<img data-media="${tid}" style="width:100%;max-height:52vh;object-fit:contain;display:block" alt="">`}</div>
    <div class="grid" style="grid-template-columns:1fr 1fr">
      <label class="field">اللقطة<select class="input" data-t="shot">${opts(t.shot)}</select></label>
      <label class="field">الدور<select class="input" data-t="role">${[['take', 'محاولة'], ['start', 'صورة بداية'], ['end', 'صورة نهاية'], ['final', 'نسخة نهائية للنشر']].map(([k, v]) => `<option value="${k}" ${k === t.role ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field">الأداة<select class="input" data-t="tool"><option value="">—</option>${Object.entries(TOOLS).map(([k, v]) => `<option value="${k}" ${k === t.tool ? 'selected' : ''}>${v.name}</option>`).join('')}</select></label>
      <label class="field">المحطة<select class="input" data-t="station"><option value="">—</option>${[...STATIONS, ...S().customStations].map(x => `<option value="${x.id}" ${x.id === t.station ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <label class="field">الكريدت المصروف<input class="input ltr" data-t="credits" inputmode="decimal" value="${esc(t.credits)}" placeholder="${TOOLS[t.tool]?.cost ?? ''}"></label>
      <label class="field">ملاحظة<input class="input" data-t="note" value="${esc(t.note)}"></label>
    </div>
    <div class="sec-h">وين تنشر</div>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:0 14px">${DESTS.map(d => { const c = destOk(d); return `<label class="check"><input type="checkbox" data-dest="${d.id}" ${t.dests?.includes(d.id) ? 'checked' : ''}>${esc(d.name)} ${t.dests?.includes(d.id) ? `<span class="tag ${c.ok ? 'ok' : 'warn'}">${esc(c.msg)}</span>` : ''}</label>`; }).join('')}</div>
    ${t.qc ? `<div class="sec-h">آخر فحص</div><div class="note ${t.qc.verdict === 'ok' ? 'ok' : t.qc.verdict === 'redo' ? 'bad' : ''}">${t.qc.verdict === 'ok' ? 'معتمد' : t.qc.verdict === 'redo' ? 'يتعاد: ' + esc(t.qc.reason || '') : 'بدون حكم'}${t.qc.metrics ? ` · أحمر ${(t.qc.metrics.red * 100).toFixed(1)}% · تركواز ${(t.qc.metrics.teal * 100).toFixed(1)}%` : ''}</div>` : ''}
    <div class="toolbar" style="margin-top:18px">
      <button class="btn gold" data-nav="qc" data-arg="${tid}">افحص ضد المرجع</button>
      ${t.shot ? `<button class="btn" data-openshot>افتح اللقطة</button>` : ''}
      ${t.url ? `<a class="btn" href="${esc(t.url)}" target="_blank" rel="noopener">الرابط ↗</a>` : ''}
      <button class="btn ghost" data-del style="margin-inline-start:auto;color:var(--bad)">حذف</button>
    </div>`,
  el => {
    $$('[data-t]', el).forEach(i => i.addEventListener('change', () => {
      const k = i.dataset.t, old = t[k]; t[k] = i.value;
      if (k === 'shot') {
        if (old) { const o = shotState(old); o.takes = o.takes.filter(x => x !== tid); ['start', 'end'].forEach(r => { if (o[r] === tid) o[r] = null; }); if (o.approved === tid) o.approved = null; }
        if (t.shot) { const n = shotState(t.shot); if (!n.takes.includes(tid)) n.takes.push(tid); }
      }
      if (k === 'role' && t.shot && (t.role === 'start' || t.role === 'end')) shotState(t.shot)[t.role] = tid;
      if (k === 'tool' && !t.station) t.station = TOOLS[t.tool]?.station || '';
      syncLedger(t); save(); openTake(tid);
    }));
    $$('[data-dest]', el).forEach(c => c.onchange = () => { t.dests = t.dests || []; if (c.checked) t.dests.push(c.dataset.dest); else t.dests = t.dests.filter(x => x !== c.dataset.dest); save(); openTake(tid); });
    const os = $('[data-openshot]', el); if (os) os.onclick = () => openShot(t.shot);
    $('[data-del]', el).onclick = async () => {
      if (!confirm('تحذف هالملف من الغرفة؟')) return;
      if (t.shot) { const o = shotState(t.shot); o.takes = o.takes.filter(x => x !== tid); ['start', 'end', 'approved'].forEach(r => { if (o[r] === tid) o[r] = null; }); }
      S().ledger = S().ledger.filter(e => e.take !== tid);
      delete S().takes[tid]; if (t.key) await Media.del(t.key); save(); closeDrawer();
    };
  });
}
function specCheck(t, d) {
  if (!t.w || !t.h) return { ok: false, msg: 'المقاس غير معروف' };
  const want = d.ratio[0] / d.ratio[1], got = t.w / t.h;
  if (Math.abs(want - got) > 0.02) return { ok: false, msg: `النسبة ${t.w}×${t.h} مو ${d.ratio.join(':')}` };
  if (d.image && t.kind !== 'image') return { ok: false, msg: 'لازم صورة' };
  if (d.minW && t.w < d.minW) return { ok: false, msg: `أقل من ${d.minW}px` };
  if (d.minD && t.dur != null && (t.dur < d.minD || t.dur > d.maxD)) return { ok: false, msg: `المدة ${t.dur.toFixed(1)} ث (المطلوب ${d.minD}–${d.maxD})` };
  if (d.fullSong && t.dur != null && t.dur < SONG - 2) return { ok: false, msg: `أقصر من الأغنية (${tc(t.dur, 0)})` };
  return { ok: true, msg: 'المواصفات ✓' };
}

/* ---------- الفحص ---------- */
const QC = { mode: 'wipe', ref: null, cand: null, wipe: 0.5, time: 0 };
function analyze(srcEl) {
  const w = 160, h = Math.max(1, Math.round(w * (srcEl.videoHeight || srcEl.naturalHeight || 9) / (srcEl.videoWidth || srcEl.naturalWidth || 16)));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(srcEl, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data; // throws on tainted canvas
  let red = 0, teal = 0, lum = 0, n = 0; const px = [];
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), v = mx, s = mx ? (mx - mn) / mx : 0;
    let hue = 0; if (mx !== mn) { if (mx === r) hue = 60 * (((gg - b) / (mx - mn)) % 6); else if (mx === gg) hue = 60 * ((b - r) / (mx - mn) + 2); else hue = 60 * ((r - gg) / (mx - mn) + 4); } if (hue < 0) hue += 360;
    if ((hue >= 340 || hue <= 12) && s > 0.45 && v > 0.18) red++;
    if (hue >= 165 && hue <= 195 && s > 0.3 && v > 0.25) teal++;
    lum += 0.2126 * r + 0.7152 * gg + 0.0722 * b; n++;
    if ((i / 4) % 3 === 0) px.push([d[i], d[i + 1], d[i + 2]]);
  }
  return { red: red / n, teal: teal / n, lum: lum / n, palette: kmeans(px, 5) };
}
function kmeans(px, k) {
  let cs = Array.from({ length: k }, (_, i) => px[Math.floor((i + 0.5) * px.length / k)].slice());
  for (let it = 0; it < 8; it++) {
    const sum = cs.map(() => [0, 0, 0, 0]);
    for (const p of px) { let bi = 0, bd = 1e9; cs.forEach((c, i) => { const dd = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2; if (dd < bd) { bd = dd; bi = i; } }); const s = sum[bi]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; }
    cs = sum.map((s, i) => s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3], s[3]] : cs[i]);
  }
  return cs.map(c => ({ rgb: c.slice(0, 3).map(Math.round), w: (c[3] || 0) / px.length })).sort((a, b) => b.w - a.w);
}
function lab([r, g, b]) {
  const f = c => { c /= 255; return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92; };
  const R = f(r), G = f(g), B = f(b);
  const X = (R * .4124 + G * .3576 + B * .1805) / .95047, Y = R * .2126 + G * .7152 + B * .0722, Z = (R * .0193 + G * .1192 + B * .9505) / 1.08883;
  const h = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  return [116 * h(Y) - 16, 500 * (h(X) - h(Y)), 200 * (h(Y) - h(Z))];
}
function paletteMatch(a, b) {
  const la = a.map(p => ({ l: lab(p.rgb), w: p.w })), lb = b.map(p => lab(p.rgb));
  let d = 0; for (const p of la) d += p.w * Math.min(...lb.map(q => Math.hypot(p.l[0] - q[0], p.l[1] - q[1], p.l[2] - q[2])));
  return clamp(1 - d / 60, 0, 1);
}
function loadEl(m, kind) {
  return new Promise(async res => {
    const u = await srcOf(m); if (!u) return res(null);
    const el = document.createElement(kind === 'video' ? 'video' : 'img');
    if (m.url) el.crossOrigin = 'anonymous';
    if (kind === 'video') { el.muted = true; el.playsInline = true; el.preload = 'auto'; el.onloadeddata = () => res(el); }
    else el.onload = () => res(el);
    el.onerror = () => res(null); el.src = u;
  });
}
Rooms.qc = arg => {
  const s = S();
  if (arg && s.takes[arg]) QC.cand = arg;
  const cand = QC.cand && s.takes[QC.cand];
  const sh = cand?.shot && shotById(cand.shot);
  const refChoices = [...REF_SLOTS.map(([k, t]) => ({ id: 'ref:' + k, label: k, title: t, m: s.refs[k], kind: s.refs[k]?.kind || 'image' })),
    ...(sh ? ['start', 'end'].map(r => shotState(sh.id)[r]).filter(Boolean).map(tid => ({ id: tid, label: tid === shotState(sh.id).start ? 'بداية ' + sh.label : 'نهاية ' + sh.label, m: s.takes[tid], kind: s.takes[tid]?.kind })) : [])];
  if (!QC.ref || !refChoices.find(r => r.id === QC.ref && r.m)) QC.ref = (refChoices.find(r => r.m && (sh && r.id === shotState(sh.id).start)) || refChoices.find(r => r.m))?.id || null;
  const takes = Object.values(s.takes).sort((a, b) => (b.created || '').localeCompare(a.created || ''));
  const qc = cand?.qc || {};
  mountFn = el => {
    $$('[data-refslot]', el).forEach(b => b.onclick = async () => {
      const k = b.dataset.refslot;
      if (s.refs[k] && QC.ref !== 'ref:' + k) { QC.ref = 'ref:' + k; rerender(); return; }
      const [f] = await pickFiles({ accept: 'image/*' }); if (!f) return;
      const meta = await probe(f); await Media.put('ref_' + k, f); s.refs[k] = { key: 'ref_' + k, kind: 'image', w: meta.w, h: meta.h, name: f.name };
      QC.ref = 'ref:' + k; save(); rerender();
    });
    $$('[data-refpick]', el).forEach(b => b.onclick = () => { QC.ref = b.dataset.refpick; rerender(); });
    $$('[data-candpick]', el).forEach(b => b.onclick = () => { QC.cand = b.dataset.candpick; QC.time = 0; nav('qc', QC.cand); });
    bindSeg(el, 'qcmode', v => { QC.mode = v; paint(); $$('[data-seg="qcmode"]', el).forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v)); });
    const addc = $('#qc-add', el); if (addc) addc.onclick = async () => { const fs = await pickFiles({ multiple: true }); if (!fs.length) return; const ids = await addTakes(fs); QC.cand = ids[0]; nav('qc', ids[0]); };
    let refEl = null, candEl = null;
    const viewer = $('.viewer', el);
    const paint = () => {
      if (!viewer) return;
      const W = viewer.clientWidth, H = viewer.clientHeight, dpr = devicePixelRatio || 1;
      const fit = (img, cw, ch) => { const iw = img.videoWidth || img.naturalWidth, ih = img.videoHeight || img.naturalHeight; const sc = Math.min(cw / iw, ch / ih); return [(cw - iw * sc) / 2, (ch - ih * sc) / 2, iw * sc, ih * sc]; };
      const prep = (cv, w, h) => { cv.width = w * dpr; cv.height = h * dpr; const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, w, h); return g; };
      viewer.querySelectorAll('canvas,.side,.wipe-h').forEach(n => n.remove());
      if (QC.mode === 'side') {
        const side = document.createElement('div'); side.className = 'side';
        const a = document.createElement('canvas'), b = document.createElement('canvas'); side.append(b, a); viewer.append(side);
        const w = (W - 2) / 2;
        const ga = prep(a, w, H), gb = prep(b, w, H);
        if (refEl) ga.drawImage(refEl, ...fit(refEl, w, H));
        if (candEl) gb.drawImage(candEl, ...fit(candEl, w, H));
        a.style.width = b.style.width = '100%'; a.style.height = b.style.height = '100%';
        return;
      }
      const cv = document.createElement('canvas'); viewer.append(cv);
      const g = prep(cv, W, H);
      if (QC.mode === 'wipe') {
        if (candEl) g.drawImage(candEl, ...fit(candEl, W, H));
        if (refEl) { g.save(); g.beginPath(); g.rect(0, 0, W * QC.wipe, H); g.clip(); g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.drawImage(refEl, ...fit(refEl, W, H)); g.restore(); }
        const hdl = document.createElement('div'); hdl.className = 'wipe-h'; hdl.style.left = `calc(${QC.wipe * 100}% - 1px)`; viewer.append(hdl);
      } else if (QC.mode === 'onion') {
        if (refEl) g.drawImage(refEl, ...fit(refEl, W, H));
        if (candEl) { g.globalAlpha = 0.5; g.drawImage(candEl, ...fit(candEl, W, H)); g.globalAlpha = 1; }
      } else if (QC.mode === 'diff') {
        if (refEl) g.drawImage(refEl, ...fit(refEl, W, H));
        if (candEl) { g.globalCompositeOperation = 'difference'; g.drawImage(candEl, ...fit(candEl, W, H)); g.globalCompositeOperation = 'source-over'; }
      }
    };
    if (viewer) {
      let drag = false;
      const setW = ev => { const r = viewer.getBoundingClientRect(); QC.wipe = clamp((ev.clientX - r.left) / r.width, 0, 1); paint(); };
      viewer.addEventListener('pointerdown', ev => { if (QC.mode !== 'wipe') return; drag = true; viewer.setPointerCapture(ev.pointerId); setW(ev); });
      viewer.addEventListener('pointermove', ev => { if (drag) setW(ev); });
      viewer.addEventListener('pointerup', () => drag = false);
      new ResizeObserver(paint).observe(viewer);
    }
    const runAnalysis = () => {
      const out = $('#qc-metrics', el); if (!out || !candEl) return;
      try {
        const m = analyze(candEl); let rm = null;
        try { if (refEl) rm = analyze(refEl); } catch { /* ref tainted */ }
        const match = rm ? paletteMatch(m.palette, rm.palette) : null;
        cand.qc = { ...(cand.qc || {}), metrics: { red: m.red, teal: m.teal, lum: m.lum, match }, at: new Date().toISOString() }; save(); renderChips();
        const early = sh && sh.start < RED_AT;
        const meter = (k, v, max, bad) => `<div class="meter"><span>${k}</span><div class="bar"><i style="width:${clamp(v / max, 0, 1) * 100}%;${bad ? 'background:var(--bad)' : ''}"></i></div><span class="v">${(v * 100).toFixed(1)}%</span></div>`;
        out.innerHTML = `
          ${meter('أحمر قرمزي', m.red, 0.1, early && m.red > 0.006)}
          ${meter('تركواز', m.teal, 0.15, m.teal > 0.03)}
          ${meter('الإضاءة', m.lum, 1, false)}
          ${match != null ? meter('تطابق الألوان', match, 1, match < 0.55) : ''}
          <div class="sec-h" style="margin:12px 0 8px">الباليت: المحاولة / المرجع</div>
          <div class="swatches">${m.palette.map(p => `<i style="background:rgb(${p.rgb});flex:${0.3 + p.w}"></i>`).join('')}</div>
          ${rm ? `<div class="swatches" style="margin-top:4px">${rm.palette.map(p => `<i style="background:rgb(${p.rgb});flex:${0.3 + p.w}"></i>`).join('')}</div>` : ''}
          <div style="display:flex;flex-direction:column;gap:6px;margin-top:12px">
            ${early && m.red > 0.006 ? `<div class="note bad">أحمر بلقطة قبل 2:46 (${esc(sh.label)}) — ممنوع</div>` : ''}
            ${!early && sh && m.red < 0.004 && sh.states.W?.b === 4 ? '<div class="note warn">اللقطة بعد الانقلاب بس ما فيه قرمزي واضح</div>' : ''}
            ${m.teal > 0.03 ? '<div class="note warn">المي تطلع تركواز — v5 يبيها رمادي-أزرق نهار</div>' : ''}
            ${match != null && match < 0.55 ? '<div class="note warn">ألوان بعيدة عن المرجع — شيك اللبس والمكان</div>' : ''}
          </div>`;
      } catch (err) { out.innerHTML = '<div class="note warn">ما أقدر أحلل البكسلات من رابط خارجي — ارفع الملف نفسه للتحليل. المقارنة البصرية شغالة.</div>'; }
    };
    (async () => {
      const r = refChoices.find(x => x.id === QC.ref);
      refEl = r?.m ? await loadEl(r.m, r.kind) : null;
      candEl = cand ? await loadEl(cand, cand.kind) : null;
      const sc = $('#qc-scrub', el);
      if (candEl && cand.kind === 'video') {
        const seek = t => new Promise(res => { candEl.onseeked = () => res(); candEl.currentTime = t; });
        sc.max = candEl.duration || 0; sc.value = QC.time;
        await seek(Math.min(QC.time, (candEl.duration || 0) - 0.05));
        sc.oninput = async () => { QC.time = +sc.value; $('#qc-t', el).textContent = QC.time.toFixed(2) + ' ث'; await seek(QC.time); paint(); };
        sc.onchange = runAnalysis;
        $('#qc-last', el).onclick = async () => { QC.time = Math.max(0, candEl.duration - 0.05); sc.value = QC.time; await seek(QC.time); paint(); runAnalysis(); };
        $('#qc-first', el).onclick = async () => { QC.time = 0; sc.value = 0; await seek(0); paint(); runAnalysis(); };
      }
      paint(); runAnalysis();
    })();
    $$('[data-qc]', el).forEach(c => c.onchange = () => { cand.qc = cand.qc || {}; cand.qc.checks = cand.qc.checks || {}; cand.qc.checks[c.dataset.qc] = c.checked; save(); });
    const ok = $('#qc-ok', el), bad = $('#qc-redo', el);
    if (ok) ok.onclick = () => {
      cand.qc = { ...(cand.qc || {}), verdict: 'ok' };
      if (cand.shot) { const st = shotState(cand.shot); st.approved = cand.id; st.status = 'approved'; }
      save(); toast('اعتمدت ✓'); rerender();
    };
    if (bad) bad.onclick = () => {
      const failed = QC_CHECKS.filter(([k]) => !cand.qc?.checks?.[k]).map(([, t]) => t);
      const reason = prompt('وش الغلط؟', failed.slice(0, 2).join(' · ')) ?? null; if (reason === null) return;
      cand.qc = { ...(cand.qc || {}), verdict: 'redo', reason };
      if (cand.shot) {
        const st = shotState(cand.shot); st.fails = (st.fails || 0) + 1;
        st.status = st.fails >= 2 ? 'rescue' : 'redo';
        st.notes = (st.notes ? st.notes + '\n' : '') + `${new Date().toISOString().slice(0, 10)} · ${cand.name}: ${reason}`;
        if (st.fails >= 2) toast('فشلت مرتين → خطة الإنقاذ: صور + مونتاج');
      }
      save(); rerender();
    };
  };
  return `
  <div class="room-head">
    <div><h2 class="room-title">الفحص</h2><p class="room-sub">قارن أي محاولة بالمراجع: جنب بجنب، ستارة، شفافية، أو فرق. التحليل يكشف الأحمر قبل 2:46 والمي التركواز ويقارن الباليت. القائمة تحت مأخوذة من سجل الأخطاء العشرين.</p></div>
    <div class="toolbar">${segHTML('qcmode', [['wipe', 'ستارة'], ['side', 'جنب بجنب'], ['onion', 'شفافية'], ['diff', 'فرق']], QC.mode)}</div>
  </div>
  <div class="sec-h" style="margin-top:0">المراجع</div>
  <div class="picker">
    ${refChoices.map(r => r.m
      ? `<button aria-pressed="${QC.ref === r.id}" ${r.id.startsWith('ref:') ? `data-refslot="${r.id.slice(4)}"` : `data-refpick="${r.id}"`} title="${esc(r.title || r.label)}">${mediaTag(r.id, r.kind)}<span class="lbl">${esc(r.label)}</span></button>`
      : `<button data-refslot="${r.id.slice(4)}" title="ارفع ${esc(r.title)}">+ ${esc(r.label)}</button>`).join('')}
  </div>
  <div class="sec-h">المحاولات</div>
  <div class="picker">
    <button id="qc-add">+ ارفع</button>
    ${takes.map(t => `<button data-candpick="${t.id}" aria-pressed="${t.id === QC.cand}" title="${esc(t.name)}">${mediaTag(t.id, t.kind)}<span class="lbl">${esc(t.shot ? shotById(t.shot)?.label : '؟')}${t.qc?.verdict === 'ok' ? ' ✓' : t.qc?.verdict === 'redo' ? ' ✕' : ''}</span></button>`).join('')}
  </div>
  ${!cand ? `<div class="empty" style="margin-top:16px">اختار محاولة أو ارفع فيديو/صورة عشان نفحصها.</div>` : `
  <div class="qc" style="margin-top:16px">
    <div>
      <div class="viewer"><span class="cap l">المرجع ${esc(refChoices.find(r => r.id === QC.ref)?.label || '—')}</span><span class="cap r">${esc(sh ? 'لقطة ' + sh.label : cand.name)}</span></div>
      ${cand.kind === 'video' ? `<div class="toolbar" style="margin-top:10px"><button class="btn sm" id="qc-first">أول فريم</button><input type="range" id="qc-scrub" min="0" step="0.04" value="0" style="flex:1"><span class="mono dim" id="qc-t">${QC.time.toFixed(2)} ث</span><button class="btn sm" id="qc-last">آخر فريم</button></div>` : ''}
      ${sh ? `<p class="dim" style="font-size:13px;margin-top:10px"><b class="mono">${esc(sh.label)}</b> · ${tc(sh.start)} · ${esc(sh.desc)}</p>` : '<div class="note warn" style="margin-top:10px">المحاولة مو مربوطة بلقطة — اربطها من بطاقتها عشان فحص الأحمر يعرف الزمن.</div>'}
    </div>
    <div class="card">
      <div class="sec-h" style="margin-top:0">تحليل الكادر</div>
      <div id="qc-metrics" class="dim">أحلل…</div>
      <div class="sec-h">القائمة (بالعين)</div>
      ${QC_CHECKS.map(([k, t, n]) => `<label class="check"><input type="checkbox" data-qc="${k}" ${qc.checks?.[k] ? 'checked' : ''}>${esc(t)}${n ? ` <span class="dimmer mono" style="font-size:11px">#${n}</span>` : ''}</label>`).join('')}
      <div class="verdict" style="margin-top:14px"><button class="btn gold" id="qc-ok">اعتماد</button><button class="btn" id="qc-redo" style="color:var(--bad)">يتعاد</button></div>
      ${qc.verdict ? `<p class="dim" style="font-size:12.5px;margin:10px 0 0">الحكم الحالي: ${qc.verdict === 'ok' ? 'معتمد' : 'يتعاد — ' + esc(qc.reason || '')}</p>` : ''}
    </div>
  </div>`}`;
};

/* ---------- المعرض ---------- */
const GAL = { group: 'shot', kind: 'all' };
Rooms.gallery = () => {
  const s = S();
  let takes = Object.values(s.takes);
  if (GAL.kind !== 'all') takes = takes.filter(t => t.kind === GAL.kind);
  const card = t => {
    const sh = t.shot && shotById(t.shot);
    return `<article class="card gi" data-take="${t.id}" tabindex="0"><div class="gi-media">${mediaTag(t.id, t.kind)}
      ${t.qc?.verdict === 'ok' || (sh && shotState(sh.id).approved === t.id) ? '<span class="badge tag ok">معتمد</span>' : t.qc?.verdict === 'redo' ? '<span class="badge tag bad">يتعاد</span>' : ''}
      ${t.dur ? `<span class="dur">${t.dur.toFixed(1)}ث</span>` : ''}</div>
      <div class="gi-body"><div class="gi-t ltr" style="text-align:right">${esc(t.name)}</div>
      <div class="shot-ft">${sh ? `<span class="tag gold">${esc(sh.label)}</span>` : '<span class="tag warn">بدون لقطة</span>'}${t.tool ? `<span class="tag">${esc(TOOLS[t.tool]?.name || t.tool)}</span>` : ''}${t.w ? `<span class="tag">${t.w}×${t.h}</span>` : ''}${num(t.credits) ? `<span class="tag info">${t.credits} كريدت</span>` : ''}</div></div></article>`;
  };
  let body = '';
  if (GAL.group === 'dest') {
    body = `<div class="dest">${DESTS.map(d => {
      const assigned = Object.values(s.takes).filter(t => t.dests?.includes(d.id));
      const t = assigned[0]; const c = t ? specCheck(t, d) : null; const st = stationById(d.st);
      const bw = d.ratio[0] > d.ratio[1] ? 200 : 96, bh = Math.round(bw * d.ratio[1] / d.ratio[0]);
      return `<div class="card dest-c">
        <div class="shot-hd"><b style="font-family:var(--f-display)">${esc(d.name)}</b><span class="tag">${d.ratio.join(':')}</span></div>
        <div class="ratio-box" style="width:${bw}px;height:${bh}px" ${t ? `data-take="${t.id}"` : ''}>${t ? mediaTag(t.id, t.kind) : 'فاضي'}</div>
        <div class="dim" style="font-size:12.5px">${esc(d.note)}</div>
        <div class="shot-ft">${t ? `<span class="tag ${c.ok ? 'ok' : 'warn'}">${esc(c.msg)}</span>` : d.suggest ? `<button class="btn sm" data-openshot="${d.suggest}">من لقطة ${esc(shotById(d.suggest).label)}</button>` : ''}${assigned.length > 1 ? `<span class="tag">${assigned.length} نسخ</span>` : ''}${st ? `<a class="btn sm" href="${esc(st.url)}" target="_blank" rel="noopener">${esc(st.name)} ↗</a>` : ''}</div>
      </div>`;
    }).join('')}</div>`;
  } else if (!takes.length) {
    body = `<div class="empty">المعرض فاضي. اسحب هنا الفيديوهات والصور اللي نزلتها من Higgsfield وRunway وFlow — يتعرف على المحطة واللقطة من اسم الملف (مثل <span class="mono ltr">hf_…_S04.mp4</span> أو <span class="mono ltr">A7_take2.mp4</span>).</div>`;
  } else {
    const keyOf = { shot: t => t.shot || '_', tool: t => t.tool || '_', station: t => t.station || '_' }[GAL.group];
    const groups = {}; takes.forEach(t => (groups[keyOf(t)] = groups[keyOf(t)] || []).push(t));
    const order = Object.keys(groups).sort((a, b) => a === '_' ? 1 : b === '_' ? -1 : GAL.group === 'shot' ? (shotById(a)?.start ?? 0) - (shotById(b)?.start ?? 0) : a.localeCompare(b));
    const title = k => k === '_' ? 'غير مصنّف' : GAL.group === 'shot' ? `لقطة ${shotById(k)?.label} · <span class="dim mono">${tc(shotById(k)?.start)}</span> <span class="dim" style="font-weight:400;font-size:13px">${esc(shotById(k)?.desc.split(':')[0])}</span>` : GAL.group === 'tool' ? esc(TOOLS[k]?.name || k) : esc(stationById(k)?.name || k);
    body = order.map(k => `<div class="group-h">${title(k)} <span class="count">${groups[k].length}</span></div><div class="grid gal">${groups[k].sort((a, b) => (a.created || '').localeCompare(b.created || '')).map(card).join('')}</div>`).join('');
  }
  mountFn = el => {
    bindSeg(el, 'group', v => { GAL.group = v; rerender(); });
    bindSeg(el, 'kind', v => { GAL.kind = v; rerender(); });
    $('#g-add', el).onclick = async () => { const fs = await pickFiles({ multiple: true }); if (!fs.length) return; const ids = await addTakes(fs); toast(`انضاف ${ids.length} ✓`); rerender(); };
    $('#g-link', el).onclick = () => { const u = prompt('رابط الفيديو أو الصورة (Higgsfield / Runway / Flow / Drive):'); if (!u || !/^https?:\/\//.test(u)) return; addLinkTake(u.trim()); rerender(); };
    $$('[data-openshot]', el).forEach(b => b.onclick = () => openShot(b.dataset.openshot));
    el.ondragover = e => { e.preventDefault(); $('#g-drop', el)?.classList.add('over'); };
    el.ondragleave = () => $('#g-drop', el)?.classList.remove('over');
    el.ondrop = async e => { e.preventDefault(); const fs = [...e.dataTransfer.files]; if (!fs.length) return; const ids = await addTakes(fs); toast(`انضاف ${ids.length} ✓`); rerender(); };
  };
  return `
  <div class="room-head">
    <div><h2 class="room-title">المعرض</h2><p class="room-sub">كل اللي ولّدته من كل محطة، مرتب حسب اللقطة أو الأداة أو المحطة — أو حسب وين بينزل: يوتيوب، ريلز، تيك توك، Spotify Canvas، مع فحص المقاس والمدة.</p></div>
    <div class="toolbar"><button class="btn" id="g-link">+ رابط</button><button class="btn gold" id="g-add">+ ملفات</button></div>
  </div>
  <div class="toolbar" style="margin-bottom:14px">${segHTML('group', [['shot', 'اللقطة'], ['tool', 'الأداة'], ['station', 'المحطة'], ['dest', 'وجهة النشر']], GAL.group)}${GAL.group !== 'dest' ? segHTML('kind', [['all', 'الكل'], ['video', 'فيديو'], ['image', 'صور']], GAL.kind) : ''}</div>
  ${GAL.group !== 'dest' ? '<div class="drop" id="g-drop" style="margin-bottom:8px">اسحب الملفات هنا</div>' : ''}
  ${body}`;
};

/* ---------- الإصدار ---------- */
const RELEASE = [
  ['distrokid', 'DistroKid', [
    ['master', 'الماستر v44 WAV أو FLAC (على Drive)'], ['cover', 'الغلاف 3000×3000 مربع'], ['meta', 'الاسم والفنان والتاريخ مطابقين'],
    ['lyrics', 'الكلمات (English)'], ['canvas', 'Spotify Canvas مرفوع'], ['submitted', 'انرفع للتوزيع']]],
  ['youtube', 'YouTube', [
    ['yt-video', 'الكليب الرسمي 16:9 بدون كلمات على الشاشة'], ['yt-cc', 'CC من SRT'], ['yt-chapters', 'الفصول بالوصف'],
    ['yt-thumb', 'الثمبنيل من لقطة 29'], ['yt-lyric', 'Lyric Video منفصل'], ['yt-loop', 'اللوب: آخر فريم = أول فريم']]],
  ['social', 'السوشال', [
    ['reel1', 'Reels 1 — السوستة وصوت القفل'], ['reel2', 'Reels 2 — الجاكيت ينقلب'], ['reel3', 'Reels 3 — النظرة'], ['tiktok', 'TikTok 9:16']]]
];
function chapters() {
  const secs = D.sections.map(s => ({ ...s }));
  secs[0].start = 0;
  const out = [];
  for (let i = 0; i < secs.length; i++) {
    const next = secs[i + 1]?.start ?? SONG;
    if (out.length && next - secs[i].start < 10) continue; // YouTube: every chapter ≥ 10 s
    if (out.length && secs[i].start - out[out.length - 1].start < 10) continue;
    out.push(secs[i]);
  }
  return out.map(s => `${tcShort(s.start)} ${s.name.replace(/\s+/g, ' ').trim()}`).join('\n');
}
function vtt() { return 'WEBVTT\n\n' + D.cues.map(c => `${tcV(c.s)} --> ${tcV(c.e)}\n${c.t}`).join('\n\n') + '\n'; }
function srt() { return D.cues.map((c, i) => `${i + 1}\n${tcV(c.s, ',')} --> ${tcV(c.e, ',')}\n${c.t}`).join('\n\n') + '\n'; }
function tcV(s, sep = '.') { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(Math.floor(r)).padStart(2, '0')}${sep}${String(Math.round((r % 1) * 1000)).padStart(3, '0')}`; }
Rooms.release = () => {
  const s = S(), r = s.release, cm = r.coverMeta;
  const coverOk = cm && cm.w >= 3000 && cm.w === cm.h;
  const total = RELEASE.reduce((a, [, , it]) => a + it.length, 0), done = RELEASE.reduce((a, [, , it]) => a + it.filter(([k]) => r.checks[k]).length, 0);
  mountFn = el => {
    $$('[data-rc]', el).forEach(c => c.onchange = () => { r.checks[c.dataset.rc] = c.checked; save(); rerender(); });
    $$('[data-rm]', el).forEach(i => i.oninput = () => { r.meta[i.dataset.rm] = i.value; save(); });
    $('#cover', el).onclick = async () => {
      const [f] = await pickFiles({ accept: 'image/png,image/jpeg' }); if (!f) return;
      const m = await probe(f); await Media.put('cover', f); r.cover = { key: 'cover' }; r.coverMeta = { w: m.w, h: m.h, type: f.type, size: f.size };
      r.checks.cover = m.w >= 3000 && m.w === m.h; save(); rerender();
    };
    $('#dl-srt', el).onclick = () => download('I_Am_The_World_v44_en.srt', srt());
    $('#dl-vtt', el).onclick = () => download('I_Am_The_World_v44_en.vtt', vtt(), 'text/vtt');
    $('#cp-ch', el).onclick = () => copy($('#chap', el).value);
    $('#cp-desc', el).onclick = () => copy($('#desc', el).value);
  };
  const desc = `${r.meta.artist} — ${r.meta.title} (Official Video)\n\n${chapters()}\n\n#${r.meta.artist} #IAmTheWorld`;
  return `
  <div class="room-head">
    <div><h2 class="room-title">الإصدار</h2><p class="room-sub">من الماستر لحد آخر ريل: DistroKid، يوتيوب، والسوشال. ملفات الترجمة والفصول تطلع جاهزة من توقيتات v44.</p></div>
    <div class="toolbar"><span class="chip"><i class="led"></i>منجز <b>${done}/${total}</b></span></div>
  </div>
  <div class="bar" style="margin-bottom:20px"><i style="width:${done / total * 100}%"></i></div>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
    ${RELEASE.map(([id, name, items]) => { const st = stationById(id === 'social' ? 'instagram' : id); return `<div class="card">
      <div class="shot-hd" style="margin-bottom:8px"><b style="font:700 17px var(--f-display)">${name}</b>${st ? `<a class="btn sm" href="${esc(st.url)}" target="_blank" rel="noopener">فتح ↗</a>` : ''}</div>
      ${items.map(([k, t]) => `<label class="check"><input type="checkbox" data-rc="${k}" ${r.checks[k] ? 'checked' : ''}>${esc(t)}</label>`).join('')}
    </div>`; }).join('')}
  </div>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));margin-top:14px">
    <div class="card">
      <div class="sec-h" style="margin-top:0">الغلاف</div>
      <div style="display:flex;gap:14px;align-items:flex-start">
        <div class="slot ${r.cover ? 'has' : ''}" id="cover" style="width:140px;aspect-ratio:1;flex:none">${r.cover ? mediaTag('cover', 'image') : '+ الغلاف'}</div>
        <div style="font-size:13.5px">${cm ? `<div class="mono">${cm.w}×${cm.h} · ${(cm.size / 1048576).toFixed(1)} MB</div>
          <div class="note ${coverOk ? 'ok' : 'bad'}" style="margin-top:8px">${coverOk ? 'مربع و3000 أو أكثر ✓' : cm.w !== cm.h ? 'لازم يكون مربع بالضبط' : 'أقل من 3000×3000'}</div>` : '<span class="dim">DistroKid يبي الغلاف مربع 3000×3000 على الأقل.</span>'}</div>
      </div>
      <div class="sec-h">البيانات</div>
      <div class="grid" style="grid-template-columns:1fr 1fr">
        ${[['title', 'اسم الأغنية'], ['artist', 'الفنان'], ['date', 'تاريخ الإصدار'], ['lang', 'لغة الكلمات'], ['isrc', 'ISRC'], ['upc', 'UPC']].map(([k, t]) => `<label class="field">${t}<input class="input ${k === 'date' ? '' : 'ltr'}" ${k === 'date' ? 'type="date"' : ''} data-rm="${k}" value="${esc(r.meta[k])}"></label>`).join('')}
      </div>
      <div class="sec-h">الماستر على Drive</div>
      <p class="dim mono ltr" style="font-size:12px;text-align:right;margin:0">WAV 1cct8zEysShswZIEV1ISWFidm7cYOjuNQ<br>FLAC 1bbqIV8TPSg8LLwCD1Ui9Oq4y-Xt8Um2u</p>
    </div>
    <div class="card">
      <div class="sec-h" style="margin-top:0">يوتيوب — الترجمة والفصول</div>
      <div class="toolbar" style="margin-bottom:12px"><button class="btn" id="dl-srt">تحميل SRT</button><button class="btn" id="dl-vtt">تحميل VTT</button><span class="dim" style="font-size:12.5px">${D.cues.length} سطر من v44_en.srt</span></div>
      <label class="field">الفصول (كل فصل 10 ث أو أكثر، يبدأ من 0:00)<textarea class="input ltr" id="chap" style="min-height:170px">${esc(chapters())}</textarea></label>
      <div class="toolbar" style="margin-top:8px"><button class="btn sm" id="cp-ch">انسخ الفصول</button></div>
      <label class="field" style="margin-top:12px">الوصف<textarea class="input ltr" id="desc" style="min-height:120px">${esc(desc)}</textarea></label>
      <div class="toolbar" style="margin-top:8px"><button class="btn sm" id="cp-desc">انسخ الوصف</button></div>
    </div>
  </div>`;
};

/* ---------- الكريدت ---------- */
Rooms.credits = () => {
  const s = S(), set = setOf();
  const bal = curBalance(), sp = spent();
  const pending = set.filter(sh => !['approved'].includes(s.shots[sh.id]?.status));
  let need = 0, unknown = 0; pending.forEach(sh => { const st = s.shots[sh.id]; const e = estimateShot(st?.tool === 'Montage' ? { ...sh, tools: ['Montage'] } : sh); need += e.c; if (e.unknown) unknown++; });
  const after = bal == null ? null : bal - need;
  const byTool = {}; s.ledger.forEach(e => { const k = e.tool || '—'; byTool[k] = (byTool[k] || 0) + (+e.credits || 0); });
  const rescue = set.filter(sh => (s.shots[sh.id]?.fails || 0) >= 2);
  mountFn = el => {
    $('#l-add', el).onclick = () => {
      const c = num($('#l-c', el).value); if (!c) return;
      s.ledger.push({ id: 'l_' + uid(), date: new Date().toISOString(), credits: c, station: $('#l-st', el).value, tool: $('#l-t', el).value, shot: $('#l-sh', el).value, desc: $('#l-d', el).value });
      save(); rerender();
    };
    $$('[data-ldel]', el).forEach(b => b.onclick = () => { s.ledger = s.ledger.filter(e => e.id !== b.dataset.ldel); save(); rerender(); });
    $('#bal-edit', el).onclick = () => editStation('higgsfield');
  };
  return `
  <div class="room-head">
    <div><h2 class="room-title">الكريدت</h2><p class="room-sub">كل لقطة تتحدد أداتها وتكلفتها قبل التوليد. التقدير حسب MAP_v7: كادرين × محاولتين × 2 كريدت، والفيديو × 2.5 محاولة.</p></div>
    <div class="toolbar"><button class="btn" id="bal-edit">حدّث الرصيد من Higgsfield</button></div>
  </div>
  <div class="summary">
    <div class="stat"><div class="stat-k">الرصيد المتوقع الحين</div><div class="stat-v">${bal == null ? '—' : fmtN(bal)} <small>كريدت</small></div></div>
    <div class="stat"><div class="stat-k">المصروف المسجّل</div><div class="stat-v">${fmtN(sp)}</div></div>
    <div class="stat"><div class="stat-k">المتبقي تقديراً (${pending.length} لقطة)</div><div class="stat-v">~${fmtN(need)}${unknown ? ` <small>+ ${unknown} بتكلفة غير معروفة</small>` : ''}</div></div>
    <div class="stat" style="${after != null && after < 0 ? 'border-color:var(--bad)' : ''}"><div class="stat-k">بعد الإنتاج</div><div class="stat-v" style="${after != null && after < 0 ? 'color:var(--bad)' : ''}">${after == null ? '—' : fmtN(after)}</div></div>
  </div>
  ${after != null && after < 0 ? `<div class="note bad" style="margin-bottom:16px">الرصيد ما يكفي. الخطة من MAP_v7: (1) اختبر اللقطات الصعبة أول، (2) 01 و03 و08 صور بس، (3) أي لقطة تفشل مرتين → صور + مونتاج.</div>` : ''}
  ${unknown ? `<div class="note warn" style="margin-bottom:16px">Kling 4.0 للقطات الطويلة: التكلفة لازم تنعرف من Higgsfield قبل أول توليد (README). حطها بالجدول تحت لما تعرفها.</div>` : ''}
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
    <div class="card">
      <div class="sec-h" style="margin-top:0">تكلفة الأدوات</div>
      <table class="t"><thead><tr><th>الأداة</th><th>المحطة</th><th>لكل توليد</th><th>المصروف</th></tr></thead><tbody>
      ${Object.entries(TOOLS).filter(([k]) => k !== 'Montage').map(([k, t]) => `<tr><td>${esc(t.name)}</td><td class="dim">${esc(stationById(t.station)?.name || '—')}</td><td class="mono">${t.cost == null ? '<span class="tag warn">؟</span>' : t.cost + (t.est ? ' <span class="dimmer">تقدير</span>' : '')}</td><td class="mono">${fmtN(byTool[k] || 0)}</td></tr>`).join('')}
      </tbody></table>
    </div>
    <div class="card">
      <div class="sec-h" style="margin-top:0">خطة الإنقاذ <span class="tag ${rescue.length ? 'bad' : 'ok'}">${rescue.length}</span></div>
      ${rescue.length ? rescue.map(sh => `<div class="check" data-shot="${sh.id}" style="cursor:pointer"><span class="mono gold" style="color:var(--gold)">${esc(sh.label)}</span> ${esc(sh.desc.split(':')[0])} <span class="tag bad">${s.shots[sh.id].fails}×</span></div>`).join('') : '<p class="dim" style="margin:0">ماكو لقطة فشلت مرتين.</p>'}
      <div class="sec-h">ترتيب الاختبار (MAP_v7)</div>
      <ol style="margin:0;padding-inline-start:20px;font-size:13.5px;line-height:1.9"><li>صورة المكان فاضي للأحواض الثلاثة</li><li>اللقطات اللي تحمل الكليب: ${['S04', 'S18', 'S23', 'S24', 'S29'].map(i => `<a href="#" data-shot="${i}">${i.slice(1)}</a>`).join(' · ')}</li><li>أول لقطة طويلة: <a href="#" data-shot="${LONGS.find(l => l.label === 'A7')?.id}">A7</a> (الحجر بان، 24 ث)</li></ol>
    </div>
  </div>
  <div class="card" style="margin-top:14px">
    <div class="sec-h" style="margin-top:0">السجل</div>
    <div class="toolbar" style="margin-bottom:12px">
      <input class="input ltr" id="l-c" placeholder="كريدت" style="width:90px" inputmode="decimal">
      <select class="input" id="l-st" style="width:150px">${STATIONS.filter(x => ['higgsfield', 'runway', 'flow', 'grok', 'gemini', 'elevenlabs'].includes(x.id)).map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
      <select class="input" id="l-t" style="width:160px">${Object.entries(TOOLS).map(([k, t]) => `<option value="${k}">${esc(t.name)}</option>`).join('')}</select>
      <select class="input" id="l-sh" style="width:110px"><option value="">لقطة</option>${ALL.map(sh => `<option value="${sh.id}">${esc(sh.label)}</option>`).join('')}</select>
      <input class="input" id="l-d" placeholder="وصف" style="flex:1;min-width:140px">
      <button class="btn gold" id="l-add">سجّل</button>
    </div>
    ${s.ledger.length ? `<table class="t"><thead><tr><th>التاريخ</th><th>اللقطة</th><th>الأداة</th><th>الوصف</th><th>كريدت</th><th></th></tr></thead><tbody>
      ${s.ledger.slice().reverse().map(e => `<tr><td class="mono dim">${esc((e.date || '').slice(0, 10))}</td><td class="mono">${esc(shotById(e.shot)?.label || '—')}</td><td>${esc(TOOLS[e.tool]?.name || e.tool || '—')}</td><td class="ltr" style="text-align:right">${esc(e.desc || '')}</td><td class="mono">${e.credits}</td><td>${e.take ? '<span class="dimmer" style="font-size:11px">من المعرض</span>' : `<button class="icon-btn" data-ldel="${e.id}" aria-label="حذف">✕</button>`}</td></tr>`).join('')}
    </tbody></table>` : '<p class="dim" style="margin:0">ما فيه مصروف مسجّل. الكريدت ينسجل تلقائياً لما تكتبه ببطاقة أي محاولة بالمعرض.</p>'}
  </div>`;
};

/* boot */
if (!location.hash) location.replace('#/' + (S().room || 'stations'));
render();
})();
