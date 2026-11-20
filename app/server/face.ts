// Face match: YuNet (detector, MIT) + SFace (recognizer, Apache-2.0) through onnxruntime-node (MIT). No InsightFace.
// The models come from `npm run models` (hash-checked) into <data>/models. Without them every face score is «مستني الماك».
//
// «٩٥٪» = 95 % of the similarity Donia's approved pictures have with each other, not a raw number:
//   ref = mean cosine(A, each approved face picture)      → that is 100 %
//   score(candidate) = cosine(candidate, A) / ref × 100   (capped at 100)
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DB } from './db.ts';

const run = promisify(execFile);
export const MODELS = { yunet: 'face_detection_yunet_2023mar.onnx', sface: 'face_recognition_sface_2021dec.onnx' };
export const modelsReady = (dataDir: string) => existsSync(join(dataDir, 'models', MODELS.yunet)) && existsSync(join(dataDir, 'models', MODELS.sface));

export type Img = { w: number; h: number; rgb: Uint8Array };
export type Face = { x: number; y: number; w: number; h: number; score: number; kps: [number, number][] };

/** Decode any picture (or a video frame at time t) to RGB, optionally scaled so the long side is ≤ maxSide. */
export async function decodeRGB(path: string, maxSide = 0, t?: number): Promise<Img> {
  const { stdout: probe } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path]);
  let [w, h] = probe.trim().split(',').map(Number);
  if (maxSide && Math.max(w, h) > maxSide) { const k = maxSide / Math.max(w, h); w = Math.round(w * k / 2) * 2; h = Math.round(h * k / 2) * 2; }
  const args = ['-v', 'error', ...(t != null ? ['-ss', String(t)] : []), '-i', path, '-frames:v', '1', '-vf', `scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'];
  const { stdout } = await run('ffmpeg', args, { encoding: 'buffer', maxBuffer: 1 << 28 }) as unknown as { stdout: Buffer };
  return { w, h, rgb: new Uint8Array(stdout.buffer, stdout.byteOffset, w * h * 3) };
}

// ---------- geometry (pure, tested without models) ----------
/** 2-D similarity transform (Umeyama) mapping src points onto dst: returns [a, -b, tx; b, a, ty]. */
export function similarity(src: [number, number][], dst: [number, number][]) {
  const n = src.length; let sx = 0, sy = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { sx += src[i][0]; sy += src[i][1]; dx += dst[i][0]; dy += dst[i][1]; }
  sx /= n; sy /= n; dx /= n; dy /= n;
  let a = 0, b = 0, ss = 0;
  for (let i = 0; i < n; i++) {
    const x = src[i][0] - sx, y = src[i][1] - sy, u = dst[i][0] - dx, v = dst[i][1] - dy;
    a += x * u + y * v; b += x * v - y * u; ss += x * x + y * y;
  }
  a /= ss; b /= ss;
  return { a, b, tx: dx - (a * sx - b * sy), ty: dy - (b * sx + a * sy) };
}
/** Reference landmarks of SFace's 112×112 input (OpenCV FaceRecognizerSF). */
export const SFACE_REF: [number, number][] = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]];

/** Warp the face to 112×112 with bilinear sampling (inverse mapping). */
export function alignCrop(img: Img, kps: [number, number][], size = 112): Uint8Array {
  const { a, b, tx, ty } = similarity(kps, SFACE_REF);
  const det = a * a + b * b; const out = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // inverse of [a -b; b a] applied to (x - tx, y - ty)
    const X = x - tx, Y = y - ty; const u = (a * X + b * Y) / det, v = (-b * X + a * Y) / det;
    const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
    for (let c = 0; c < 3; c++) {
      const p = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= img.w || yy >= img.h) ? 0 : img.rgb[(yy * img.w + xx) * 3 + c];
      out[(y * size + x) * 3 + c] = Math.round(p(x0, y0) * (1 - fx) * (1 - fy) + p(x0 + 1, y0) * fx * (1 - fy) + p(x0, y0 + 1) * (1 - fx) * fy + p(x0 + 1, y0 + 1) * fx * fy);
    }
  }
  return out;
}
export const cosine = (p: Float32Array | number[], q: Float32Array | number[]) => { let d = 0, a = 0, b = 0; for (let i = 0; i < p.length; i++) { d += p[i] * q[i]; a += p[i] * p[i]; b += q[i] * q[i]; } return d / Math.sqrt(a * b); };
export const iou = (p: Face, q: Face) => { const x1 = Math.max(p.x, q.x), y1 = Math.max(p.y, q.y), x2 = Math.min(p.x + p.w, q.x + q.w), y2 = Math.min(p.y + p.h, q.y + q.h); const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1); return i / (p.w * p.h + q.w * q.h - i); };
export function nms(faces: Face[], thr = 0.3) { const out: Face[] = []; for (const f of [...faces].sort((a, b) => b.score - a.score)) if (out.every(o => iou(o, f) < thr)) out.push(f); return out; }
export const percentOf = (cos: number, ref: number) => Math.max(0, Math.min(100, Math.round(cos / ref * 100)));

// ---------- models (run on the Mac) ----------
type Sess = { run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array; dims: number[] }>>; inputNames: string[]; outputNames: string[] };
let cache: { det: Sess; rec: Sess; Tensor: new (t: string, d: Float32Array, dims: number[]) => unknown } | null = null;
async function sessions(dataDir: string) {
  if (cache) return cache;
  const ort = await import('onnxruntime-node') as unknown as { InferenceSession: { create: (p: string) => Promise<Sess> }; Tensor: new (t: string, d: Float32Array, dims: number[]) => unknown };
  cache = { det: await ort.InferenceSession.create(join(dataDir, 'models', MODELS.yunet)), rec: await ort.InferenceSession.create(join(dataDir, 'models', MODELS.sface)), Tensor: ort.Tensor };
  return cache;
}

/** YuNet: input padded to a multiple of 32, BGR float 0–255 (as OpenCV's FaceDetectorYN feeds it). */
export async function detect(dataDir: string, img: Img, minScore = 0.6): Promise<Face[]> {
  const s = await sessions(dataDir);
  const W = Math.ceil(img.w / 32) * 32, H = Math.ceil(img.h / 32) * 32;
  const t = new Float32Array(3 * W * H);
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const i = (y * img.w + x) * 3, o = y * W + x;
    t[o] = img.rgb[i + 2]; t[W * H + o] = img.rgb[i + 1]; t[2 * W * H + o] = img.rgb[i];
  }
  const out = await s.det.run({ [s.det.inputNames[0]]: new s.Tensor('float32', t, [1, 3, H, W]) });
  const faces: Face[] = [];
  for (const st of [8, 16, 32]) {
    const cls = out[`cls_${st}`].data, obj = out[`obj_${st}`].data, bb = out[`bbox_${st}`].data, kp = out[`kps_${st}`].data;
    const cols = W / st, rows = H / st;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c; const sc = Math.sqrt(Math.min(1, Math.max(0, cls[i])) * Math.min(1, Math.max(0, obj[i])));
      if (sc < minScore) continue;
      const cx = (c + bb[i * 4]) * st, cy = (r + bb[i * 4 + 1]) * st, w = Math.exp(bb[i * 4 + 2]) * st, h = Math.exp(bb[i * 4 + 3]) * st;
      const kps = [0, 1, 2, 3, 4].map(n => [(kp[i * 10 + 2 * n] + c) * st, (kp[i * 10 + 2 * n + 1] + r) * st] as [number, number]);
      faces.push({ x: cx - w / 2, y: cy - h / 2, w, h, score: sc, kps });
    }
  }
  return nms(faces);
}

/** SFace: aligned 112×112, RGB float 0–255 NCHW → 128-d feature. */
export async function embed(dataDir: string, img: Img, face: Face): Promise<Float32Array> {
  const s = await sessions(dataDir); const a = alignCrop(img, face.kps); const t = new Float32Array(3 * 112 * 112);
  for (let i = 0; i < 112 * 112; i++) { t[i] = a[i * 3]; t[112 * 112 + i] = a[i * 3 + 1]; t[2 * 112 * 112 + i] = a[i * 3 + 2]; }
  const out = await s.rec.run({ [s.rec.inputNames[0]]: new s.Tensor('float32', t, [1, 3, 112, 112]) });
  return Float32Array.from(out[s.rec.outputNames[0]].data);
}

// ---------- baseline (A) ----------
export function migrateFace(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS face_baseline (asset_id TEXT PRIMARY KEY, embedding TEXT NOT NULL, ref_sim REAL NOT NULL, compared TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
}
/** The most frontal, largest face: widest distance between the eyes (in pixels), weighted by detection score. */
export const frontal = (faces: Face[]) => [...faces].sort((p, q) => Math.abs(q.kps[1][0] - q.kps[0][0]) * q.score - Math.abs(p.kps[1][0] - p.kps[0][0]) * p.score)[0];

export async function buildBaseline(db: DB, dataDir: string) {
  migrateFace(db);
  const base = db.prepare(`SELECT id, work_path FROM asset WHERE face_baseline = 1`).get() as { id: string; work_path: string } | undefined;
  if (!base) throw new Error('مفيش خط أساس');
  const bImg = await decodeRGB(base.work_path, 1600); const bFace = frontal(await detect(dataDir, bImg)); if (!bFace) throw new Error('مفيش وش في خط الأساس');
  const bEmb = await embed(dataDir, bImg, bFace);
  // the approved face pictures of Donia (not A itself, not ones blocked for other reasons than the earring)
  const others = db.prepare(`SELECT a.id, a.work_path FROM asset a WHERE a.character_id = 'donia' AND a.face_baseline = 0 AND a.kind = 'image' AND a.folder = 'وش دنيا · خلفية بيضا'
    AND EXISTS (SELECT 1 FROM approval p WHERE p.subject_type = 'asset' AND p.subject_id = a.id)`).all() as { id: string; work_path: string }[];
  const sims: number[] = [];
  for (const o of others) { const im = await decodeRGB(o.work_path, 1600); const f = frontal(await detect(dataDir, im)); if (f) sims.push(cosine(bEmb, await embed(dataDir, im, f))); }
  if (!sims.length) throw new Error('محتاج صورة وش معتمدة تانية للمقارنة');
  const ref = sims.reduce((x, y) => x + y, 0) / sims.length;
  db.prepare(`INSERT OR REPLACE INTO face_baseline (asset_id, embedding, ref_sim, compared) VALUES (?, ?, ?, ?)`).run(base.id, JSON.stringify([...bEmb]), ref, JSON.stringify(others.map(o => o.id)));
  return { ref, compared: sims.length };
}

/** Best face in the picture vs A, as % of the baseline similarity. null when there is no face (a back or a silhouette). */
export async function faceScore(db: DB, dataDir: string, imgs: Img[]): Promise<{ pct: number | null; faces: number }> {
  migrateFace(db);
  let b = db.prepare('SELECT embedding, ref_sim FROM face_baseline').get() as { embedding: string; ref_sim: number } | undefined;
  if (!b) { await buildBaseline(db, dataDir); b = db.prepare('SELECT embedding, ref_sim FROM face_baseline').get() as { embedding: string; ref_sim: number }; }
  const base = JSON.parse(b.embedding) as number[]; let best: number | null = null, n = 0;
  for (const im of imgs) for (const f of await detect(dataDir, im)) { n++; const c = cosine(base, await embed(dataDir, im, f)); best = best == null ? c : Math.max(best, c); }
  return { pct: best == null ? null : percentOf(best, b.ref_sim), faces: n };
}
