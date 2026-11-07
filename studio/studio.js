/* غرفة الإخراج — Rabee Studio control room.
   Static, offline-first. Metadata in localStorage, media blobs in IndexedDB.
   Project data (shots, long takes, lyrics, sections) comes from data.js,
   generated from projects/i-am-the-world by tools/gen_data.py. */
(() => {
'use strict';
const D = window.IATW;
const SONG = 256;            // 4:16
const RED_AT = 166;          // الأحمر ممنوع قبل 2:46
const KEY = 'rs.control.v1';

/* ================= helpers ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function tc(s, dec = 1) {
  if (s == null || isNaN(s)) return '—';
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r.toFixed(dec).padStart(dec ? 3 + dec : 2, '0')}`;
}
const tcShort = s => { const m = Math.floor(s / 60), r = Math.floor(s - m * 60); return `${m}:${String(r).padStart(2, '0')}`; };
const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
const fmtN = v => v == null ? '—' : '\u2066' + (Math.round(v * 10) / 10).toLocaleString('en-US') + '\u2069';
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600); }
function copy(text) { navigator.clipboard?.writeText(text).then(() => toast('انسخ ✓'), () => toast('ما قدرت أنسخ — حدده يدوي')); }
function download(name, text, type = 'text/plain') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
const ICON = {
  stations: '<path d="M4 7h16M4 12h16M4 17h10" stroke-linecap="round"/><circle cx="18" cy="17" r="2"/>',
  timeline: '<path d="M3 6h18M3 12h18M3 18h18" stroke-linecap="round" opacity=".35"/><rect x="5" y="4" width="6" height="4" rx="1"/><rect x="12" y="10" width="7" height="4" rx="1"/><rect x="7" y="16" width="5" height="4" rx="1"/>',
  storyboard: '<rect x="3" y="4" width="8" height="7" rx="1.5"/><rect x="13" y="4" width="8" height="7" rx="1.5"/><rect x="3" y="13" width="8" height="7" rx="1.5"/><rect x="13" y="13" width="8" height="7" rx="1.5"/>',
  qc: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5M8.5 11l2 2 3.5-4" stroke-linecap="round" stroke-linejoin="round"/>',
  gallery: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6" stroke-linejoin="round"/><circle cx="16" cy="9" r="1.5"/>',
  release: '<path d="M12 3v12m0-12-4 4m4-4 4 4" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 14v5h14v-5" stroke-linecap="round" stroke-linejoin="round"/>',
  credits: '<circle cx="12" cy="12" r="8"/><path d="M12 7v10M9.5 9.5c0-1.2 1.1-2 2.5-2s2.5.8 2.5 2-1.1 1.7-2.5 2-2.5.8-2.5 2 1.1 2 2.5 2 2.5-.8 2.5-2" stroke-linecap="round"/>'
};
const svg = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">${ICON[k]}</svg>`;

/* ================= media store (IndexedDB) ================= */
const Media = {
  db: null, urls: new Map(),
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('rs-control-media', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('blobs');
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('blobs', mode); const s = t.objectStore('blobs'); const q = fn(s); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); }); },
  put(k, blob) { this.urls.delete(k); return this.tx('readwrite', s => s.put(blob, k)); },
  get(k) { return this.tx('readonly', s => s.get(k)); },
  del(k) { const u = this.urls.get(k); if (u) URL.revokeObjectURL(u); this.urls.delete(k); return this.tx('readwrite', s => s.delete(k)); },
  async url(k) {
    if (this.urls.has(k)) return this.urls.get(k);
    const b = await this.get(k).catch(() => null);
    if (!b) return null;
    const u = URL.createObjectURL(b); this.urls.set(k, u); return u;
  }
};
/* a media ref is {key} (stored blob) or {url} (remote link) */
async function srcOf(m) { if (!m) return null; if (m.url) return m.url; if (m.key) return Media.url(m.key); return null; }
async function hydrate(root = document) {
  for (const el of $$('[data-media]', root)) {
    const id = el.dataset.media; let m;
    if (id.startsWith('ref:')) m = S.refs[id.slice(4)];
    else if (id === 'cover') m = S.release.cover;
    else m = S.takes[id];
    const u = await srcOf(m);
    if (u && el.getAttribute('src') !== u) el.src = u;
  }
}
function mediaTag(id, kind, attrs = '') {
  if (!id) return '';
  return kind === 'video'
    ? `<video data-media="${esc(id)}" muted playsinline preload="metadata" ${attrs}></video>`
    : `<img data-media="${esc(id)}" alt="" loading="lazy" ${attrs}>`;
}
function probe(file) {
  return new Promise(res => {
    const u = URL.createObjectURL(file);
    const isV = file.type.startsWith('video'), isA = file.type.startsWith('audio');
    if (isA) return res({ kind: 'audio' });
    const el = document.createElement(isV ? 'video' : 'img');
    const done = meta => { URL.revokeObjectURL(u); res(meta); };
    if (isV) { el.preload = 'metadata'; el.onloadedmetadata = () => done({ kind: 'video', w: el.videoWidth, h: el.videoHeight, dur: el.duration }); el.onerror = () => done({ kind: 'video' }); }
    else { el.onload = () => done({ kind: 'image', w: el.naturalWidth, h: el.naturalHeight }); el.onerror = () => done({ kind: 'image' }); }
    el.src = u;
  });
}
function pickFiles({ accept = 'image/*,video/*', multiple = false } = {}) {
  return new Promise(res => {
    const inp = $('#file-any'); inp.accept = accept; inp.multiple = multiple; inp.value = '';
    inp.onchange = () => res([...inp.files]); inp.click();
  });
}

