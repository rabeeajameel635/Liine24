// Media import: probe with ffprobe, keep the original, enforce the resolution cap on the working copy, make a thumbnail.
// The cap lives here (and in the generator adapters), not in the UI.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { extname, join, basename } from 'node:path';
import type { DB } from './db.ts';

const run = promisify(execFile);
export const CAP = { videoW: 1920, videoH: 1080, imageLong: 2048 } as const;

export type Probe = { kind: 'video' | 'image' | 'audio' | 'doc'; width?: number; height?: number; duration?: number };

export async function probe(path: string): Promise<Probe> {
  const ext = extname(path).toLowerCase();
  if (['.pdf', '.txt', '.md', '.json'].includes(ext)) return { kind: 'doc' };
  try {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,duration:format=duration', '-of', 'json', path]);
    const j = JSON.parse(stdout) as { streams?: { codec_type: string; width?: number; height?: number; duration?: string }[]; format?: { duration?: string } };
    const v = j.streams?.find(s => s.codec_type === 'video');
    const isStill = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.avif', '.gif'].includes(ext);
    if (v && isStill) return { kind: 'image', width: v.width, height: v.height };
    if (v) return { kind: 'video', width: v.width, height: v.height, duration: Number(j.format?.duration ?? v.duration ?? 0) || undefined };
    if (j.streams?.some(s => s.codec_type === 'audio')) return { kind: 'audio', duration: Number(j.format?.duration ?? 0) || undefined };
  } catch { /* not a media file */ }
  return { kind: 'doc' };
}

export function sha256(path: string): Promise<string> {
  return new Promise((res, rej) => {
    const h = createHash('sha256');
    createReadStream(path).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej);
  });
}

export function overCap(p: Probe): boolean {
  if (!p.width || !p.height) return false;
  if (p.kind === 'video') {
    const [long, short] = p.width >= p.height ? [p.width, p.height] : [p.height, p.width];
    return long > CAP.videoW || short > CAP.videoH; // 1080p in either orientation
  }
  if (p.kind === 'image') return Math.max(p.width, p.height) > CAP.imageLong;
  return false;
}

async function capped(src: string, dst: string, p: Probe) {
  if (p.kind === 'image') {
    const scale = `scale='if(gt(iw,ih),min(${CAP.imageLong},iw),-2)':'if(gt(iw,ih),-2,min(${CAP.imageLong},ih))'`;
    await run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', scale, '-q:v', '2', dst]);
  } else {
    // fit inside 1920×1080 (or 1080×1920 for vertical), keep aspect, even dims
    const portrait = (p.height ?? 0) > (p.width ?? 0);
    const [w, h] = portrait ? [CAP.videoH, CAP.videoW] : [CAP.videoW, CAP.videoH];
    await run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', `scale=w=${w}:h=${h}:force_original_aspect_ratio=decrease:force_divisible_by=2`, '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-c:a', 'copy', '-movflags', '+faststart', dst]);
  }
}

/** Finds the main content panel of a sheet-style image (panels on a light background with light gutters).
 *  Returns a crop box in source pixels, or null when there is nothing worth trimming. Used for grid thumbnails only. */
export async function contentBox(src: string, p: Probe): Promise<{ x: number; y: number; w: number; h: number } | null> {
  if (p.kind !== 'image' || !p.width || !p.height) return null;
  const W = 240, H = Math.max(1, Math.round(W * p.height / p.width));
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', src, '-vf', `scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 1 << 24 }) as unknown as { stdout: Buffer };
  if (stdout.length < W * H) return null;
  const light = (v: number) => v > 222;
  // a line is a gutter when almost all of it is near-white
  const segs = (n: number, isGutter: (i: number) => boolean) => {
    const out: [number, number][] = []; let s = -1;
    for (let i = 0; i <= n; i++) { const g = i === n || isGutter(i); if (!g && s < 0) s = i; if (g && s >= 0) { out.push([s, i]); s = -1; } }
    return out;
  };
  const colGutter = (x: number) => { let k = 0; for (let y = 0; y < H; y++) if (light(stdout[y * W + x])) k++; return k / H > 0.9; };
  const cols = segs(W, colGutter).filter(([a, b]) => b - a > W * 0.12);
  if (!cols.length) return null;
  const mid = W / 2;
  const [x0, x1] = cols.find(([a, b]) => a <= mid && b >= mid) ?? cols.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
  const rowGutter = (y: number) => { let k = 0; for (let x = x0; x < x1; x++) if (light(stdout[y * W + x])) k++; return k / (x1 - x0) > 0.9; };
  const rows = segs(H, rowGutter).filter(([a, b]) => b - a > H * 0.12).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
  const [y0, y1] = rows[0] ?? [0, H];
  if ((x1 - x0) * (y1 - y0) > W * H * 0.9) return null; // nothing meaningful to trim
  const s = p.width / W;
  return { x: Math.floor(x0 * s), y: Math.floor(y0 * s), w: Math.ceil((x1 - x0) * s), h: Math.ceil((y1 - y0) * s) };
}

