// Audio analysis: decode with ffmpeg, waveform peaks, tempo (onset autocorrelation), first downbeat, SRT parsing.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const SR = 11025;

export async function decode(path: string): Promise<Float32Array> {
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', path, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { encoding: 'buffer', maxBuffer: 1 << 30 }) as unknown as { stdout: Buffer };
  return new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 4));
}

export function peaks(x: Float32Array, n = 2000): number[] {
  const step = Math.max(1, Math.floor(x.length / n)), out: number[] = [];
  for (let i = 0; i < n; i++) { let m = 0; for (let j = i * step, e = Math.min(x.length, j + step); j < e; j += 2) { const v = Math.abs(x[j]); if (v > m) m = v; } out.push(+m.toFixed(3)); }
  const mx = Math.max(...out, 1e-6); return out.map(v => +(v / mx).toFixed(3));
}

function onsetEnvelope(x: Float32Array) {
  const hop = Math.round(SR * 0.01), win = hop * 2, env: number[] = []; let prev = 0;
  for (let i = 0; i + win < x.length; i += hop) { let e = 0; for (let j = 0; j < win; j++) e += x[i + j] * x[i + j]; const l = Math.log(1e-9 + e); env.push(Math.max(0, l - prev)); prev = l; }
  return env; // 100 frames per second
}

/** Tempo candidates (BPM, relative confidence). Same method as the browser tool tested earlier (76 BPM test track → 76.25). */
export function tempo(x: Float32Array): { bpm: number; conf: number }[] {
  const env = onsetEnvelope(x);
  const from = Math.min(2000, Math.floor(env.length * 0.1)), to = Math.min(env.length, from + 15000);
  const seg = env.slice(from, to); const mean = seg.reduce((a, b) => a + b, 0) / seg.length; const o = seg.map(v => v - mean);
  const res: { bpm: number; s: number }[] = [];
  for (let bpm = 60; bpm <= 180; bpm += 0.1) {
    const lag = 6000 / bpm; let s = 0;
    for (let k = 1; k <= 4; k++) { const L = lag * k, l0 = Math.floor(L), fr = L - l0; for (let i = 0; i + l0 + 1 < o.length; i += 2) s += o[i] * (o[i + l0] * (1 - fr) + o[i + l0 + 1] * fr) / k; }
    res.push({ bpm: +bpm.toFixed(1), s });
  }
  res.sort((a, b) => b.s - a.s);
  // refine the best candidates to 0.01 BPM
  const score = (bpm: number) => { const lag = 6000 / bpm; let s = 0; for (let k = 1; k <= 4; k++) { const L = lag * k, l0 = Math.floor(L), fr = L - l0; for (let i = 0; i + l0 + 1 < o.length; i += 2) s += o[i] * (o[i + l0] * (1 - fr) + o[i + l0 + 1] * fr) / k; } return s; };
  for (const r of res.slice(0, 6)) { let best = r.bpm, bs = r.s; for (let b = r.bpm - 0.1; b <= r.bpm + 0.1; b += 0.01) { const v = score(b); if (v > bs) { bs = v; best = b; } } r.bpm = +best.toFixed(2); r.s = bs; }
  res.sort((a, b) => b.s - a.s);
  const picks: typeof res = []; for (const r of res) { if (picks.every(p => Math.abs(p.bpm - r.bpm) > 3)) picks.push(r); if (picks.length === 4) break; }
  return picks.map(p => ({ bpm: p.bpm, conf: +(p.s / picks[0].s).toFixed(2) }));
}

/** First downbeat estimate: the beat phase whose grid best matches onsets, placed at the first strong onset. */
export function beatOffset(x: Float32Array, bpm: number): number {
  const env = onsetEnvelope(x), period = 6000 / bpm;
  let best = 0, bestS = -1;
  for (let ph = 0; ph < period; ph += 1) { let s = 0; for (let t = ph; t < env.length; t += period) s += env[Math.round(t)] ?? 0; if (s > bestS) { bestS = s; best = ph; } }
  const thr = Math.max(...env) * 0.3; let first = env.findIndex(v => v > thr); if (first < 0) first = 0;
  let t = best; while (t + period < first - period / 2) t += period;
  return +(t / 100).toFixed(3);
}

