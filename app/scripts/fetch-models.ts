// Download the face models from OpenCV Zoo and verify each file against the SHA-256 recorded in OpenCV's repo
// (Git LFS pointers at opencv/opencv_zoo@48b10fa505aeb51fbd127fc60a5c660040e823b7). A file that does not match is deleted.
// Usage (on the Mac): node scripts/fetch-models.ts
//   YuNet  face detector   — MIT (models/face_detection_yunet/LICENSE)
//   SFace  face recognizer — Apache-2.0 (models/face_recognition_sface/LICENSE)
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const MODELS = [
  { file: 'face_detection_yunet_2023mar.onnx', path: 'models/face_detection_yunet', sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4', size: 232589, license: 'MIT' },
  { file: 'face_recognition_sface_2021dec.onnx', path: 'models/face_recognition_sface', sha256: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79', size: 38696353, license: 'Apache-2.0' }
];
const dir = join(process.env.GHORFA_DATA ?? join(homedir(), 'Library', 'Application Support', 'Ghorfa'), 'models');
await mkdir(dir, { recursive: true });
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

for (const m of MODELS) {
  const out = join(dir, m.file);
  if (existsSync(out) && sha(await readFile(out)) === m.sha256) { console.log(`✓ ${m.file} موجود وسليم`); continue; }
  const url = `https://github.com/opencv/opencv_zoo/raw/48b10fa505aeb51fbd127fc60a5c660040e823b7/${m.path}/${m.file}`;
  const res = await fetch(url);
  if (!res.ok) { console.error(`✗ ${m.file}: HTTP ${res.status}`); process.exitCode = 1; continue; }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length !== m.size || sha(buf) !== m.sha256) { await rm(out, { force: true }); console.error(`✗ ${m.file}: الحجم أو البصمة مش مطابقين — اتمسح`); process.exitCode = 1; continue; }
  await writeFile(out, buf);
  console.log(`✓ ${m.file} (${m.license}) اتنزل واتأكد`);
}
