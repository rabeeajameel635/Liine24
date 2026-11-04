// غرفة الإخراج — local server. Run: node server/index.ts (Node 24+ strips TypeScript types natively).
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { openDb, NotApprovedError } from './db.ts';
import { libraryRoutes } from './library.ts';
import { characterRoutes, seedDonia } from './characters.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const dataDir = process.env.GHORFA_DATA ?? join(homedir(), 'Library', 'Application Support', 'Ghorfa');
const db = openDb(join(dataDir, 'ghorfa.sqlite'));
const PORT = Number(process.env.PORT ?? 4317);
const HOST = process.env.HOST ?? '127.0.0.1'; // LAN access for the phone PWA comes later, opt-in

const app = Fastify({ logger: false });

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof NotApprovedError) return reply.code(409).send({ what: err.message, fix: 'افتح الورقة ودوس «اعتمد».' });
  reply.code(500).send({ what: 'حصل خطأ في السيرفر', fix: 'جرّب تاني. لو اتكرر، ابعت السطر ده للمساعد.', detail: err instanceof Error ? err.message : String(err) });
});

await libraryRoutes(app, db, dataDir);
seedDonia(db);
await characterRoutes(app, db);

app.get('/api/health', async () => ({ ok: true, version: '0.1.0' }));

app.get('/api/bootstrap', async () => {
  const brands = db.prepare('SELECT id, name, line FROM brand ORDER BY name').all();
  const projects = db.prepare(`SELECT p.id, p.title, p.brand_id, b.name AS brand, b.line FROM project p JOIN brand b ON b.id = p.brand_id ORDER BY p.created_at`).all();
  const count = (t: string) => (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
  return { brands, projects, counts: { assets: count('asset'), characters: count('character'), songs: count('song'), jobs: count('job') } };
});

const dist = join(root, 'web', 'dist');
if (existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist });
  app.setNotFoundHandler((req, reply) => req.url.startsWith('/api/') ? reply.code(404).send({ what: 'مش موجود' }) : reply.sendFile('index.html'));
}

await app.listen({ port: PORT, host: HOST });
console.log(`غرفة الإخراج → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
