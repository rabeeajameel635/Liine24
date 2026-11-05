// الإلهام: works from the feeds directors follow, as reference cards. Link + thumbnail only; the source is always named.
import { useEffect, useState } from 'react';
import { Play, Check, Funnel, Warning } from '@phosphor-icons/react';
import { PageHead, Details, toast } from './ui.tsx';
import { arNum } from './Songs.tsx';

export type Inspo = { id: string; source: string; source_name: string; link: string; work: string; artist: string | null; director: string | null; thumb: string | null;
  watch: string | null; line: string; category: string; category_ar: string; score: number; published: string | null; taken: boolean };
type Source = { id: string; name: string; mode: string; last_ok: string | null; last_try: string | null; error: string | null; down: boolean; items: number };
type Feed = { items: Inspo[]; sources: Source[]; pending: number; categories: Record<string, string> };

export function useInspiration(category?: string, limit?: number) {
  const [d, setD] = useState<Feed | null>(null);
  const load = () => fetch(`/api/inspiration?${new URLSearchParams({ ...(category ? { category } : {}), ...(limit ? { limit: String(limit) } : {}) })}`).then(r => r.json()).then(setD);
  useEffect(() => { load(); }, [category, limit]);
  return { d, reload: load };
}

/** Card titles are capped at three words; the full name stays in the tooltip and in the library. */
const short = (t: string) => { const w = t.split(/\s+/); return w.length <= 3 ? t : w.slice(0, 3).join(' ').replace(/[‘’'"]$/, '') + '…'; };

const when = (iso: string | null) => {
  if (!iso) return 'لسه';
  const t = new Date(iso); const today = new Date().toDateString() === t.toDateString();
  return (today ? 'النهارده ' : t.toLocaleDateString('ar-EG', { day: 'numeric', month: 'long' }) + ' ') + t.toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' });
};

export function InspoCard({ it, onTaken, compact }: { it: Inspo; onTaken: (it: Inspo) => void; compact?: boolean }) {
  const [img, setImg] = useState(!!it.thumb);
  const [busy, setBusy] = useState(false);
  const take = async () => {
    setBusy(true);
    const r = await fetch(`/api/inspiration/${it.id}/take`, { method: 'POST' }).then(r => r.json()).catch(() => null);
    setBusy(false);
    if (r?.asset_id) onTaken({ ...it, taken: true }); else toast(r?.what ?? 'ما اتحفظش');
  };
  const watch = it.watch ?? it.link;
  return (
    <article className={'card inspo' + (compact ? ' compact' : '')}>
      {img && it.thumb && (
        <a className="card-img inspo-img" href={watch} target="_blank" rel="noreferrer" aria-label={`شوف ${it.work}`}>
          <img src={it.thumb} alt="" loading="lazy" onError={() => setImg(false)} />
          <span className="inspo-play"><Play size={26} weight="fill" /></span>
        </a>
      )}
      <div className="inspo-body">
        <h2 className="ltr" title={it.work}>{short(it.work)}</h2>
        <p className="inspo-credit ltr">{[it.director, it.source_name].filter(Boolean).join(' · ')}</p>
        <p className="inspo-line">{it.line}</p>
        <div className="inspo-actions">
          {!img && <a className="gbtn icon soft" href={watch} target="_blank" rel="noreferrer" aria-label="شوف"><Play size={22} weight="fill" /></a>}
          {it.taken ? <span className="gbtn soft done-tag"><Check size={20} weight="bold" /> اتحفظ</span>
            : <button className="gbtn secondary" onClick={take} disabled={busy}>خده مرجع</button>}
        </div>
      </div>
    </article>
  );
}

/** After «خده مرجع»: ask which segment it belongs to (or none for now). */
export function LinkSheet({ it, onClose }: { it: Inspo; onClose: () => void }) {
  const [segs, setSegs] = useState<{ id: string; label: string | null; idx: number; group_label: string | null }[]>([]);
  useEffect(() => { fetch('/api/songs/iatw-v44').then(r => r.json()).then(d => setSegs(d.segments ?? [])); }, []);
  const link = async (id: string, label: string) => {
    const r = await fetch(`/api/inspiration/${it.id}/link`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ segment_id: id }) });
    toast(r.ok ? `اتربط بـ ${label}` : 'ما اتربطش'); onClose();
  };
  return (
    <div className="seg-sheet-wrap" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="seg-sheet link-sheet" role="dialog" aria-label="تربطه بأنهي مقطع">
        <div className="grab" />
        <header className="ss-head"><div className="ph-text"><h2>تربطه بأنهي مقطع؟</h2><p>اتحفظ في المكتبة</p></div></header>
        <div className="link-grid">
          {segs.map(s => <button key={s.id} className="chip-f ltr" onClick={() => link(s.id, s.label ?? String(s.idx))}>{s.label ?? arNum(s.idx)}</button>)}
        </div>
        <button className="gbtn soft" onClick={onClose}>مش دلوقتي</button>
      </section>
    </div>
  );
}

