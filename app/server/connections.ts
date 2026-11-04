// الاتصالات: official MCP servers on the user's own subscriptions (OAuth, no API keys), bridges for the rest.
// An MCP address stays locked until it is confirmed on the company's own website (source URL + quote recorded).
import type { FastifyInstance } from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, constants, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { DB } from './db.ts';
import { getSecret, setSecret, deleteSecret, keychainAvailable } from './secrets.ts';

const run = promisify(execFile);
type Kind = 'mcp' | 'bridge' | 'assistant' | 'analysis';
export type Service = { id: string; name: string; kind: Kind; url?: string; officialDomains?: string[]; site: string; provides: string[]; note: string; fallback?: string };

export const SERVICES: Service[] = [
  { id: 'higgsfield', name: 'Higgsfield', kind: 'mcp', url: 'https://mcp.higgsfield.ai/mcp', officialDomains: ['higgsfield.ai'], site: 'https://higgsfield.ai', provides: ['Kling', 'MiniMax', 'Seedance'], note: 'خطة Max' },
  { id: 'suno', name: 'Suno', kind: 'mcp', url: 'https://api.suno.com/mcp', officialDomains: ['suno.com'], site: 'https://suno.com', provides: ['الأغاني'], note: 'Beta من ٢٨ أكتوبر ٢٠٢٦', fallback: 'جسر Suno لو الـ MCP وقع' },
  { id: 'runway', name: 'Runway', kind: 'mcp', url: 'https://mcp.runwayml.com/mcp', officialDomains: ['runwayml.com', 'runway.com'], site: 'https://app.runwayml.com', provides: ['فيديو'], note: 'المستضاف للخطط · OAuth' },
  { id: 'grok', name: 'Grok Imagine', kind: 'bridge', site: 'https://grok.com/imagine', provides: ['فيديو'], note: 'الجسر الأسرع: كيت + برومبت + فولدر مراقَب' },
  { id: 'flow', name: 'Google Flow', kind: 'bridge', site: 'https://labs.google/fx/tools/flow', provides: ['Veo'], note: 'جسر' },
  { id: 'wan', name: 'Wan', kind: 'bridge', site: 'https://wan.video', provides: ['فيديو'], note: 'جسر' },
  { id: 'claude', name: 'Claude', kind: 'assistant', site: 'https://claude.ai', provides: ['المساعد'], note: 'عن طريق Claude Code على نفس الاشتراك' },
  { id: 'gemini', name: 'Gemini', kind: 'analysis', site: 'https://aistudio.google.com', provides: ['رأي تاني'], note: 'محتاج API key: مقفول لحد ما ربيع يوافق على التكلفة' }
];
if (process.env.GHORFA_TEST_MCP) SERVICES.push({ id: 'local-test', name: 'سيرفر تجربة محلي', kind: 'mcp', url: process.env.GHORFA_TEST_MCP, officialDomains: ['127.0.0.1'], site: process.env.GHORFA_TEST_MCP, provides: ['تجربة'], note: 'للتطوير بس' });

type Result = { ok: boolean; status: string; what: string; fix?: string; tools?: string[]; authorize_url?: string };

/** «حصل إيه / نصلّحه إزاي» for the errors people actually hit. */
function explain(e: unknown): Result {
  const m = e instanceof Error ? `${e.message} ${(e as { cause?: { code?: string } }).cause?.code ?? ''}` : String(e);
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/.test(m)) return { ok: false, status: 'error', what: 'مش قادر يوصل للسيرفر', fix: 'اتأكد إن النت شغال، وإن العنوان صح.' };
  if (/ECONNREFUSED|ECONNRESET|fetch failed|socket/i.test(m)) return { ok: false, status: 'error', what: 'السيرفر قفل الاتصال', fix: 'جرّب تاني بعد دقيقة. لو اتكرر، الخدمة ممكن تكون واقعة.' };
  if (/403|forbidden/i.test(m)) return { ok: false, status: 'error', what: 'الحساب مش مسموح له يستخدم الـ MCP', fix: 'اتأكد إن الخطة بتدعمه، أو إن الـ Beta اتفعّل لحسابك من موقع الشركة.' };
  if (/timeout|aborted/i.test(m)) return { ok: false, status: 'error', what: 'السيرفر ما ردّش في الوقت', fix: 'جرّب تاني. لو النت بطيء استنى شوية.' };
  return { ok: false, status: 'error', what: 'الاتصال وقع', fix: 'جرّب «اختبر الاتصال» تاني. لو اتكرر ابعت التفاصيل للمساعد.' };
}