export async function thumb(src: string, dst: string, p: Probe) {
  const args = ['-v', 'error', '-y'];
  if (p.kind === 'video') args.push('-ss', String(Math.min(1, (p.duration ?? 2) / 2)));
  const box = p.kind === 'image' ? await contentBox(src, await probe(src)).catch(() => null) : null; // src may be the capped copy
  const crop = box ? `crop=${box.w}:${box.h}:${box.x}:${box.y},` : '';
  args.push('-i', src, '-frames:v', '1', '-vf', `${crop}scale='if(gt(iw,ih),-2,640)':'if(gt(iw,ih),640,-2)'`, '-q:v', '4', dst);
  await run('ffmpeg', args);
}

export type ImportMeta = {
  name?: string; label?: string; source?: 'drop' | 'watch' | 'higgsfield'; sourceRef?: string; folder?: string;
  projectId?: string; createdAt?: string; provenance?: Record<string, unknown>; role?: string; locked?: boolean; characterId?: string; tags?: string;
};

/** Import one file. Original is copied untouched; a capped working copy is made only when the original is over the cap. */
export async function importFile(db: DB, dataDir: string, file: string, meta: ImportMeta = {}): Promise<{ id: string; duplicate: boolean; capped: boolean }> {
  const hash = await sha256(file);
  const dup = db.prepare('SELECT id FROM asset WHERE sha256 = ?').get(hash) as { id: string } | undefined;
  if (dup) return { id: dup.id, duplicate: true, capped: false };
  const p = await probe(file);
  const id = randomUUID();
  const ext = extname(file).toLowerCase() || '.bin';
  const dirs = { o: join(dataDir, 'originals'), w: join(dataDir, 'work'), t: join(dataDir, 'thumbs') };
  await Promise.all(Object.values(dirs).map(d => mkdir(d, { recursive: true })));
  const original = join(dirs.o, `${hash}${ext}`);
  await copyFile(file, original);
  let work = original, isCapped = false;
  if (overCap(p)) { work = join(dirs.w, `${hash}${p.kind === 'video' ? '.mp4' : '.jpg'}`); await capped(original, work, p); isCapped = true; }
  let thumbPath: string | null = null;
  if (p.kind === 'image' || p.kind === 'video') { thumbPath = join(dirs.t, `${hash}.jpg`); await thumb(work, thumbPath, p).catch(() => { thumbPath = null; }); }
  const st = await stat(file);
  const name = meta.name ?? basename(file);
  db.prepare(`INSERT INTO asset (id, project_id, name, label, sha256, kind, width, height, duration, original_path, work_path, thumb_path, source, source_ref, folder,
      provenance, role, locked, character_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, meta.projectId ?? null, name, meta.label ?? null, hash, p.kind, p.width ?? null, p.height ?? null, p.duration ?? null, original, work, thumbPath,
    meta.source ?? 'drop', meta.sourceRef ?? null, meta.folder ?? null, JSON.stringify({ size: st.size, ...(meta.provenance ?? {}) }),
    meta.role ?? null, meta.locked ? 1 : 0, meta.characterId ?? null, meta.createdAt ?? new Date().toISOString());
  const prov = meta.provenance ?? {};
  db.prepare('INSERT INTO asset_fts (asset_id, name, label, prompt, tags) VALUES (?,?,?,?,?)').run(id, name, meta.label ?? '', String(prov.prompt ?? ''), [meta.folder, meta.tags, meta.role].filter(Boolean).join(' '));
  return { id, duplicate: false, capped: isCapped };
}
