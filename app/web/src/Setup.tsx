// أول تشغيل: three steps, each turns green when it's done. Nothing here asks for anything outside «اللي محتاجه مني على الماك».
import { useEffect, useState } from 'react';
import { CheckCircle, SignIn, Cpu, PlugsConnected, ScanSmiley } from '@phosphor-icons/react';
import { PageHead, Details, toast } from './ui.tsx';
import { arNum } from './Songs.tsx';

type S = { models: boolean; services: { id: string; status: string }[]; library: { total: number; have: number; running: boolean; error: string | null; failed: string[] };
  face: { running: boolean; error: string | null; done: boolean; refs: { id: string; label: string | null; thumb: string | null; pct: number | null; state: string | null }[] } };
const NAME: Record<string, string> = { higgsfield: 'Higgsfield', suno: 'Suno', runway: 'Runway' };

export function SetupPage() {
  const [s, setS] = useState<S | null>(null);
  const [list, setList] = useState<string[]>([]);
  const load = () => fetch('/api/setup').then(r => r.json()).then(setS);
  useEffect(() => { load(); fetch('/api/setup/checklist').then(r => r.json()).then(d => setList(d.items)); const t = setInterval(load, 2500); return () => clearInterval(t); }, []);
  if (!s) return <div className="work" />;
  const logged = s.services.filter(x => x.status === 'connected').length;
  const step2 = logged === 3 && s.library.have === s.library.total;
  const scored = s.face.refs.filter(r => r.state === 'pass' || r.state === 'warn' || r.state === 'none');
  const low = s.face.refs.filter(r => r.state === 'warn');
  const login = async (id: string) => {
    const r = await fetch(`/api/connections/${id}/test`, { method: 'POST' }).then(r => r.json()).catch(() => null);
    if (r?.authorize_url) window.open(r.authorize_url, '_blank', 'noopener'); else if (r?.status === 'connected') toast(`${NAME[id]} متوصل`); else toast(r?.what ?? 'ما اتوصلش');
    load();
  };
  const faceCheck = async () => { const r = await fetch('/api/setup/face-check', { method: 'POST' }); if (!r.ok) toast((await r.json()).what); load(); };
  const allDone = s.models && step2 && s.face.done;
  return (
    <div className="work"><div className="scroll"><div className="stack">
      <PageHead title="أول تشغيل" line={allDone ? 'كله جاهز' : undefined} />

      <Step n={1} done={s.models} icon={Cpu} title="موديلات الوش" line={s.models ? 'نزلت واتأكدت' : 'ناقصة'} />

      <Step n={2} done={step2} icon={PlugsConnected} title="سجّل الدخول" line={step2 ? 'التلاتة متوصلين' : `${arNum(logged)} من ٣`}>
        <div className="setup-logins">
          {s.services.map(x => x.status === 'connected'
            ? <span key={x.id} className="gbtn soft done-tag ltr"><CheckCircle size={22} weight="fill" /> {NAME[x.id]}</span>
            : <button key={x.id} className="gbtn secondary ltr" onClick={() => login(x.id)}><SignIn size={22} /> {NAME[x.id]}</button>)}
        </div>
        {s.services.find(x => x.id === 'higgsfield')?.status === 'connected' && <p className="setup-sub">
          {s.library.running ? `مكتبة دنيا بتنزل · ${arNum(s.library.have)} من ${arNum(s.library.total)}` : s.library.have === s.library.total ? `مكتبة دنيا نزلت · ${arNum(s.library.total)} ملف` : `مكتبة دنيا: ${arNum(s.library.have)} من ${arNum(s.library.total)}`}
          {s.library.failed.length > 0 && <span className="badge-warn"> · {arNum(s.library.failed.length)} ما نزلوش</span>}
        </p>}
      </Step>

      <Step n={3} done={s.face.done} icon={ScanSmiley} title="افحص وش دنيا"
        line={s.face.done ? (low.length ? `${arNum(low.length)} أقل من ٩٥` : `الـ ${arNum(s.face.refs.length)} معدّيين`) : s.face.running ? `بيفحص · ${arNum(scored.length)} من ${arNum(s.face.refs.length)}` : !s.models || !s.face.refs.length ? 'مستنية' : 'جاهز للفحص'}
        action={s.models && s.face.refs.length > 0 && !s.face.running ? <button className={s.face.done ? 'gbtn soft' : 'gbtn primary'} onClick={faceCheck}>{s.face.done ? 'افحص تاني' : 'افحص'}</button> : undefined}>
        {scored.length > 0 && <div className="face-grid">{s.face.refs.map(r => (
          <figure key={r.id} className={r.state ?? ''}>{r.thumb && <img src={r.thumb} alt="" />}
            <figcaption>{r.state === 'none' ? 'مفيش وش' : r.pct != null ? `${arNum(r.pct)}٪` : '—'}</figcaption></figure>))}</div>}
      </Step>

      <Details label="المطلوب منك">
        <ol className="checklist">{list.map((t, i) => <li key={i} dangerouslySetInnerHTML={{ __html: t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/`([^`]+)`/g, '<code class="ltr">$1</code>') }} />)}</ol>
      </Details>
    </div></div></div>
  );
}

function Step({ n, done, icon: I, title, line, action, children }: { n: number; done: boolean; icon: React.ComponentType<{ size?: number; weight?: 'regular' | 'fill' }>; title: string; line: string; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section className={'card setup-step' + (done ? ' done' : '')}>
      <div className="card-body">
        <span className="step-mark" aria-label={`خطوة ${n}`}>{done ? <CheckCircle size={40} weight="fill" /> : <I size={28} />}</span>
        <div className="card-text"><h2>{title}</h2><p>{line}</p></div>
        {action && <div className="card-action">{action}</div>}
      </div>
      {children && <div className="card-more">{children}</div>}
    </section>
  );
}
