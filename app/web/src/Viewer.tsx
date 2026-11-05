// Full-screen viewer: black stage, swipe sideways to move, swipe down to close, swipe up for info.
// Floating glass controls: info · ♡ · compare · اعتمد. Thumbnail strip at the bottom.
import { useEffect, useRef, useState } from 'react';
import { X, Info, Heart, ArrowsLeftRight, CloudSlash } from '@phosphor-icons/react';
import { api, fmtDate, fmtDur, type Asset } from './api.ts';
import { Status, toast, Details } from './ui.tsx';
import { statusOf } from './Library.tsx';
import { useQc, QcCard, QcChip } from './Qc.tsx';

export function Viewer({ items, index, onIndex, onClose, onUpdate }: { items: Asset[]; index: number; onIndex: (i: number) => void; onClose: () => void; onUpdate: (a: Asset) => void }) {
  const a = items[index];
  const [info, setInfo] = useState(false);
  const [cmp, setCmp] = useState<number | null>(null);
  const [split, setSplit] = useState(0.5);
  const [dy, setDy] = useState(0);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [fill, setFill] = useState(false);
  const lastTap = useRef(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const rtl = document.dir === 'rtl' || document.documentElement.dir === 'rtl';

  const go = (d: number) => { const n = index + d; if (n >= 0 && n < items.length) { setFill(false); onIndex(n); } };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { info ? setInfo(false) : cmp != null ? setCmp(null) : onClose(); }
      if (e.key === 'ArrowLeft') go(rtl ? 1 : -1);
      if (e.key === 'ArrowRight') go(rtl ? -1 : 1);
      if (e.key === 'i') setInfo(v => !v);
    };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  });
  useEffect(() => { document.querySelector('.strip [aria-current="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); }, [index]);

  const onDown = (e: React.PointerEvent) => { if (cmp != null) return; start.current = { x: e.clientX, y: e.clientY }; };
  const onMove = (e: React.PointerEvent) => { if (!start.current) return; const y = e.clientY - start.current.y; if (y > 0 && !info) setDy(y); };
  const onUp = (e: React.PointerEvent) => {
    const s = start.current; start.current = null; if (!s) return;
    const dx = e.clientX - s.x, ddy = e.clientY - s.y; setDy(0);
    if (Math.abs(dx) < 8 && Math.abs(ddy) < 8) { const now = Date.now(); if (now - lastTap.current < 300) { setFill(f => !f); lastTap.current = 0; return; } lastTap.current = now; }
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(ddy)) go((dx < 0 ? 1 : -1) * (rtl ? -1 : 1));
    else if (ddy > 110 && !info) onClose();
    else if (ddy < -60) setInfo(true);
    else if (ddy > 60 && info) setInfo(false);
  };

  const fav = async () => { const r = await api.favorite(a.id); onUpdate({ ...a, favorite: !!r.favorite }); };
  const approve = async () => { await api.approve(a.id); onUpdate({ ...a, approved: true }); toast('اتعتمد'); };
  const media = (x: Asset, cls?: string) => failed[x.id] || !x.src
    ? <div className={cls} style={{ display: 'grid', placeItems: 'center', gap: 10, color: '#aaa', textAlign: 'center' }}><CloudSlash size={44} /><span>الملف لسه ما نزلش</span></div>
    : x.kind === 'video'
      ? <video className={cls} src={x.src} poster={x.thumb ?? undefined} controls autoPlay playsInline onError={() => setFailed(f => ({ ...f, [x.id]: true }))} />
      : <img className={cls} src={x.src} alt={x.label ?? ''} draggable={false} onError={() => setFailed(f => ({ ...f, [x.id]: true }))} />;

  const st = statusOf(a);
  const { qc, busy, rerun } = useQc(a.id);
  const prov = a.provenance;
  const other = cmp != null ? items[cmp] : null;

  return (
    <div className="viewer" role="dialog" aria-label="العارض" style={{ background: `rgba(0,0,0,${1 - Math.min(dy / 500, .6)})` }}>
      <div className="vtop">
        <div className="capsule glass"><button className="gbtn icon" onClick={onClose} aria-label="اقفل"><X size={24} /></button></div>
        <div className="vtitle capsule glass"><b>{a.label ?? (a.kind === 'video' ? 'فيديو' : 'صورة')}</b><QcChip qc={qc} /></div>
        <div className="capsule glass vactions">
          <button className="gbtn icon" aria-pressed={info} onClick={() => setInfo(v => !v)} aria-label="معلومات"><Info size={24} weight={info ? 'fill' : 'regular'} /></button>
          <button className="gbtn icon" aria-pressed={a.favorite} onClick={fav} aria-label="مفضّل"><Heart size={24} weight={a.favorite ? 'fill' : 'regular'} /></button>
          <button className="gbtn icon" aria-pressed={cmp != null} onClick={() => setCmp(c => c != null ? null : (index + 1 < items.length ? index + 1 : Math.max(0, index - 1)))} aria-label="قارن"><ArrowsLeftRight size={24} weight={cmp != null ? 'bold' : 'regular'} /></button>
          {a.approved ? <span className="gbtn" style={{ cursor: 'default' }}><Status kind="ok" /></span>
            : <button className="gbtn primary" onClick={approve}>اعتمد</button>}
        </div>
      </div>

      <div className={'stage' + (fill ? ' fill' : '')} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { start.current = null; setDy(0); }}
        style={{ transform: dy ? `translateY(${dy}px) scale(${1 - Math.min(dy / 1600, .15)})` : undefined }}>
        {other ? (
          <Compare a={a} b={other} split={split} setSplit={setSplit} render={media} />
        ) : (
          <>
            <button className="navhit prev" aria-label="اللي قبل" onClick={() => go(-1)} />
            {media(a)}
            <button className="navhit next" aria-label="اللي بعد" onClick={() => go(1)} />
          </>
        )}
      </div>

      <div className="strip" aria-label={cmp != null ? 'اختار اللي تقارن بيه' : 'المصغّرات'}>
        {items.map((x, i) => (
          <button key={x.id} aria-current={i === (cmp ?? index)} onClick={() => cmp != null ? (i !== index && setCmp(i)) : onIndex(i)} aria-label={x.label ?? String(i + 1)}>
            {x.thumb && !failed[x.id] && <img src={x.thumb} alt="" onError={() => setFailed(f => ({ ...f, [x.id]: true }))} />}
          </button>
        ))}
      </div>

      <section className={'sheet glass-strong' + (info ? ' open' : '')} aria-hidden={!info}
        onPointerDown={onDown} onPointerUp={onUp}>
        <button className="grab" onClick={() => setInfo(false)} aria-label="اقفل المعلومات" />
        <QcCard qc={qc} busy={busy} rerun={rerun} />
        <h2 className="sheet-title">{a.label ?? (a.kind === 'video' ? 'فيديو' : 'صورة')}</h2>
        <p className="sheet-line">{fmtDate(a.created_at)}</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}><Status kind={a.approved ? 'ok' : 'wait'} />{a.locked && <span className="pill">مرجع مقفول</span>}{!!a.face_baseline && <span className="pill">خط أساس الوش</span>}{!!a.no_generation && <span className="pill">ممنوع كمرجع توليد</span>}</div>
        {a.warn && <p className="warn-line"><Status kind="warn" label={a.warn} /></p>}
        <dl className="kv">
          {infoRows(a).map(([k, v]) => <Row key={k} k={k} v={v} />)}
        </dl>
        {prov.prompt && <Details label="البرومبت"><div className="prompt ltr">{prov.prompt}</div></Details>}
      </section>
    </div>
  );
}