/* ================= catalog ================= */
const STATIONS = [
  { id: 'higgsfield', name: 'Higgsfield', c: '#d6ff5c', url: 'https://higgsfield.ai', role: 'التوليد الأساسي: MiniMax H3، Kling، Seedance، Veo، nano banana', unit: 'كريدت', credits: 1015, creditsAt: '2026-10-19' },
  { id: 'runway', name: 'Runway', c: '#e8e8e8', url: 'https://app.runwayml.com', role: 'توليد وتعديل فيديو، مراجع الحركة', unit: 'كريدت' },
  { id: 'flow', name: 'Google Flow', c: '#8fb8ff', url: 'https://labs.google/fx/tools/flow', role: 'Veo 3.1 — الماكرو بدون وجه', unit: 'كريدت' },
  { id: 'gemini', name: 'Gemini', c: '#a78bfa', url: 'https://gemini.google.com', role: 'صور النهاية كتعديل قصير على صورة البداية' },
  { id: 'grok', name: 'Grok Imagine', c: '#c9c9c9', url: 'https://grok.com/imagine', role: 'Reference-to-Video بست مراجع (تجربة)' },
  { id: 'elevenlabs', name: 'ElevenLabs', c: '#f3ece2', url: 'https://elevenlabs.io/app', role: 'صوت ومؤثرات (صوت القفل، التنفس)' },
  { id: 'distrokid', name: 'DistroKid', c: '#ffcf3d', url: 'https://distrokid.com/dashboard', role: 'توزيع الأغنية على المنصات + Spotify Canvas' },
  { id: 'youtube', name: 'YouTube Studio', c: '#ff4e45', url: 'https://studio.youtube.com', role: 'الكليب الرسمي + CC + Lyric Video' },
  { id: 'instagram', name: 'Instagram', c: '#e1306c', url: 'https://www.instagram.com', role: 'Reels 1·2·3' },
  { id: 'tiktok', name: 'TikTok Studio', c: '#25f4ee', url: 'https://www.tiktok.com/tiktokstudio', role: 'نسخ 9:16' },
  { id: 'notion', name: 'Notion · Storyboard 18', c: '#f3ece2', url: 'https://app.notion.com/p/3fb690fc916181d2bcd8e0d770e9c95f', role: 'المرجع المكتوب: v4.2، سجل الأخطاء v5.1، Architecture Lock' },
  { id: 'drive', name: 'Google Drive · المراجع', c: '#34a853', url: 'https://drive.google.com/drive/folders/1XQjJEIwMINVy20NHaOuZCuyGXkHq0WIX', role: 'FACE / BLACK / CRIMSON / CRIMSON_CLOSE + الماستر WAV/FLAC' }
];
/* cost: credits per generation on the station; est=true means a planning estimate from MAP_v7, not a confirmed price */
const TOOLS = {
  H3:       { name: 'MiniMax H3', station: 'higgsfield', cost: 10, est: false, kind: 'video', note: 'بداية + نهاية. ما يقبل مراجع مع الكيفريم.' },
  Kling:    { name: 'Kling 3.0', station: 'higgsfield', cost: 12, est: true, kind: 'video', note: 'الحركة المعقدة.' },
  Kling4:   { name: 'Kling 4.0', station: 'higgsfield', cost: null, est: true, kind: 'video', note: 'اللقطات الطويلة 3–30 ث. التكلفة لازم تنعرف من Higgsfield قبل التوليد.' },
  Seedance: { name: 'Seedance 2.5', station: 'higgsfield', cost: 12, est: true, kind: 'video', note: 'omni_reference + فيديو مرجعي للإيقاع.' },
  Veo:      { name: 'Veo 3.1', station: 'flow', cost: 12, est: true, kind: 'video', note: 'ماكرو بس، بدون وجه.' },
  Grok:     { name: 'Grok Imagine 1.5', station: 'grok', cost: null, est: true, kind: 'video', note: 'Reference-to-Video بست مراجع.' },
  Runway:   { name: 'Runway', station: 'runway', cost: null, est: true, kind: 'video', note: '' },
  Image:    { name: 'nano banana pro', station: 'higgsfield', cost: 2, est: false, kind: 'image', note: 'كادرات البداية والنهاية.' },
  Edit:     { name: 'Gemini — تعديل', station: 'gemini', cost: 0, est: true, kind: 'image', note: 'صورة النهاية = تعديل قصير على صورة البداية.' },
  Montage:  { name: 'صور + مونتاج', station: null, cost: 0, est: false, kind: 'image', note: 'خطة الإنقاذ.' }
};
const STATUS = {
  idea:      { t: 'فكرة', c: '' },
  written:   { t: 'مكتوبة', c: 'warn' },
  frames:    { t: 'الكادرات جاهزة', c: 'warn' },
  candidate: { t: 'مرشّح', c: 'info' },
  approved:  { t: 'معتمد', c: 'ok' },
  redo:      { t: 'يتعاد', c: 'bad' },
  rescue:    { t: 'خطة إنقاذ', c: 'bad' }
};
const GATE = [
  ['start', 'صورة البداية'], ['end', 'صورة النهاية'], ['refs', 'المراجع بالترتيب'], ['action', 'فعل واحد'],
  ['frame', 'وصف الكادر'], ['bars', 'المدة بالمازورات'], ['lyric', 'سطر الأغنية'], ['meaning', 'المعنى']
];
const STATE_TXT = {
  H: { 1: 'عكة مشدودة', 2: 'خصلة نازلة', 3: 'العكة ترخي', 4: 'تنفك والشعر المبلول ينزل', 5: 'مفكوك' },
  W: { 1: 'مقفولة', 2: 'الثلث', 3: 'مفتوحة كاملة', 4: 'الأحمر' },
  D: { 0: 'على الحافة', 1: 'نزلت بالمي 60 سم', 2: '90 سم لنص الفخذ', 3: 'قاعدة والمي لوسطها', 4: 'على الحجر المغمور', 5: 'طافية' }
};
const STATE_EN = {
  H: { 1: 'hair in a tight, pulled-back bun', 2: 'tight bun with one loose wet strand', 3: 'bun loosening, a few wet strands', 4: 'hair just untied, wet, falling', 5: 'hair fully loose and wet' },
  W: { 1: 'jacket fully zipped', 2: 'zip open one third', 3: 'zip fully open', 4: 'jacket worn crimson side out' }
};
const REF_SLOTS = [
  ['FACE', 'FACE_REF — الوجه'], ['BLACK', 'BLACK_REF v2 — الأسود'], ['CRIMSON', 'CRIMSON_REF — الأحمر'],
  ['CRIMSON_CLOSE', 'CRIMSON_CLOSE'], ['SHOE', 'SHOE_REF — اللوفر'], ['LOCATION', 'المكان — الحوض الفاضي']
];
/* QC checklist distilled from Notion v5.1 error log (20 mistakes) + README repeated errors */
const QC_CHECKS = [
  ['face', 'نفس الوجه (FACE_REF) طول الكليب', 7],
  ['chain', 'سلسلة رولو رفيعة، بدون دلاية ولا إسوارة ولا حلق', 1],
  ['shoe', 'اللوفر مو أوكسفورد', 2],
  ['shorts', 'البرمودا مو بنطلون طويل', 3],
  ['jacket', 'الجاكيت قصير بدون ياقة، مطفي مو ساتان ولا بومبر', 6],
  ['layers', 'البلوزة باينة تحت الجاكيت', 4],
  ['water', 'ما تمشي على المي: الحجر مغمور ويبين تحت السطح', 9],
  ['legs', 'الرجلين ما تخترق الحجر، واللبس ما يتغير داخل الكليب', null],
  ['still', 'المي ساكنة إلا حلقة وحدة', 17],
  ['oneact', 'فعل واحد بس', 13],
  ['endframe', 'الكليب يقفل على صورة النهاية', 15],
  ['look', 'ما تباوع للكاميرا (إلا 3:48 ونص ثانية بالجاكيت)', 16],
  ['pose', 'مو قعدة يوگا بكفوف مفتوحة', 12],
  ['physical', 'بدون particles ولا glow — كل شي فيزيائي', null],
  ['head', 'من فوق: الراس لتحت الكادر', 8],
  ['nolyrics', 'ماكو كلمات مكتوبة على الشاشة', null]
];
const DESTS = [
  { id: 'yt',     name: 'YouTube · الكليب الرسمي', st: 'youtube',  ratio: [16, 9], note: '4:16 كاملة · CC من SRT · بدون كلمات على الشاشة', fullSong: true },
  { id: 'lyric',  name: 'Lyric Video', st: 'youtube',  ratio: [16, 9], note: 'منفصل عن الرسمي (v4.2)', fullSong: true },
  { id: 'thumb',  name: 'Thumbnail', st: 'youtube',  ratio: [16, 9], image: true, note: 'النظرة الوحيدة — لقطة 29', minW: 1280, suggest: 'S29' },
  { id: 'reel1',  name: 'Reels 1 · السوستة وصوت القفل', st: 'instagram', ratio: [9, 16], note: '1:30.2 — لقطة 14', suggest: 'S14' },
  { id: 'reel2',  name: 'Reels 2 · الجاكيت ينقلب', st: 'instagram', ratio: [9, 16], note: '2:47.3 — لقطة 23', suggest: 'S23' },
  { id: 'reel3',  name: 'Reels 3 · النظرة', st: 'instagram', ratio: [9, 16], note: '3:51.8 — لقطة 29', suggest: 'S29' },
  { id: 'tiktok', name: 'TikTok', st: 'tiktok', ratio: [9, 16], note: 'نسخة عمودية' },
  { id: 'canvas', name: 'Spotify Canvas', st: 'distrokid', ratio: [9, 16], minD: 3, maxD: 8, note: '3–8 ث، لوب. يترفع من DistroKid' }
];