class Provider implements OAuthClientProvider {
  pendingUrl: string | null = null;
  id: string; port: number;
  constructor(id: string, port: number) { this.id = id; this.port = port; }
  get redirectUrl() { return `http://127.0.0.1:${this.port}/oauth/callback/${this.id}`; }
  get clientMetadata(): OAuthClientMetadata {
    return { client_name: 'غرفة الإخراج', redirect_uris: [this.redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
  }
  async clientInformation() { const v = await getSecret(`${this.id}:client`); return v ? JSON.parse(v) as OAuthClientInformationMixed : undefined; }
  async saveClientInformation(info: OAuthClientInformationMixed) { await setSecret(`${this.id}:client`, JSON.stringify(info)); }
  async tokens() { const v = await getSecret(`${this.id}:tokens`); return v ? JSON.parse(v) as OAuthTokens : undefined; }
  async saveTokens(t: OAuthTokens) { await setSecret(`${this.id}:tokens`, JSON.stringify(t)); }
  redirectToAuthorization(url: URL) { this.pendingUrl = url.toString(); }
  async saveCodeVerifier(v: string) { await setSecret(`${this.id}:verifier`, v); }
  async codeVerifier() { return (await getSecret(`${this.id}:verifier`)) ?? ''; }
  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all' || scope === 'client') await deleteSecret(`${this.id}:client`);
    if (scope === 'all' || scope === 'tokens') await deleteSecret(`${this.id}:tokens`);
    if (scope === 'all' || scope === 'verifier') await deleteSecret(`${this.id}:verifier`);
  }
}

export async function connectionRoutes(app: FastifyInstance, db: DB, dataDir: string, port: number) {
  db.exec(`CREATE TABLE IF NOT EXISTS connection (
    id TEXT PRIMARY KEY, verified_url TEXT, verified_source TEXT, verified_quote TEXT, verified_at TEXT,
    status TEXT NOT NULL DEFAULT 'unknown', tested_at TEXT, result TEXT)`);
  if (process.env.GHORFA_TEST_MCP) db.prepare(`INSERT OR REPLACE INTO connection (id, verified_url, verified_source, verified_quote, verified_at) VALUES ('local-test', ?, ?, 'test', datetime('now'))`).run(process.env.GHORFA_TEST_MCP, process.env.GHORFA_TEST_MCP);
  const row = (id: string) => db.prepare('SELECT * FROM connection WHERE id = ?').get(id) as Record<string, string | null> | undefined;
  const record = (id: string, r: Result) => { db.prepare(`INSERT INTO connection (id, status, tested_at, result) VALUES (?, ?, datetime('now'), ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, tested_at = excluded.tested_at, result = excluded.result`).run(id, r.status, JSON.stringify(r)); return r; };
  const providers = new Map<string, Provider>();
  const pending = new Map<string, { transport: StreamableHTTPClientTransport }>();

  async function testMcp(s: Service): Promise<Result> {
    const v = row(s.id);
    if (!v?.verified_at) return { ok: false, status: 'unverified', what: 'العنوان لسه ما اتأكدش من موقع الشركة', fix: `افتح صفحة الـ MCP على ${s.officialDomains?.join(' أو ')} وحط رابطها هنا، أو افتح الدومين في إعدادات الشبكة عشان أتأكد منه.` };
    const provider = providers.get(s.id) ?? new Provider(s.id, port); providers.set(s.id, provider); provider.pendingUrl = null;
    const transport = new StreamableHTTPClientTransport(new URL(String(v.verified_url)), { authProvider: provider });
    const client = new Client({ name: 'ghorfa', version: '0.1.0' });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      await client.close();
      return { ok: true, status: 'connected', what: `متوصل · ${tools.length} أداة`, tools: tools.map(t => t.name) };
    } catch (e) {
      if (e instanceof UnauthorizedError || provider.pendingUrl) {
        pending.set(s.id, { transport });
        return { ok: false, status: 'needs_login', what: 'محتاج تسجّل دخول بحسابك', fix: 'هتتفتح صفحة الشركة. سجّل دخول ووافق، وارجع هنا.', authorize_url: provider.pendingUrl ?? undefined };
      }
      return explain(e);
    }
  }

