// الاتصالات: one row per subscription, «اختبر الاتصال», and errors as «حصل إيه / نصلّحه إزاي».
import { useEffect, useState } from 'react';
import { ArrowSquareOut, SignIn, LinkBreak, ShieldCheck } from '@phosphor-icons/react';
import { Status, toast } from './ui.tsx';

type Res = { ok: boolean; status: string; what: string; fix?: string; tools?: string[]; authorize_url?: string };
type Svc = { id: string; name: string; kind: 'mcp' | 'bridge' | 'assistant' | 'analysis'; url?: string; officialDomains?: string[]; site: string; provides: string[]; note: string; fallback?: string;
  verified: boolean; verified_source: string | null; verified_quote?: string | null; status: string; tested_at: string | null; result: Res | null };
const KIND: Record<Svc['kind'], string> = { mcp: 'MCP', bridge: 'جسر', assistant: 'Claude Code', analysis: 'API' };

export function Connections() {
  const [list, setList] = useState<Svc[] | null>(null);
  const [keychain, setKeychain] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => fetch('/api/connections').then(r => r.json()).then(d => { setList(d.services); setKeychain(d.keychain); });
  useEffect(() => { load(); }, []);

  const test = async (s: Svc) => {
    setBusy(s.id);
    const r: Res = await fetch(`/api/connections/${s.id}/test`, { method: 'POST' }).then(r => r.json());
    setBusy(null); load();
    if (r.authorize_url) window.open(r.authorize_url, '_blank', 'noopener');
  };
  const testAll = async () => { for (const s of list ?? []) if (s.kind !== 'analysis') await test(s); toast('خلص الاختبار'); };

  return (
    <div className="work">
      <div className="topbar"><span className="sp" /><button className="gbtn primary" onClick={testAll} disabled={!!busy}>اختبر الكل</button></div>
      <div className="scroll">
        <div className="title-block"><h1>الاتصالات</h1><p>MCP رسمي على اشتراكاتك، والباقي جسر.</p></div>
        {!keychain && <div className="banner glass soft"><ShieldCheck size={18} /><span>على الجهاز ده الدخول بيتحفظ في ملف محمي للتطوير بس. على الماك بيتحفظ في Keychain.</span></div>}
        <div className="conns">
          {list?.map(s => <Row key={s.id} s={s} busy={busy === s.id} test={() => test(s)} reload={load} />)}
        </div>
      </div>
    </div>
  );
}

function Row({ s, busy, test, reload }: { s: Svc; busy: boolean; test: () => void; reload: () => void }) {
  const [src, setSrc] = useState('');
  const r = s.result;
  const kind = busy ? 'run' : s.status === 'connected' ? 'ok' : s.status === 'unverified' || s.status === 'needs_login' || s.status === 'off' ? 'wait' : s.status === 'error' ? 'warn' : 'wait';
  const label = busy ? 'بيختبر…' : r?.what ?? (s.kind === 'mcp' && !s.verified ? 'مستني التأكيد من موقع الشركة' : s.kind === 'mcp' ? 'متأكد · مستني تسجيل الدخول على الماك' : s.kind === 'analysis' ? 'مقفول' : 'لسه ما اتختبرش');
  const verify = async () => {
    const res = await fetch(`/api/connections/${s.id}/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: src }) });
    const d = await res.json(); if (res.ok) { toast('اتسجل التأكيد'); reload(); } else toast(`${d.what}. ${d.fix ?? ''}`);
  };
  return (
    <article className="conn">
      <div className="conn-logo">{s.name[0]}</div>
      <div className="conn-main">
        <div className="conn-top"><b className="ltr">{s.name}</b><span className={'kind ' + s.kind}>{KIND[s.kind]}</span>{s.provides.map(p => <span key={p} className="pill sm">{p}</span>)}</div>
        <div className="conn-note mute">{s.note}{s.url ? <> · <span className="ltr mono">{s.url.replace('https://', '')}</span></> : null}</div>
        <div className="conn-status"><Status kind={kind as 'ok' | 'warn' | 'wait' | 'run'} label={label} progress={0.6} /></div>
        {r && !r.ok && r.fix && <div className="what-fix"><div><span className="mute">حصل إيه</span>{r.what}</div><div><span className="mute">نصلّحه إزاي</span>{r.fix}</div></div>}
        {r?.ok && r.tools && <div className="tools-list ltr">{r.tools.slice(0, 8).map(t => <code key={t}>{t}</code>)}{r.tools.length > 8 && <code>+{r.tools.length - 8}</code>}</div>}
        {s.kind === 'mcp' && !s.verified && (
          <div className="verify">
            <input className="ltr" value={src} onChange={e => setSrc(e.target.value)} placeholder={`https://${s.officialDomains?.[0]}/… (صفحة الـ MCP الرسمية)`} />
            <button className="gbtn" onClick={verify} disabled={!src}>اتأكدت</button>
          </div>
        )}
        {s.verified && s.verified_source && <div className="verified-src"><span className="ok-tag"><ShieldCheck size={14} weight="fill" /> متأكد من موقع الشركة</span> <a className="ltr" href={s.verified_source} target="_blank" rel="noreferrer">{s.verified_source}</a>{s.verified_quote && <q>{s.verified_quote}</q>}</div>}
      </div>
      <div className="conn-actions">
        {s.kind !== 'analysis' && <button className="gbtn" onClick={test} disabled={busy}>اختبر الاتصال</button>}
        {s.status === 'needs_login' && r?.authorize_url && <a className="gbtn" href={r.authorize_url} target="_blank" rel="noreferrer"><SignIn size={16} /> سجّل دخول</a>}
        {s.kind === 'mcp' && s.status === 'connected' && <button className="gbtn ghost" onClick={async () => { await fetch(`/api/connections/${s.id}/disconnect`, { method: 'POST' }); reload(); }}><LinkBreak size={16} /> افصل</button>}
        <a className="gbtn ghost" href={s.site} target="_blank" rel="noreferrer" aria-label={`افتح ${s.name}`}><ArrowSquareOut size={16} /></a>
      </div>
    </article>
  );
}