/* ================= shots model ================= */
const parseStates = s => {
  const out = {}; if (!s || s === '—') return out;
  for (const m of s.matchAll(/([HWD])(\d)(?:→[HWD]?(\d))?/g)) out[m[1]] = { a: +m[2], b: m[3] != null ? +m[3] : +m[2] };
  return out;
};
const toolKeys = str => {
  const k = []; const s = str || '';
  if (/H3/.test(s)) k.push('H3');
  if (/Kling/.test(s)) k.push('Kling');
  if (/Veo/.test(s)) k.push('Veo');
  if (/صور|صورة|مونتاج|ماسك/.test(s)) k.push('Montage');
  return k.length ? k : ['H3'];
};
const SHOTS = D.shots.map(s => ({
  ...s, label: String(s.n).padStart(2, '0'), states: parseStates(s.states), statesRaw: s.states, tools: toolKeys(s.tool), set: 'v7'
}));
const byN = n => SHOTS.find(s => s.n === n);
const LONGS = D.longs.map((l, i) => {
  const nums = (l.from_.match(/\d+/g) || []).map(Number);
  let range = nums;
  if (/→/.test(l.from_) && nums.length >= 2) { range = []; for (let k = nums[0]; k <= nums[1]; k++) range.push(k); }
  const covered = range.map(byN).filter(Boolean);
  let start = l.start, end = l.end;
  const d = parseFloat(String(l.dur).replace('~', ''));
  if (end == null && start != null && !isNaN(d)) end = +(start + d).toFixed(2);
  const first = covered[0], last = covered[covered.length - 1];
  const states = {};
  for (const k of ['H', 'W', 'D']) {
    const a = covered.find(c => c.states[k])?.states[k]?.a;
    const b = [...covered].reverse().find(c => c.states[k])?.states[k]?.b;
    if (a != null) states[k] = { a, b: b ?? a };
  }
  const lyric = D.cues.filter(c => c.s < end && c.e > start).map(c => c.t).join(' / ');
  const kind = l.id.startsWith('B') ? 'B' : l.id.startsWith('A/B') ? 'AB' : 'A';
  return {
    id: 'L' + (i + 1), label: l.id, n: 100 + i, start, end, lyric, desc: l.events, camera: l.camera,
    states, statesRaw: Object.entries(states).map(([k, v]) => k + v.a + (v.b !== v.a ? '→' + v.b : '')).join(' '),
    tool: kind === 'B' ? 'Veo' : kind === 'AB' ? 'Kling4 + Veo' : 'Kling4', tools: kind === 'B' ? ['Veo'] : kind === 'AB' ? ['Kling4', 'Veo'] : ['Kling4'],
    covers: covered.map(c => c.id), set: 'v71', kind, durLabel: l.dur, time: l.time, first: first?.id, last: last?.id
  };
});
const ALL = [...SHOTS, ...LONGS];
const shotById = id => ALL.find(s => s.id === id);

