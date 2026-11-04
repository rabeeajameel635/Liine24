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