function Compare({ a, b, split, setSplit, render }: { a: Asset; b: Asset; split: number; setSplit: (n: number) => void; render: (x: Asset, cls?: string) => React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null); const dragging = useRef(false);
  const set = (x: number) => { const r = box.current!.getBoundingClientRect(); setSplit(Math.min(1, Math.max(0, (x - r.left) / r.width))); };
  return (
    <div className="compare" ref={box} onPointerDown={e => { dragging.current = true; (e.target as Element).setPointerCapture?.(e.pointerId); set(e.clientX); }}
      onPointerMove={e => dragging.current && set(e.clientX)} onPointerUp={() => { dragging.current = false; }}>
      <div style={{ position: 'absolute', inset: 0 }}>{render(b)}</div>
      <div style={{ position: 'absolute', inset: 0, clipPath: `inset(0 ${100 - split * 100}% 0 0)` }}>{render(a)}</div>
      <div className="knob" style={{ left: `calc(${split * 100}% - 1px)` }} />
      <span className="lbl glass" style={{ left: 16 }}>{a.label ?? 'دي'}</span>
      <span className="lbl glass" style={{ right: 16 }}>{b.label ?? 'التانية'}</span>
    </div>
  );
}

/** Only rows that carry a value; empty fields stay hidden. */
function infoRows(a: Asset): [string, React.ReactNode][] {
  const p = a.provenance;
  const rows: [string, React.ReactNode][] = [
    ['الأداة', [p.tool, p.model].filter(Boolean).join(' · ')],
    ['الشخصية', a.character_name],
    ['اللقطة', a.shot_id],
    ['الـ seed', p.seed],
    ['النسخة', p.version],
    ['المراجع اللي اتبعتت', p.refs_sent?.length ? p.refs_sent.join('، ') : null],
    ['الفحص', a.face_check === 'pass' ? 'تطابق الوش ✓' : a.face_check === 'warn' ? '⚠ الوش بعيد عن البطاقة' : null],
    ['الرخصة', p.license],
    ['المقاس', a.width ? <span className="ltr">{`${a.width}×${a.height}`}{a.duration ? ` · ${fmtDur(a.duration)}` : ''}</span> : null]
  ];
  return rows.filter(([, v]) => v != null && v !== '');
}
function Row({ k, v }: { k: string; v: React.ReactNode }) { return <><dt>{k}</dt><dd>{v}</dd></>; }