/* ================= state ================= */
function defaults() {
  return {
    v: 1,
    room: 'stations',
    stations: STATIONS.map(s => ({ id: s.id, plan: '', cost: '', currency: 'USD', renew: '', credits: s.credits ?? '', creditsAt: s.creditsAt ?? '', on: true })),
    customStations: [],
    bpm: { value: 74, confirmed: false, offset: 1.3, source: 'Notion (غير مؤكد)' },
    set: 'v7',
    shots: {},
    takes: {},
    refs: {},
    ledger: [],
    locks: {
      black: 'light, short, youthful, collarless, zip-front matte black crepe jacket over a one-shoulder blouse, tailored bermuda shorts with a thin gold hem, loafers exactly as SHOE_REF',
      crimson: 'the same light, short, collarless jacket turned to its other face: matte crimson velvet with a thin gold line on the edge, worn over the one-shoulder blouse, tailored bermuda shorts with a thin gold hem, loafers exactly as SHOE_REF',
      accessories: 'plain thin gold rolo chain, no pendant, no bracelet, no earrings',
      identity: 'IDENTITY LOCK: the same woman as FACE_REF in every frame — same face, age, skin and build.'
    },
    release: { checks: {}, meta: { title: 'I Am The World', artist: 'Liine24', date: '', isrc: '', upc: '', lang: 'English' }, cover: null, coverMeta: null, dest: {} },
    tl: { zoom: 6, lanes: { cues: true, H: true, W: true, D: true } },
    audio: null
  };
}
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && raw.v === 1) {
      const d = defaults();
      return { ...d, ...raw, locks: { ...d.locks, ...raw.locks }, release: { ...d.release, ...raw.release, meta: { ...d.release.meta, ...raw.release?.meta } }, tl: { ...d.tl, ...raw.tl } };
    }
  } catch (e) { /* first run or private mode */ }
  return defaults();
}
let S = load();
let saveT;
function save() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('ما قدرت أحفظ بالمتصفح'); } }, 120); }
function shotState(id) {
  if (!S.shots[id]) {
    const s = shotById(id);
    S.shots[id] = { status: 'idea', action: '', camera: s?.camera || '', bars: '', meaning: '', refs: false, tool: s?.tools[0] || 'H3', start: null, end: null, takes: [], approved: null, fails: 0, notes: '', sound: '' };
  }
  return S.shots[id];
}
const stationById = id => STATIONS.find(s => s.id === id) || S.customStations.find(s => s.id === id);
const stationState = id => S.stations.find(s => s.id === id) || S.customStations.find(s => s.id === id);