  async function test(s: Service): Promise<Result> {
    if (s.kind === 'mcp') return testMcp(s);
    if (s.kind === 'bridge') {
      const inbox = process.env.GHORFA_INBOX ?? join(dataDir, 'Inbox');
      try { await mkdir(inbox, { recursive: true }); await access(inbox, constants.W_OK); return { ok: true, status: 'connected', what: 'الجسر جاهز', fix: `الكيت بيتعمل من ورقة المقطع، والنتيجة تنزل في ${inbox}` }; }
      catch { return { ok: false, status: 'error', what: 'فولدر Inbox مش قابل للكتابة', fix: `اتأكد من صلاحيات ${inbox}` }; }
    }
    if (s.kind === 'assistant') {
      try { const { stdout } = await run('claude', ['--version'], { timeout: 8000 }); return { ok: true, status: 'connected', what: `Claude Code موجود (${stdout.trim()})`, fix: 'المساعد هيستخدمه على نفس اشتراكك، من غير API key.' }; }
      catch { return { ok: false, status: 'error', what: 'Claude Code مش متثبت على الجهاز ده', fix: 'ثبّته وسجّل دخول بحسابك (claude) وبعدين اختبر تاني.' }; }
    }
    return { ok: false, status: 'off', what: 'مقفول', fix: 'Gemini محتاج API key. التكلفة هتتعرض عليك قبل التوصيل.' };
  }

  app.get('/api/connections', async () => ({
    keychain: keychainAvailable,
    services: SERVICES.map(s => { const r = row(s.id); return { ...s, verified: !!r?.verified_at, verified_source: r?.verified_source ?? null, status: r?.status ?? (s.kind === 'mcp' && !r?.verified_at ? 'unverified' : 'unknown'), tested_at: r?.tested_at ?? null, result: r?.result ? JSON.parse(r.result) : null }; })
  }));

  app.post('/api/connections/:id/test', async (req, reply) => {
    const s = SERVICES.find(x => x.id === (req.params as { id: string }).id); if (!s) return reply.code(404).send({ what: 'خدمة مش معروفة' });
    return record(s.id, await test(s));
  });

  // record that the address was confirmed on the company's own site (the source must be on its domain)
  app.post('/api/connections/:id/verify', async (req, reply) => {
    const s = SERVICES.find(x => x.id === (req.params as { id: string }).id);
    const { source, quote } = req.body as { source: string; quote?: string };
    if (!s?.url) return reply.code(400).send({ what: 'الخدمة دي مش MCP' });
    let host = ''; try { host = new URL(source).hostname; } catch { return reply.code(400).send({ what: 'الرابط مش صحيح', fix: 'حط رابط الصفحة الرسمية كامل (https://…)' }); }
    if (!s.officialDomains!.some(d => host === d || host.endsWith('.' + d))) return reply.code(400).send({ what: `الرابط مش على موقع ${s.name}`, fix: `لازم يكون على ${s.officialDomains!.join(' أو ')} مش موقع وسيط.` });
    db.prepare(`INSERT INTO connection (id, verified_url, verified_source, verified_quote, verified_at, status) VALUES (?, ?, ?, ?, datetime('now'), 'unknown')
      ON CONFLICT(id) DO UPDATE SET verified_url = excluded.verified_url, verified_source = excluded.verified_source, verified_quote = excluded.verified_quote, verified_at = excluded.verified_at, status = 'unknown'`).run(s.id, s.url, source, quote ?? null);
    return { ok: true };
  });

  app.get('/oauth/callback/:id', async (req, reply) => {
    const { id } = req.params as { id: string }; const { code, error } = req.query as { code?: string; error?: string };
    const p = pending.get(id); const s = SERVICES.find(x => x.id === id);
    const page = (t: string) => reply.type('text/html; charset=utf-8').send(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><body style="font:18px system-ui;display:grid;place-items:center;height:100vh;margin:0">${t}</body></html>`);
    if (error || !code || !p || !s) return page(`ما اتوصلش${error ? ` (${error})` : ''}. ارجع للبرنامج وجرّب تاني.`);
    try { await p.transport.finishAuth(code); pending.delete(id); record(id, await test(s)); return page('اتوصل ✓ ارجع للبرنامج.'); }
    catch (e) { record(id, explain(e)); return page('ما اتوصلش. ارجع للبرنامج وشوف السبب.'); }
  });

  app.post('/api/connections/:id/disconnect', async req => {
    const { id } = req.params as { id: string };
    for (const k of ['client', 'tokens', 'verifier']) await deleteSecret(`${id}:${k}`);
    db.prepare(`UPDATE connection SET status = 'unknown', result = NULL WHERE id = ?`).run(id); return { ok: true };
  });
}