/** «إلهام النهارده» on the home page: the five closest to the current song. */
export function InspoCarousel() {
  const { d } = useInspiration(undefined, 5);
  const [items, setItems] = useState<Inspo[]>([]);
  const [linking, setLinking] = useState<Inspo | null>(null);
  useEffect(() => { if (d) setItems(d.items); }, [d]);
  if (!d || !items.length) return null;
  return (
    <section className="inspo-home">
      <div className="section-h"><h2>إلهام النهارده</h2><a className="see-all" href="#/inspiration">الكل</a></div>
      <div className="h-scroll inspo-row">
        {items.map(it => <InspoCard key={it.id} it={it} compact onTaken={x => { setItems(xs => xs.map(y => y.id === x.id ? x : y)); setLinking(x); }} />)}
      </div>
      {linking && <LinkSheet it={linking} onClose={() => setLinking(null)} />}
    </section>
  );
}

/** Full page inside the studio. */
export function InspirationPage() {
  const [cat, setCat] = useState<string | undefined>();
  const [menu, setMenu] = useState(false);
  const { d } = useInspiration(cat);
  const [items, setItems] = useState<Inspo[]>([]);
  const [linking, setLinking] = useState<Inspo | null>(null);
  useEffect(() => { if (d) setItems(d.items); }, [d]);
  const down = d?.sources.filter(s => s.down) ?? [];
  return (
    <div className="work"><div className="scroll"><div className="stack">
      <PageHead title="الإلهام"
        line={down.length ? <span className="badge-warn"><Warning size={18} weight="fill" /> المصدر مش راجع</span> : undefined}
        action={<div className="more-wrap">
          <button className="gbtn soft" aria-expanded={menu} onClick={() => setMenu(m => !m)}><Funnel size={22} />{cat ? d?.categories[cat] : 'التصنيف'}</button>
          {menu && d && <div className="more-menu glass-strong" role="menu">
            <button role="menuitemradio" aria-checked={!cat} onClick={() => { setCat(undefined); setMenu(false); }}>الكل</button>
            {Object.entries(d.categories).map(([k, v]) => <button key={k} role="menuitemradio" aria-checked={cat === k} onClick={() => { setCat(k); setMenu(false); }}>{v}</button>)}
          </div>}
        </div>} />
      {d && !items.length && <p className="panel-line">{d.pending ? 'بيتحلل…' : 'مفيش حاجة في التصنيف ده'}</p>}
      <div className="inspo-list">
        {items.map(it => <InspoCard key={it.id} it={it} onTaken={x => { setItems(xs => xs.map(y => y.id === x.id ? x : y)); setLinking(x); }} />)}
      </div>
      {d && <Details label="المصادر">
        {d.sources.map(s => <p key={s.id} className="src-row"><b className="ltr">{s.name}</b> · {s.down ? <span className="badge-warn">المصدر مش راجع</span> : `آخر جلب ${when(s.last_ok)}`}{s.mode === 'fixture' ? ' · نسخة محلية للاختبار' : ''}</p>)}
        <p className="mute">بيتجاب مرة في اليوم. الرابط والصورة المصغرة بس، ومفيش تحميل لأي فيديو.</p>
      </Details>}
      {linking && <LinkSheet it={linking} onClose={() => setLinking(null)} />}
    </div></div></div>
  );
}