/* ================= derived ================= */
const barLen = () => 240 / (S.bpm.value || 74);
function gateOf(id) {
  const st = shotState(id), sh = shotById(id);
  return {
    start: !!st.start, end: !!st.end, refs: !!st.refs, action: st.action.trim().length > 3,
    frame: st.camera.trim().length > 3, bars: num(st.bars) > 0, lyric: !!sh?.lyric, meaning: st.meaning.trim().length > 1
  };
}
const gateScore = id => Object.values(gateOf(id)).filter(Boolean).length;
function actionWarnings(text) {
  const w = [];
  if (/(ثم|بعدين|وبعد|and then|, then| then )/i.test(text)) w.push('يبدو فيه أكثر من فعل — فعل واحد لكل كليب (غلطة 13)');
  return w;
}
function cameraWarnings(text) {
  const w = [];
  if (/\d+\s?mm/i.test(text)) w.push('عدسة بالأرقام — الموديل ما يلتزم فيها. اوصف الكادر نفسه');
  if (/(looks? at (the )?camera|تباوع للكاميرا)/i.test(text)) w.push('النظرة للكاميرا مسموحة مرة وحدة بس (3:48) — حدد الزمن (غلطة 16)');
  return w;
}
function continuity() {
  const errs = [];
  const list = SHOTS.slice().sort((a, b) => a.start - b.start);
  let prev = {};
  for (const s of list) {
    for (const k of ['H', 'W']) {
      const v = s.states[k]; if (!v) continue;
      if (prev[k] && v.a < prev[k].v) errs.push({ id: s.id, msg: `${k}${v.a} بعد ${k}${prev[k].v} (لقطة ${prev[k].id.slice(1)}) — الحالة ترجع لورا` });
      prev[k] = { v: v.b, id: s.id };
    }
    if (s.states.W && (s.states.W.a === 4 || s.states.W.b === 4) && s.end <= RED_AT) errs.push({ id: s.id, msg: 'W4 (الأحمر) قبل 2:46' });
  }
  for (const [tid, t] of Object.entries(S.takes)) {
    const sh = shotById(t.shot);
    if (sh && sh.start < RED_AT && t.qc?.metrics?.red > 0.006) errs.push({ id: sh.id, take: tid, msg: `لقطة ${sh.label}: الفحص لقى أحمر ${(t.qc.metrics.red * 100).toFixed(1)}% قبل 2:46` });
  }
  return errs;
}
function estimateShot(sh) {
  // MAP_v7 assumptions: 2 frames × 2 tries × 2 credits; video × 2.5 tries
  let c = 0, unknown = false;
  for (const k of sh.tools) {
    const t = TOOLS[k];
    if (t.kind === 'video') { if (t.cost == null) unknown = true; else c += t.cost * 2.5; }
  }
  c += 2 * 2 * TOOLS.Image.cost;
  return { c: Math.round(c), unknown };
}
const spent = () => S.ledger.reduce((a, e) => a + (+e.credits || 0), 0);

