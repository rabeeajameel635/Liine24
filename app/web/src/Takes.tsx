// H2 pilot: الكادرات (storyboard) · النسخ (takes with «اعتمد» / «ارفض») · المعرض.
// Nothing here generates anything or approves on its own: a take is approved only by its «اعتمد» button.
// Look: the picture leads. One large frame, a quiet strip under it, glass for the few controls that sit on pictures.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle, XCircle, Play, Pause, Columns } from '@phosphor-icons/react';
import { PageHead, Details, toast } from './ui.tsx';
import { qcText, type Qc } from './Qc.tsx';
import { arNum } from './Songs.tsx';

export type Take = { id: string; n: number; segment_id: string; asset_id: string; source: string; shot_code: string | null; created_at: string; test: boolean;
  status: 'waiting' | 'approved' | 'rejected'; decided_at: string | null; current: boolean; thumb: string | null; src: string | null; duration: number | null; qc: Qc | null };
export type Frame = { kind: 'shot' | 'ref' | 'inspo'; code: string | null; title: string | null; thumb: string | null; handles: string[]; asset_id: string | null; temp: boolean };

// dots: green = ready, orange = waiting, grey = idea / not used
export const TAKE_STATUS: Record<Take['status'], { t: string; c: string }> = { waiting: { t: 'مستني', c: 'var(--warn)' }, approved: { t: 'معتمد', c: 'var(--ok)' }, rejected: { t: 'مرفوض', c: '#8E8E93' } };
const SOURCE: Record<string, string> = { inbox: 'الاستقبال', kit: 'الكيت', picker: 'اختيار', drop: 'سحب', legacy: 'قديمة' };
const when = (at: string | null) => at ? new Date(at.replace(' ', 'T') + 'Z').toLocaleString('ar-EG', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';
/** Song time as a small film timecode: 0:02.4 */
export const tcode = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
/** A scene's short name: the shot title up to its first comma. */
export const sceneName = (title: string | null | undefined) => (title ?? '').split('،')[0].replace(/\([^)]*\)/g, ' ').replace(/["«][^"»]*["»]/g, ' ').replace(/\s+/g, ' ').trim();

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

/** The picture a frame shows; a frame with none of its own gets the faded stand-in (never an empty grey box). */
const frameStand = (frames: Frame[], fallback: string | null) => frames.find(f => f.thumb && f.kind !== 'inspo')?.thumb ?? fallback;
// what a frame is called on screen: its scene, never its code (codes stay under «تفاصيل»)
const frameLabel = (f: Frame) => f.kind === 'inspo' ? 'إلهام' : sceneName(f.title) || 'مرجع';
const onImgFail = (stand: string | null) => (e: React.SyntheticEvent<HTMLImageElement>) => {
  const im = e.currentTarget; if (stand && !im.classList.contains('temp')) { im.classList.add('temp'); im.src = stand; } else im.style.visibility = 'hidden';
};

/** A horizontal strip of frames, used in the sheet and under the storyboard's large frame. */
export function FrameStrip({ frames, fallback, sel, pick, caps = true }: { frames: Frame[]; fallback: string | null; sel?: number; pick: (i: number) => void; caps?: boolean }) {
  const stand = frameStand(frames, fallback);
  return (
    <div className="fstrip" role="listbox" aria-label="الكادرات">
      {frames.map((f, i) => { const pic = f.thumb ?? stand; return (
        <button key={i} className={'strip-cell' + (f.kind === 'inspo' ? ' inspo' : '')} role="option" aria-selected={sel === i} aria-label={frameLabel(f)} onClick={() => pick(i)}>
          <span className="strip-pic">{pic && <img src={pic} alt="" loading="lazy" className={f.thumb ? undefined : 'temp'} onError={onImgFail(stand)} />}</span>
          {caps && <span className="strip-cap">{frameLabel(f)}</span>}
        </button>
      ); })}
    </div>
  );
}

export function StoryboardPanel({ frames, fallback, start }: { frames: Frame[] | null; fallback: string | null; start?: number }) {
  const [chosen, setSel] = useState<number | null>(start ?? null);
  // opens on the first frame that has a picture of its own
  const sel = chosen ?? Math.max(0, frames?.findIndex(f => f.thumb && f.kind !== 'inspo') ?? 0);
  if (!frames) return null;
  if (!frames.length) return <div className="empty-line"><b>لسه فاضي</b><span>ضيف مراجع للمقطع</span></div>;
  const stand = frameStand(frames, fallback), f = frames[Math.min(sel, frames.length - 1)], pic = f.thumb ?? stand;
  return (
    <>
      <figure className="hero-frame">
        {/* key: a new frame fades in and starts its slow move again */}
        {pic && <img key={sel} src={pic} alt="" className={'kb' + (f.thumb ? '' : ' temp')} onError={onImgFail(stand)} />}
        <figcaption className="hero-cap glass"><b>{frameLabel(f)}</b><span>{arNum(sel + 1)} من {arNum(frames.length)}</span></figcaption>
      </figure>
      <FrameStrip frames={frames} fallback={fallback} sel={sel} pick={setSel} />
      <Details>
        <ul className="board-notes">
          {frames.map((x, i) => <li key={i}><b>{arNum(i + 1)}</b> {x.code ? <span className="ltr">{x.code} · </span> : null}{x.title ?? (x.kind === 'inspo' ? 'مرجع إلهام · مش بيتبعت للتوليد' : 'صورة زيادة من المقطع')}{x.handles.length ? ` · ${x.handles.map(h => '@' + h).join(' ')}` : ''}</li>)}
        </ul>
        <p>الكادرات من المراجع الموجودة بس، ومفيش توليد.</p>
      </Details>
    </>
  );
}

/** Takes as a filmstrip (newest first): picture, number, a status dot. */
export function TakeStrip({ takes, sel, alt, pick }: { takes: Take[]; sel?: string | null; alt?: string | null; pick: (t: Take) => void }) {
  return (
    <div className="fstrip" role="listbox" aria-label="النسخ">
      {[...takes].reverse().map(t => (
        <button key={t.id} className={'strip-cell take-cell' + (alt === t.id ? ' alt' : '')} role="option" aria-selected={sel === t.id} onClick={() => pick(t)}>
          <span className="strip-pic">{t.thumb && <img src={t.thumb} alt="" loading="lazy" />}</span>
          <span className="strip-cap"><i className="dot" style={{ background: TAKE_STATUS[t.status].c }} />نسخة {arNum(t.n)}{t.test ? ' · تجربة' : ''}</span>
        </button>
      ))}
    </div>
  );
}

/** One take on screen: plays by itself, muted and looping; timecode and bar on the picture; a single quiet play control. */
function Stage({ t, start, bar, vid, playing, toggle, label }: { t: Take; start: number; bar: number; vid: React.RefObject<HTMLVideoElement | null>; playing: boolean; toggle: () => void; label?: string }) {
  const [now, setNow] = useState(0);
  const dur = t.duration ?? 0, bars = bar > 0 && dur ? Math.max(1, Math.round(dur / bar)) : 0;
  return (
    <figure className="stage">
      {t.src ? <video ref={vid} src={t.src} poster={t.thumb ?? undefined} muted loop playsInline autoPlay preload="metadata" onClick={toggle}
        onTimeUpdate={e => setNow(e.currentTarget.currentTime)} /> : t.thumb && <img src={t.thumb} alt="" />}
      <div className="stage-top">
        <span className="chip glass ltr">{tcode(start + now)}</span>
        {bars > 0 && <span className="chip glass">بار {arNum(Math.min(bars, Math.floor(now / bar) + 1))} من {arNum(bars)}</span>}
        {label && <span className="chip glass end">{label}</span>}
      </div>
      {t.src && <button className="stage-play glass" onClick={toggle} aria-label={playing ? 'وقّف' : 'شغّل'}>{playing ? <Pause size={22} weight="fill" /> : <Play size={22} weight="fill" />}</button>}
      {dur > 0 && <i className="stage-progress" style={{ transform: `scaleX(${Math.min(1, now / dur)})` }} />}
    </figure>
  );
}

export function TakesPanel({ takes, reload, use, start = 0, bar = 0, initial }: { takes: Take[] | null; reload: () => void; use: (t: Take) => void; start?: number; bar?: number; initial?: string | null }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [selId, setSel] = useState<string | null>(initial ?? null);
  const [altId, setAlt] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [playing, setPlaying] = useState(true);
  const a = useRef<HTMLVideoElement>(null), b = useRef<HTMLVideoElement>(null);
  // in compare, the second picture follows the first so both run on the same beat
  useEffect(() => {
    if (!comparing) return; const A = a.current, B = b.current; if (!A || !B) return;
    const sync = () => { if (Math.abs(B.currentTime - A.currentTime) > 0.12) B.currentTime = A.currentTime; };
    A.addEventListener('timeupdate', sync); return () => A.removeEventListener('timeupdate', sync);
  });
  if (!takes) return null;
  if (!takes.length) return <div className="empty-line"><b>لسه مفيش</b><span>الفيديو يوصل على الاستقبال</span></div>;
  const newest = takes[takes.length - 1];
  const t = takes.find(x => x.id === selId) ?? newest;
  const other = comparing ? (takes.find(x => x.id === altId && x.id !== t.id) ?? [...takes].reverse().find(x => x.id !== t.id) ?? null) : null;
  const toggle = () => {
    const vs = [a.current, b.current].filter(Boolean) as HTMLVideoElement[]; if (!vs.length) return;
    if (playing) { vs.forEach(v => v.pause()); setPlaying(false); } else { if (vs[1]) vs[1].currentTime = vs[0].currentTime; vs.forEach(v => v.play().catch(() => {})); setPlaying(true); }
  };
  const decide = async (x: Take, d: 'approve' | 'reject') => {
    setBusy(x.id); const r = await fetch(`/api/takes/${x.id}/${d}`, { method: 'POST' }); setBusy(null);
    if (r.ok) { toast(d === 'approve' ? 'النسخة اتعتمدت' : 'النسخة اترفضت'); reload(); } else toast('ما اتسجلش، جرّب تاني');
  };
  const pick = (x: Take) => { if (comparing && x.id !== t.id) setAlt(x.id); else { setSel(x.id); setPlaying(true); } };
  return (
    <div className="takes">
      <div className={'stages' + (other ? ' two' : '')}>
        <Stage t={t} start={start} bar={bar} vid={a} playing={playing} toggle={toggle} label={other ? `نسخة ${arNum(t.n)}` : undefined} />
        {other && <Stage t={other} start={start} bar={bar} vid={b} playing={playing} toggle={toggle} label={`نسخة ${arNum(other.n)}`} />}
      </div>

      <div className="take-info">
        <div className="take-text">
          <h2>نسخة {arNum(t.n)}</h2>
          <p><i className="dot" style={{ background: TAKE_STATUS[t.status].c }} />{TAKE_STATUS[t.status].t} · {qcText(t.qc)}{t.test ? ' · تجربة' : ''}</p>
        </div>
        <div className="take-btns">
          {takes.length > 1 && <button className="gbtn soft icon" aria-pressed={comparing} onClick={() => { setComparing(c => !c); setAlt(null); }} aria-label="قارن نسختين" title="قارن نسختين"><Columns size={22} /></button>}
          <button className="gbtn soft" aria-pressed={t.status === 'rejected'} disabled={busy === t.id || t.status === 'rejected'} onClick={() => decide(t, 'reject')}><XCircle size={22} />ارفض</button>
          <button className="gbtn primary" aria-pressed={t.status === 'approved'} disabled={busy === t.id || t.status === 'approved'} onClick={() => decide(t, 'approve')}><CheckCircle size={22} weight="fill" />اعتمد</button>
        </div>
      </div>

      {takes.length > 1 && <TakeStrip takes={takes} sel={t.id} alt={other?.id} pick={pick} />}

      <Details>
        {comparing && <p>في المقارنة: اختار من الشريط النسخة التانية. الاتنين بيشتغلوا مع بعض.</p>}
        <p>جت من {SOURCE[t.source] ?? t.source} {when(t.created_at)}{t.decided_at ? ` · القرار ${when(t.decided_at)}` : ''}</p>
        {t.qc && <p>الفحص: {t.qc.reason}</p>}
        {t.test ? <p>دي تجربة محلية من لوحات الممر، مش إنتاج. ما بتظهرش في المعرض.</p>
          : t.current ? <p>دي فيديو المقطع دلوقتي.</p>
          : <button className="gbtn soft" onClick={() => use(t)}>حطها فيديو المقطع</button>}
        <p>النسخ القديمة ما بتتمسحش.</p>
      </Details>
    </div>
  );
}

type GalleryItem = Take & { start_s: number; end_s: number; seg_label: string | null; group_label: string | null; seg_idx: number; song_id: string; song_title: string; at: number; line: string | null; scene: string | null };

/** One shot of the reel: a wide frame that plays quietly while the pointer rests on it (or while it sits in view on a phone). */
function ReelShot({ t, i }: { t: GalleryItem; i: number }) {
  const v = useRef<HTMLVideoElement>(null), box = useRef<HTMLElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => { const x = v.current; if (!x) return; if (on) x.play().catch(() => {}); else x.pause(); }, [on]);
  useEffect(() => {
    if (!box.current || matchMedia('(hover:hover)').matches) return;
    const io = new IntersectionObserver(([e]) => setOn(e.intersectionRatio > 0.7), { threshold: [0, 0.7, 1] });
    io.observe(box.current); return () => io.disconnect();
  }, []);
  const open = () => { location.hash = `/board/${t.song_id}/${t.segment_id}`; };
  const title = t.line ?? t.scene ?? t.seg_label ?? arNum(t.seg_idx);
  return (
    <article ref={box} id={`shot-${i}`} className={'reel-shot' + (on ? ' on' : '')} style={{ animationDelay: `${Math.min(i, 6) * 60}ms` }}>
      <div className="reel-frame" role="button" tabIndex={0} aria-label={title} onClick={open} onKeyDown={e => { if (e.key === 'Enter') open(); }}
        onMouseEnter={() => setOn(true)} onMouseLeave={() => setOn(false)}>
        {t.thumb && <img src={t.thumb} alt="" loading="lazy" />}
        {t.src && <video ref={v} src={t.src} muted loop playsInline preload="none" />}
      </div>
      <footer className="reel-cap">
        <h2 className={t.line ? 'ltr lyric' : undefined}>{title}</h2>
        <p><span className="ltr tcode">{tcode(t.at ?? t.start_s)}</span></p>
      </footer>
    </article>
  );
}

export function GalleryPage() {
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  useEffect(() => { fetch('/api/gallery').then(r => r.json()).then(d => setItems(d.items ?? [])).catch(() => setItems([])); }, []);
  return (
    <div className="work cinema"><div className="scroll"><div className="reel">
      <PageHead title="المعرض" line={items ? (items.length ? 'بترتيب الأغنية' : 'اللقطات المعتمدة بس') : ' '} />
      {items && !items.length && <div className="reel-empty"><b>لسه فاضي</b><span>اعتمد نسخة من أي مقطع</span></div>}
      {items && items.length > 0 && <div className="reel-list">{items.map((t, i) => <ReelShot key={t.id} t={t} i={i} />)}</div>}
      <Details><p>مترتبة على الأغنية. صفحة داخلية، من غير نشر ولا مشاركة. اللقطة بتشتغل لما الماوس يقف عليها، وبتفتح ورقتها لو دوست.</p></Details>
    </div></div></div>
  );
}
