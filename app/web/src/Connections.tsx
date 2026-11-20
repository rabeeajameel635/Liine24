// الاتصالات: one row per subscription, «اختبر الاتصال», and errors as «حصل إيه / نصلّحه إزاي».
import { useEffect, useState } from 'react';
import { ArrowSquareOut, SignIn, LinkBreak, ShieldCheck, CaretDown, Sparkle, PlugsConnected } from '@phosphor-icons/react';
import { toast, PageHead, Details } from './ui.tsx';
import { arNum } from './Songs.tsx';

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
  const testAll = async () => { for (const s of list ?? []) if (s.kind === 'mcp' || s.kind === 'assistant') await test(s); toast('خلص الاختبار'); };

  return (
    <div className="work">
      <div className="scroll"><div className="stack">
        <PageHead title="الاتصالات" action={<button className="gbtn primary" onClick={testAll} disabled={!!busy}>اختبر الكل</button>} />
        {list?.filter(s => s.kind === 'mcp' || s.kind === 'assistant').map(s => <ConnRow key={s.id} s={s} busy={busy === s.id} test={() => test(s)} reload={load} />)}
        {list && <Bridges list={list.filter(s => s.kind === 'bridge')} />}
        <Details>
          {list?.filter(s => s.kind === 'analysis').map(s => <p key={s.id}><b className="ltr">{s.name}</b> · مقفول لحد ما توافق على التكلفة</p>)}
          {!keychain && <p>على الجهاز ده الدخول بيتحفظ في ملف محمي للتطوير بس. على الماك بيتحفظ في Keychain.</p>}
        </Details>
      </div></div>
    </div>
  );
}

const SHORT: Record<string, string> = { connected: 'متوصل', needs_login: 'مستني الدخول', unverified: 'مستني التأكيد', error: 'فيه مشكلة', off: 'مقفول' };

function ConnRow({ s, busy, test, reload }: { s: Svc; busy: boolean; test: () => void; reload: () => void }) {
  const [src, setSrc] = useState('');
  const [open, setOpen] = useState(false);
  const r = s.result;
  const line = busy ? 'بيختبر…' : s.kind === 'bridge' ? 'جسر بالكيت' : s.kind === 'analysis' ? 'مقفول' : s.kind === 'mcp' && !s.verified ? 'مستني التأكيد' : s.status === 'connected' ? 'متوصل' : r && !r.ok ? 'فيه مشكلة' : s.kind === 'mcp' ? 'مستني الدخول' : SHORT[s.status] ?? 'لسه';
  const action = s.status === 'needs_login' && r?.authorize_url ? <a className="gbtn secondary" href={r.authorize_url} target="_blank" rel="noreferrer"><SignIn size={22} /> ادخل</a>
    : s.kind === 'bridge' ? <a className="gbtn soft" href={s.site} target="_blank" rel="noreferrer">افتح</a>
    : s.kind === 'analysis' ? null : <button className="gbtn soft" onClick={test} disabled={busy}>اختبر</button>;
  const verify = async () => {
    const res = await fetch(`/api/connections/${s.id}/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: src }) });
    const d = await res.json(); if (res.ok) { toast('اتسجل التأكيد'); reload(); } else toast(d.what);
  };
  return (
    <div className="card conn-card">
      <div className="card-row-in" role="button" tabIndex={0} onClick={() => setOpen(o => !o)} onKeyDown={e => { if (e.key === 'Enter') setOpen(o => !o); }}>
        <span className="conn-logo">{s.kind === 'assistant' ? <Sparkle size={28} /> : <PlugsConnected size={28} />}</span>
        <div className="card-text"><h2 className="ltr">{s.name}</h2><p>{line}</p></div>
        <div className="card-action">{s.status === 'needs_login' && r?.authorize_url ? <span onClick={e => e.stopPropagation()}>{action}</span> : <CaretDown size={24} className="chev" style={{ transform: open ? 'rotate(180deg)' : undefined }} />}</div>
      </div>
      {open && <div className="card-more">
        {r && !r.ok && r.fix && <><p><b>حصل إيه:</b> {r.what}</p><p><b>نصلّحه إزاي:</b> {r.fix}</p></>}
        {r?.ok && r.tools && <p>{arNum(r.tools.length)} أداة متاحة</p>}
        {s.kind === 'mcp' && !s.verified && <div className="verify"><input className="ltr" value={src} onChange={e => setSrc(e.target.value)} placeholder="لينك صفحة الشركة" /><button className="gbtn soft" onClick={verify} disabled={!src}>اتأكدت</button></div>}
        {s.verified && s.verified_source && <p className="verified-src"><ShieldCheck size={22} weight="fill" /> متأكد من موقع الشركة · <a className="ltr" href={s.verified_source} target="_blank" rel="noreferrer">المصدر</a></p>}
        {s.verified_quote && <q>{s.verified_quote}</q>}
        <div className="row-btns">
          {s.kind !== 'analysis' && s.kind !== 'bridge' && <button className="gbtn soft" onClick={test} disabled={busy}>اختبر</button>}
          {s.kind === 'mcp' && s.status === 'connected' && <button className="gbtn soft" onClick={async () => { await fetch(`/api/connections/${s.id}/disconnect`, { method: 'POST' }); reload(); }}><LinkBreak size={22} /> افصل</button>}
          <a className="gbtn soft" href={s.site} target="_blank" rel="noreferrer"><ArrowSquareOut size={22} /> الموقع</a>
        </div>
      </div>}
    </div>
  );
}

function Bridges({ list }: { list: Svc[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card conn-card">
      <div className="card-row-in" role="button" tabIndex={0} onClick={() => setOpen(o => !o)} onKeyDown={e => { if (e.key === 'Enter') setOpen(o => !o); }}>
        <span className="conn-logo"><ArrowSquareOut size={26} /></span>
        <div className="card-text"><h2>الجسور</h2><p className="ltr" style={{ textAlign: 'right' }}>{list.map(s => s.name.replace('Google ', '').replace(' Imagine', '').replace(' 3.0', '')).join(' · ')}</p></div>
        <div className="card-action"><CaretDown size={24} className="chev" style={{ transform: open ? 'rotate(180deg)' : undefined }} /></div>
      </div>
      {open && <div className="card-more">
        <p>الجسر بيجهّز كيت (صور مترقّمة وبرومبت وصوت)، وإنت بتولّد على الموقع، والفيديو بيرجع لوحده.</p>
        <div className="row-btns">{list.map(s => <a key={s.id} className="gbtn soft ltr" href={s.site} target="_blank" rel="noreferrer">{s.name}</a>)}</div>
      </div>}
    </div>
  );
}
