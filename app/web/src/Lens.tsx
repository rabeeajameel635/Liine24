// الزاوية: our frame beside one chosen reference, and two lines: what we learn, and what stays as decided.
// An analysis tool: nothing here changes a shot, a prompt or a reference. The same component serves the segment sheet and «قارن» in the gallery.
import { useCallback, useEffect, useState } from 'react';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { Details } from './ui.tsx';

export type Study = { learn: string; keep: string };
export type Lens = { asset_id: string; label: string | null; thumb: string | null; link: string | null; watch: string | null; director: string | null; source: string | null;
  license: string | null; rights: string; no_generation: boolean; study: Study; evidence: string; evidence_ar: string; author: string; updated_at: string };
export type Ours = { thumb: string | null; src?: string | null };

export function useLens(segId: string) {
  const [lens, setLens] = useState<Lens | null | undefined>(undefined);
  const load = useCallback(() => fetch(`/api/segments/${segId}/lens`).then(r => r.json()).then(d => setLens(d.lens ?? null)).catch(() => setLens(null)), [segId]);
  useEffect(() => { setLens(undefined); load(); }, [load]);
  return { lens, reload: load };
}

/** A picture that can't be reached (feed hosts are blocked in the cloud) shows faded, never as an empty grey box. */
export function Pic({ src, stand }: { src: string | null; stand: string | null }) {
  const [s, setS] = useState<{ src: string | null; temp: boolean }>({ src, temp: false });
  useEffect(() => { setS({ src, temp: false }); }, [src]);
  const cur = s.src ?? stand; if (!cur) return null;
  return <img src={cur} alt="" loading="lazy" className={s.temp || !s.src ? 'temp' : undefined} onError={e => { if (!s.temp && stand && cur !== stand) setS({ src: stand, temp: true }); else e.currentTarget.style.visibility = 'hidden'; }} />;
}

/** Our frame and the reference, the same size, side by side (stacked on a phone). */
export function LensPair({ ours, lens, compact }: { ours: Ours; lens: Lens; compact?: boolean }) {
  return (
    <div className={'lens-pair' + (compact ? ' compact' : '')}>
      <figure className="lens-frame">
        {ours.src && !compact ? <video src={ours.src} poster={ours.thumb ?? undefined} muted loop playsInline autoPlay preload="metadata" /> : <Pic src={ours.thumb} stand={null} />}
        {!compact && <figcaption className="hero-cap glass small"><b>كادرنا</b></figcaption>}
      </figure>
      <figure className="lens-frame">
        <Pic src={lens.thumb} stand={ours.thumb} />
        {!compact && <figcaption className="hero-cap glass small"><b className="ltr">{lens.source ?? 'المرجع'}</b></figcaption>}
      </figure>
    </div>
  );
}

export function LensPanel({ ours, lens }: { ours: Ours; lens: Lens }) {
  return (
    <div className="lens">
      <LensPair ours={ours} lens={lens} />
      <p className="lens-line">{lens.study.learn}</p>
      <Details>
        <p className="lens-keep"><b>بيفضل زي ما هو:</b> {lens.study.keep}</p>
        <p>التحليل {lens.evidence_ar}{lens.author ? ` · ${lens.author}` : ''}.</p>
        <p className="lens-src"><span className="ltr">{[lens.label, lens.director, lens.source].filter(Boolean).join(' · ')}</span></p>
        <p><span className="rights-badge">{lens.rights === 'internal' ? 'للمراجعة الداخلية بس' : lens.rights}</span> {lens.license}</p>
        <p>المرجع شغل حد تاني: مش بيتبعت للتوليد، ومش بيدخل أي عرض عام من غير ترخيص.</p>
        {(lens.watch ?? lens.link) && <a className="gbtn soft" href={lens.watch ?? lens.link ?? '#'} target="_blank" rel="noreferrer"><ArrowSquareOut size={22} />افتح المصدر</a>}
      </Details>
    </div>
  );
}