export type Cue = { s: number; e: number; t: string };
export function parseSrt(text: string): Cue[] {
  const ts = (v: string) => { const [h, m, s] = v.trim().replace(',', '.').split(':'); return +h * 3600 + +m * 60 + +s; };
  return text.replace(/\r/g, '').trim().split(/\n\s*\n/).map(b => b.split('\n')).filter(l => l.length >= 3 && l[1].includes('-->'))
    .map(l => { const [a, b] = l[1].split('-->'); return { s: +ts(a).toFixed(3), e: +ts(b).toFixed(3), t: l.slice(2).join(' ').trim() }; });
}

/** Sections from lyric gaps (a pause ≥ 2.5 s starts a new section). */
export function sectionsFromCues(cues: Cue[], duration: number) {
  const out: { name: string; start: number }[] = [{ name: 'البداية', start: 0 }];
  for (let i = 1; i < cues.length; i++) if (cues[i].s - cues[i - 1].e >= 2.5) out.push({ name: cues[i].t.split(/[,.!?…]/)[0].slice(0, 32), start: cues[i].s });
  return out.filter(s => s.start < duration);
}

export const barLength = (bpm: number, beatsPerBar = 4) => 60 / bpm * beatsPerBar;
export const snapToBar = (t: number, bpm: number, offset: number, bpb = 4) => { const L = barLength(bpm, bpb); return +(offset + Math.round((t - offset) / L) * L).toFixed(3); };

// ---- beat tracking: songs that drift (Suno masters do) need bars that follow the real beats, not a fixed BPM ----

function fftMag2(re: Float64Array, im: Float64Array) { // in-place radix-2, returns |X|^2 for bins 0..n/2
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) {
      const p = i + k, q = p + len / 2, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
      re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti; const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } }
  }
  const out = new Float64Array(n / 2 + 1); for (let i = 0; i <= n / 2; i++) out[i] = re[i] * re[i] + im[i] * im[i]; return out;
}

/** Log-spectral flux, full band and bass band (30–150 Hz). ~394 frames per second. */
function flux(x: Float32Array) {
  const W = 512, HOP = 28, fps = SR / HOP, n = Math.floor(x.length / HOP), han = new Float64Array(W).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / W));
  const full = new Float64Array(n), low = new Float64Array(n); let prev: Float64Array | null = null;
  const lo0 = Math.ceil(30 * W / SR), lo1 = Math.floor(150 * W / SR);
  for (let f = 0; f < n; f++) {
    const re = new Float64Array(W), im = new Float64Array(W), c = f * HOP - W / 2;
    for (let i = 0; i < W; i++) { const k = c + i; re[i] = k >= 0 && k < x.length ? x[k] * han[i] : 0; }
    const m = fftMag2(re, im); for (let i = 0; i < m.length; i++) m[i] = Math.log1p(Math.sqrt(m[i]) * 10);
    if (prev) { let a = 0, b = 0; for (let i = 0; i < m.length; i++) { const d = m[i] - prev[i]; if (d > 0) { a += d; if (i >= lo0 && i <= lo1) b += d; } } full[f] = a; low[f] = b; }
    prev = m;
  }
  return { full, low, fps };
}

/** Pulse times (s) from a dynamic-programming beat tracker (Ellis 2007) around `pulseBpm`, plus the bar phase
 *  (which pulse of each `perBar` carries the strongest bass hits = the downbeat). */
