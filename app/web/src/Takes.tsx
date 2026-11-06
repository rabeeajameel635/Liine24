// H2 pilot: ستوري بورد · النسخ (takes with «اعتمد» / «ارفض») · المعرض.
// Nothing here generates anything or approves on its own: a take is approved only by its «اعتمد» button.
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, XCircle, Flask } from '@phosphor-icons/react';
import { PageHead, Card, Details, toast } from './ui.tsx';
import { QcChip, type Qc } from './Qc.tsx';
import { arNum } from './Songs.tsx';

export type Take = { id: string; n: number; segment_id: string; asset_id: string; source: string; shot_code: string | null; created_at: string; test: boolean;
  status: 'waiting' | 'approved' | 'rejected'; decided_at: string | null; current: boolean; thumb: string | null; src: string | null; duration: number | null; qc: Qc | null };
export type Frame = { kind: 'shot' | 'ref' | 'inspo'; code: string | null; title: string | null; thumb: string | null; handles: string[]; asset_id: string | null; temp: boolean };

// dots: green = ready, orange = waiting, grey = idea / not used
export const TAKE_STATUS: Record<Take['status'], { t: string; c: string }> = { waiting: { t: 'مستني', c: 'var(--warn)' }, approved: { t: 'معتمد', c: 'var(--ok)' }, rejected: { t: 'مرفوض', c: '#8E8E93' } };
const SOURCE: Record<string, string> = { inbox: 'الاستقبال', kit: 'الكيت', picker: 'اختيار', drop: 'سحب', legacy: 'قديمة' };
const when = (at: string | null) => at ? new Date(at.replace(' ', 'T') + 'Z').toLocaleString('ar-EG', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';

export function useTakes(segId: string) {
  const [takes, setTakes] = useState<Take[] | null>(null);
  const load = useCallback(() => fetch(`/api/segments/${segId}/takes`).then(r => r.json()).then(d => setTakes(d.takes)).catch(() => setTakes([])), [segId]);
  useEffect(() => { setTakes(null); load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]); // a take can arrive in Inbox while the sheet is open
  return { takes, load };
}

export function useStoryboard(segId: string) {
  const [frames, setFrames] = useState<Frame[] | null>(null);
  useEffect(() => { setFrames(null); fetch(`/api/segments/${segId}/storyboard`).then(r => r.json()).then(d => setFrames(d.frames ?? [])).catch(() => setFrames([])); }, [segId]);
  return frames;
}

export function StoryboardPanel({ frames, fallback }: { frames: Frame[] | null; fallback: string | null }) {
  if (!frames) return null;
  if (!frames.length) return <Card title="لسه فاضي" line="ضيف مراجع للمقطع" />;
  // a frame with no picture of its own shows a faded stand-in (the first real frame), never an empty grey box
  const stand = frames.find(f => f.thumb && f.kind !== 'inspo')?.thumb ?? fallback;
  const swap = (e: React.SyntheticEvent<HTMLImageElement>) => { const im = e.currentTarget; if (stand && !im.classList.contains('temp')) { im.classList.add('temp'); im.src = stand; } else im.style.visibility = 'hidden'; };
  return (
    <>
      <div className="board-frames">
        {frames.map((f, i) => {
          const pic = f.thumb ?? stand;
          return (
            <figure key={i} className={'board-frame' + (f.kind === 'inspo' ? ' inspo' : '')}>
              <div className="bf-pic">{pic && <img src={pic} alt="" loading="lazy" className={f.thumb ? undefined : 'temp'} onError={swap} />}<span className="slot-n">{arNum(i + 1)}</span></div>
              <figcaption>{f.code ? <b className="ltr">{f.code}</b> : <b>{f.kind === 'inspo' ? 'إلهام' : 'مرجع'}</b>}</figcaption>
            </figure>
          );
        })}
      </div>
      <Details>
        <ul className="board-notes">
          {frames.map((f, i) => <li key={i}><b>{arNum(i + 1)}</b> {f.title ?? (f.kind === 'inspo' ? 'مرجع إلهام · مش بيتبعت للتوليد' : 'صورة زيادة من المقطع')}{f.handles.length ? ` · ${f.handles.map(h => '@' + h).join(' ')}` : ''}</li>)}
        </ul>
        <p>الكادرات من المراجع الموجودة بس، ومفيش توليد.</p>
      </Details>
    </>
  );
}

export function TakesPanel({ takes, reload, use }: { takes: Take[] | null; reload: () => void; use: (t: Take) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!takes) return null;
  if (!takes.length) return <Card title="لسه مفيش" line="الفيديو يوصل على الاستقبال" />;
  const decide = async (t: Take, d: 'approve' | 'reject') => {
    setBusy(t.id); const r = await fetch(`/api/takes/${t.id}/${d}`, { method: 'POST' }); setBusy(null);
    if (r.ok) { toast(d === 'approve' ? 'النسخة اتعتمدت' : 'النسخة اترفضت'); reload(); } else toast('ما اتسجلش، جرّب تاني');
  };
  return (
    <div className="takes">
      {[...takes].reverse().map(t => (
        <section key={t.id} className={'take card' + (t.test ? ' is-test' : '')}>
          <div className="take-pic">
            {t.src ? <video src={t.src} poster={t.thumb ?? undefined} controls playsInline preload="none" /> : t.thumb && <img src={t.thumb} alt="" />}
            {t.test && <span className="test-badge"><Flask size={20} weight="fill" />تجربة</span>}
          </div>
          <div className="card-body">
            <div className="card-text">
              <h2>نسخة {arNum(t.n)}<QcChip qc={t.qc} /></h2>
              <p><i className="dot" style={{ background: TAKE_STATUS[t.status].c }} />{TAKE_STATUS[t.status].t} · {SOURCE[t.source] ?? t.source}</p>
            </div>
            <div className="card-action take-btns">
              <button className="gbtn primary" aria-pressed={t.status === 'approved'} disabled={busy === t.id || t.status === 'approved'} onClick={() => decide(t, 'approve')}><CheckCircle size={22} weight="fill" /> اعتمد</button>
              <button className="gbtn secondary" aria-pressed={t.status === 'rejected'} disabled={busy === t.id || t.status === 'rejected'} onClick={() => decide(t, 'reject')}><XCircle size={22} /> ارفض</button>
            </div>
          </div>
          <Details>
            {t.qc && <p>الفحص: {t.qc.reason}</p>}
            <p>وصلت {when(t.created_at)}{t.decided_at ? ` · القرار ${when(t.decided_at)}` : ''}</p>
            {t.test ? <p>دي تجربة محلية، مش إنتاج. ما بتظهرش في المعرض.</p>
              : t.current ? <p>دي فيديو المقطع دلوقتي.</p>
              : <button className="gbtn soft" onClick={() => use(t)}>حطها فيديو المقطع</button>}
            <p>النسخ القديمة ما بتتمسحش.</p>
          </Details>
        </section>
      ))}
    </div>
  );
}

type GalleryItem = Take & { start_s: number; seg_label: string | null; group_label: string | null; seg_idx: number; song_id: string; song_title: string };

export function GalleryPage() {
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  useEffect(() => { fetch('/api/gallery').then(r => r.json()).then(d => setItems(d.items ?? [])).catch(() => setItems([])); }, []);
  return (
    <div className="work"><div className="scroll"><div className="stack">
      <PageHead title="المعرض" line={items ? (items.length ? `${arNum(items.length)} نسخ معتمدة` : 'النسخ المعتمدة بس') : ' '} />
      {items && !items.length && <Card title="لسه فاضي" line="اعتمد نسخة من أي مقطع" />}
      {items && items.length > 0 && <div className="gallery-grid">
        {items.map(t => (
          <Card key={t.id} img={t.thumb} title={t.shot_code ?? t.seg_label ?? arNum(t.seg_idx)} ltrTitle line={`نسخة ${arNum(t.n)}`}
            onClick={() => { location.hash = `/board/${t.song_id}/${t.segment_id}`; }} />
        ))}
      </div>}
      <Details><p>مترتبة على الأغنية. صفحة داخلية، من غير نشر ولا مشاركة.</p></Details>
    </div></div></div>
  );
}
