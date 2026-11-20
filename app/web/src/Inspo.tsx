// الإلهام as the room's spirit: one striking picture, one idea, one button. Used by «اليوم» (the cover) and by the segment sheet
// («شوف إزاي اتعملت»). The picture is the source's own thumbnail; the source is always named; nothing enters the locked
// references or a kit by itself: only «خده مرجع», pressed by Rabee, saves a work into the library (never as a generation input).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Play, Check, X } from '@phosphor-icons/react';
import { toast } from './ui.tsx';
import { Pic } from './Lens.tsx';
import type { Inspo } from './Inspiration.tsx';

export type Fit = Inspo & { why: string };
export type Cover = Fit & { segment_id: string; seg_label: string | null; song_id: string };

export function useCover() {
  const [cover, setCover] = useState<Cover | null | undefined>(undefined);
  useEffect(() => { fetch('/api/inspiration/cover').then(r => r.json()).then(d => setCover(d.cover ?? null)).catch(() => setCover(null)); }, []);
  return cover;
}
export function useFits(segId: string) {
  const [fits, setFits] = useState<Fit[] | null>(null);
  useEffect(() => { setFits(null); fetch(`/api/segments/${segId}/fits`).then(r => r.json()).then(d => setFits(d.items ?? [])).catch(() => setFits([])); }, [segId]);
  return fits;
}

/** The work's title, at most three words; the full title stays in the tooltip. */
export const shortWork = (t: string) => { const w = t.split(/\s+/); return w.length <= 3 ? t : w.slice(0, 3).join(' ').replace(/[‘’'"]$/, '') + '…'; };

/** One work, large: the picture, the idea, the source, and two buttons: «شوف» and «خده مرجع» (saved to this segment, never into the locked references). */
export function InspoSheet({ it, segId, stand, onClose, onTaken }: { it: Fit; segId: string; stand: string | null; onClose: () => void; onTaken?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [taken, setTaken] = useState(it.taken);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } }; addEventListener('keydown', k, true); return () => removeEventListener('keydown', k, true); }, [onClose]);
  const take = async () => {
    setBusy(true);
    const r = await fetch(`/api/inspiration/${it.id}/take`, { method: 'POST' }).then(r => r.json()).catch(() => null);
    if (r?.asset_id) { await fetch(`/api/inspiration/${it.id}/link`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ segment_id: segId }) }).catch(() => {}); setTaken(true); toast('اتحفظ على المقطع'); onTaken?.(); }
    else toast(r?.what ?? 'ما اتحفظش');
    setBusy(false);
  };
  const watch = it.watch ?? it.link;
  return createPortal(
    <div className="seg-sheet-wrap" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="seg-sheet inspo-sheet" role="dialog" aria-label={it.work}>
        <div className="grab" />
        <header className="ss-head"><div className="ph-text"><h2 className="ltr" title={it.work}>{shortWork(it.work)}</h2><p className="ltr">{[it.director, it.source_name].filter(Boolean).join(' · ')}</p></div><button className="gbtn icon soft" onClick={onClose} aria-label="اقفل"><X size={24} /></button></header>
        <figure className="inspo-big"><Pic src={it.thumb} stand={stand} /></figure>
        <p className="lens-line">{it.why || it.line}</p>
        <div className="row-btns">
          <a className="gbtn primary" href={watch} target="_blank" rel="noreferrer"><Play size={22} weight="fill" />شوف</a>
          {taken ? <span className="gbtn soft done-tag"><Check size={20} weight="bold" />اتحفظ</span> : <button className="gbtn secondary" onClick={take} disabled={busy}>خده مرجع</button>}
        </div>
        <p className="panel-line">الرابط والصورة المصغرة بس، وملك أصحابه. مش بيدخل المراجع المقفولة ولا الكيت.</p>
      </section>
    </div>, document.body);
}

/** «شوف إزاي اتعملت»: a small strip (120 px) of the three works that serve this segment, one line each on why. */
export function FitStrip({ fits, segId, stand, onTaken }: { fits: Fit[]; segId: string; stand: string | null; onTaken?: () => void }) {
  const [open, setOpen] = useState<Fit | null>(null);
  return (
    <>
      <div className="fstrip fit-strip" role="list">
        {fits.map(f => (
          <button key={f.id} className="strip-cell fit-cell" role="listitem" title={[f.work, f.director, f.source_name].filter(Boolean).join(' · ')} onClick={() => setOpen(f)}>
            <span className="strip-pic"><Pic src={f.thumb} stand={stand} /></span>
            <span className="strip-cap why">{f.why}</span>
          </button>
        ))}
      </div>
      {open && <InspoSheet it={open} segId={segId} stand={stand} onClose={() => setOpen(null)} onTaken={onTaken} />}
    </>
  );
}