export function trackBeats(x: Float32Array, pulseBpm: number, perBar = 8) {
  const { full, low, fps } = flux(x); const n = full.length;
  // high-pass (½ s moving average), rectify, normalise, light smoothing
  const half = Math.round(fps / 4); const pre = new Float64Array(n + 1); for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + full[i];
  let f = Array.from(full, (v, i) => { const a = Math.max(0, i - half), b = Math.min(n, i + half + 1); return Math.max(0, v - (pre[b] - pre[a]) / (b - a)); });
  const mean = f.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(f.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 1; f = f.map(v => v / sd);
  const k = [1, 3, 4, 3, 1]; f = f.map((_, i) => k.reduce((a, w, j) => a + w * (f[i + j - 2] ?? 0), 0) / 12);
  const period = fps * 60 / pulseBpm, tight = 100;
  const score = Float64Array.from(f), back = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const hi = Math.floor(i - period / 2); if (hi <= 0) continue;
    let best = -Infinity, bj = -1;
    for (let p = Math.max(0, Math.floor(i - 2 * period)); p < hi; p++) { const v = score[p] - tight * Math.log((i - p) / period) ** 2; if (v > best) { best = v; bj = p; } }
    score[i] = f[i] + best; back[i] = bj;
  }
  let i = n - Math.floor(2 * period); for (let j = i; j < n; j++) if (score[j] > score[i]) i = j;
  const idx: number[] = []; while (i >= 0) { idx.push(i); i = back[i]; } idx.reverse();
  const pulses = idx.map(v => +(v / fps).toFixed(4));
  // bar phase from bass onsets (local max within ±20 ms of each pulse)
  const r = Math.round(fps * 0.02), lm = idx.map(c => { let m = 0; for (let j = Math.max(0, c - r); j <= Math.min(n - 1, c + r); j++) m = Math.max(m, low[j]); return m; });
  const med = (a: number[]) => { const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)] ?? 0; };
  let phase = 0, bs = -1; for (let p = 0; p < perBar; p++) { const v = med(lm.filter((_, j) => j % perBar === p && j >= perBar)); if (v > bs) { bs = v; phase = p; } }
  const downbeats = pulses.filter((_, j) => j % perBar === phase);
  // local tempo (quarter = 2 pulses when the pulse is the eighth): least-squares slope per ~16 s window
  const q = perBar / 4; const local: { t: number; bpm: number }[] = [];
  for (let a = 0; a < pulses[pulses.length - 1]; a += 16) {
    const js = pulses.map((t, j) => [j, t] as const).filter(([, t]) => t >= a && t < a + 16); if (js.length < 5) continue;
    const mx = js.reduce((s, [j]) => s + j, 0) / js.length, my = js.reduce((s, [, t]) => s + t, 0) / js.length;
    const sl = js.reduce((s, [j, t]) => s + (j - mx) * (t - my), 0) / js.reduce((s, [j]) => s + (j - mx) ** 2, 0);
    local.push({ t: a, bpm: +(60 / sl / q).toFixed(2) });
  }
  const J = pulses.length, mj = (J - 1) / 2, mt = pulses.reduce((a, b) => a + b, 0) / J;
  const slope = pulses.reduce((s, t, j) => s + (j - mj) * (t - mt), 0) / pulses.reduce((s, _, j) => s + (j - mj) ** 2, 0);
  return { pulses, downbeats, phase, mean: +(60 / slope / q).toFixed(2), local };
}

/** Bar grid: follows measured downbeats when the song has them, else a fixed BPM grid. */
export function makeGrid(song: { bpm?: unknown; beat_offset?: unknown; beats_per_bar?: unknown; downbeats?: unknown; duration?: unknown }) {
  const db = JSON.parse(String(song.downbeats || '[]')) as number[];
  const bpm = Number(song.bpm), off = Number(song.beat_offset ?? 0), L = barLength(bpm, Number(song.beats_per_bar ?? 4));
  if (db.length < 4) return { measured: false, bar: L, snap: (t: number) => snapToBar(t, bpm, off), index: (t: number) => (t - off) / L, at: (i: number) => off + i * L };
  const avg = (db[db.length - 1] - db[0]) / (db.length - 1);
  const index = (t: number) => { // fractional bar index, extrapolated past both ends
    if (t <= db[0]) return (t - db[0]) / (db[1] - db[0]);
    for (let i = 1; i < db.length; i++) if (t <= db[i]) return i - 1 + (t - db[i - 1]) / (db[i] - db[i - 1]);
    return db.length - 1 + (t - db[db.length - 1]) / avg;
  };
  const at = (i: number) => i < 0 ? db[0] + i * avg : i < db.length ? db[i] : db[db.length - 1] + (i - db.length + 1) * avg;
  return { measured: true, bar: avg, index, at, snap: (t: number) => +at(Math.round(index(t))).toFixed(3) };
}