/* ================= prompt builder ================= */
function buildPrompt(id) {
  const sh = shotById(id), st = shotState(id), tool = st.tool;
  const L = S.locks;
  const red = sh.start >= RED_AT || sh.states.W?.b === 4;
  const wardrobe = red ? L.crimson : L.black;
  const H = sh.states.H ? STATE_EN.H[sh.states.H.b] : null;
  const W = sh.states.W && !red ? STATE_EN.W[sh.states.W.b] : null;
  const stone = /حجر|stone/.test(sh.desc) ? 'The black stone is submerged 25 cm below the surface and clearly visible under the water; she never stands on the surface.' : '';
  const water = 'Water dead-still except one soft ring; no splashing.';
  const action = st.action.trim() || '[فعل واحد]';
  const cam = st.camera.trim() || '[وصف الكادر]';
  const noRed = red ? '' : 'No red anywhere in frame.';
  const phys = 'Everything physical: no particles, no glow.';
  const bars = num(st.bars) ? `${st.bars} bars (${(num(st.bars) * barLen()).toFixed(1)} s)` : '[المدة بالمازورات]';
  let inputs = [], prompt = '';
  const refsStd = ['FACE_REF', red ? 'CRIMSON_REF' : 'BLACK_REF v2', 'SHOE_REF', 'LOCATION'];
  switch (tool) {
    case 'H3':
      inputs = ['start_image ← صورة البداية', 'end_image ← صورة النهاية', 'بدون image_references (ما تنخلط مع الكيفريم)'];
      prompt = [`Same woman as the start frame.`, action + '.', cam + '.', 'Camera not moving.', water, st.sound ? st.sound + '.' : '', `The motion takes the entire clip.`].filter(Boolean).join(' ');
      break;
    case 'Veo':
      inputs = ['start_image ← صورة البداية (ماكرو)', 'بدون وجه بالكادر'];
      prompt = [`Macro shot, no face in frame.`, action + '.', cam + '.', water, phys, noRed].filter(Boolean).join(' ');
      break;
    case 'Kling': case 'Kling4':
      inputs = ['start_image', 'end_image', ...refsStd.map(r => 'ref ← ' + r)];
      prompt = [L.identity, `She wears ${wardrobe}${W ? ', ' + W : ''}; ${L.accessories}.`, H ? `Hair: ${H}.` : '', action + '.', `Camera: ${cam}. One camera move only.`, stone, water, phys, noRed, `Duration: ${bars}.`].filter(Boolean).join('\n');
      break;
    case 'Seedance':
      inputs = ['omni_reference ← FACE_REF', '← ' + refsStd[1], '← SHOE_REF', 'video_reference ← كليب معتمد للإيقاع'];
      prompt = [L.identity, action + '.', cam + '.', stone, water, phys, noRed].filter(Boolean).join(' ');
      break;
    case 'Grok':
      inputs = refsStd.concat(['صورة البداية', 'صورة النهاية']).map((r, i) => `<IMAGE_${i + 1}> ← ${r}`);
      prompt = [`<IMAGE_1> is her face. <IMAGE_2> is her outfit. <IMAGE_3> are her shoes. <IMAGE_4> is the place.`, action + '.', 'Camera not moving.', water, noRed, '10 seconds.'].filter(Boolean).join(' ');
      break;
    default: // Image / Edit / Montage → frame prompt
      inputs = refsStd.map((r, i) => `${i + 1}. ${r}`);
      prompt = [L.identity, `She wears ${wardrobe}${W ? ', ' + W : ''}; ${L.accessories}.`, H ? `Hair: ${H}.` : '', `Frame: ${cam}.`, `Moment: ${action}.`, stone, 'Water dead-still.', phys, noRed].filter(Boolean).join('\n');
  }
  const words = prompt.split(/\s+/).filter(Boolean).length;
  const warns = [];
  if (tool === 'H3' && words > 60) warns.push(`${words} كلمة — H3 يشتغل أحسن تحت 60`);
  if (tool === 'Veo' && /وجه|face|profile|بروفايل/.test(sh.desc + action)) warns.push('Veo للماكرو بدون وجه — هاللقطة فيها وجه');
  if (!red && /crimson|red|أحمر/i.test(action + cam)) warns.push('أحمر قبل 2:46 — ممنوع');
  return { prompt, inputs, words, warns: warns.concat(actionWarnings(action), cameraWarnings(cam)) };
}

/* expose for part 2 */
window.__RS = { $, $$, esc, uid, clamp, tc, tcShort, num, fmtN, toast, copy, download, svg, Media, srcOf, hydrate, mediaTag, probe, pickFiles,
  STATIONS, TOOLS, STATUS, GATE, STATE_TXT, REF_SLOTS, QC_CHECKS, DESTS, SHOTS, LONGS, ALL, shotById, D, SONG, RED_AT,
  get S() { return S; }, set S(v) { S = v; }, save, defaults, shotState, stationById, stationState, barLen, gateOf, gateScore,
  actionWarnings, cameraWarnings, continuity, estimateShot, spent, buildPrompt };
})();
