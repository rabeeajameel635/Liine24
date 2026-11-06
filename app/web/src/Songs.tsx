// اليوم (الرئيسية): a showroom, not a list. One picture leads (today's pick from the elite feeds), then your next step on the
// song, your approved shots, and the rest of today's picks. «أغنية جديدة» stays: drop the files anywhere on the page.
// Nothing here generates, publishes or approves anything.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Play, Check, CaretLeft } from '@phosphor-icons/react';
import { toast, PageHead } from './ui.tsx';
import { api, type Asset } from './api.ts';
import { useInspiration, LinkSheet, type Inspo } from './Inspiration.tsx';
import { tcode } from './Takes.tsx';

export type SongCard = { id: string; title: string; bpm: number; bpm_approved: boolean; duration: number; poster: string | null; total: number; done: number; resume: string | null; has_audio: boolean };
export const arNum = (n: number) => n.toLocaleString('ar-EG');
type Seg = { id: string; idx: number; start_s: number; end_s: number; label: string | null; group_label: string | null; lyric: string; status: string; refs: string[]; video_asset_id: string | null };
type SongFull = { id: string; bar: number; sections: { name: string; start: number }[]; segments: Seg[] };
type Shot = { id: string; thumb: string | null; src: string | null; segment_id: string; song_id: string; at: number; line: string | null; scene: string | null };

export function ProgressRing({ done, total, size = 64 }: { done: number; total: number; size?: number }) {
  const r = size / 2 - 2, c = 2 * Math.PI * r, f = total ? done / total : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity=".22" strokeWidth="2" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - f)} />
    </svg>
  );
}

/** Short section name for one-line captions (same rule as the board): drops quotes, brackets, timecodes and counts. */
const secShort = (name?: string | null) => {
  const t = (name ?? '').replace(/"[^"]*"/g, ' ').replace(/«[^»]*»/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/[×+]\S*/g, ' ').replace(/\d+:\d+(\.\d+)?/g, ' ').replace(/\s+/g, ' ').trim();
  return t.split(' ').slice(0, 2).join(' ') || 'مقطع';
};
/** Work titles are capped at three words; the full name stays in the tooltip. */
const short = (t: string) => { const w = t.split(/\s+/); return w.length <= 3 ? t : w.slice(0, 3).join(' ').replace(/[‘’'"]$/, '') + '…'; };

/** A feed picture that can't be reached shows a faded picture from the library, never an empty grey box. */
function Pic({ src, stand, kb }: { src: string | null; stand: string | null; kb?: boolean }) {
  const [s, setS] = useState<{ src: string | null; temp: boolean }>({ src, temp: false });
  useEffect(() => { setS({ src, temp: false }); }, [src]);
  const cur = s.src ?? stand;
  if (!cur) return null;
  return <img src={cur} alt="" loading="lazy" className={(kb ? 'kb' : '') + (s.temp || !s.src ? ' temp' : '')} onError={e => { if (!s.temp && stand && cur !== stand) setS({ src: stand, temp: true }); else e.currentTarget.style.visibility = 'hidden'; }} />;
}

export function Home({ open }: { open: (song: string, seg?: string) => void }) {
  const [songs, setSongs] = useState<SongCard[] | null>(null);
  const [full, setFull] = useState<Record<string, SongFull>>({});
  const [shots, setShots] = useState<Shot[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [linking, setLinking] = useState<Inspo | null>(null);
  const [taken, setTaken] = useState<Record<string, boolean>>({});
  const pick = useRef<HTMLInputElement>(null);
  const { d: feed } = useInspiration(undefined, 6);
  const load = () => fetch('/api/songs').then(r => r.json()).then(d => { setSongs(d.songs); for (const s of d.songs as SongCard[]) fetch(`/api/songs/${s.id}`).then(r => r.json()).then(f => setFull(x => ({ ...x, [s.id]: f }))); });
  useEffect(() => { load(); fetch('/api/gallery').then(r => r.json()).then(d => setShots(d.items ?? [])).catch(() => {}); api.assets('all').then(d => setAssets(d.items)).catch(() => {}); }, []);

  // real pictures where a segment or a feed has none: approved looks first, then any approved picture
  const fallback = useMemo(() => { const all = assets.filter(a => a.kind === 'image' && !a.no_generation && a.thumb); const looks = all.filter(a => a.role === 'look'); return (looks.length ? looks : all.filter(a => a.approved).length ? all.filter(a => a.approved) : all).map(a => a.thumb!); }, [assets]);
  const stand = fallback[0] ?? null;
  const picOf = (s: Seg) => (s.video_asset_id && assets.find(a => a.id === s.video_asset_id)?.thumb) || (s.refs[0] && assets.find(a => a.id === s.refs[0])?.thumb) || (fallback.length ? fallback[(s.idx - 1) % fallback.length] : null);

  const create = async (files: File[]) => {
    const audio = files.find(f => /\.(mp3|wav|flac|m4a|aiff?|ogg)$/i.test(f.name)); const srt = files.find(f => /\.srt$/i.test(f.name));
    if (!audio) { toast('اسحب ملف الأغنية'); return; }
    setBusy(true); toast('بيحلل الأغنية…');
    const fd = new FormData(); fd.append('title', audio.name.replace(/\.[^.]+$/, '')); fd.append('audio', audio, audio.name); if (srt) fd.append('srt', srt, srt.name);
    const r = await fetch('/api/songs', { method: 'POST', body: fd }).then(r => r.json()).catch(() => null);
    setBusy(false);
    if (r?.id) { toast('جاهزة'); open(r.id); } else toast(r?.what ?? 'ما قدرتش أحلل الملف');
  };
  const take = async (it: Inspo) => {
    const r = await fetch(`/api/inspiration/${it.id}/take`, { method: 'POST' }).then(r => r.json()).catch(() => null);
    if (r?.asset_id) { setTaken(t => ({ ...t, [it.id]: true })); setLinking({ ...it, taken: true }); } else toast(r?.what ?? 'ما اتحفظش');
  };

  const items = feed?.items ?? [];
  const hero = items[0], rest = items.slice(1);
  const heroTaken = hero ? (taken[hero.id] || hero.taken) : false;

  return (
    <div className="work" onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={e => { if (e.currentTarget === e.target) setOver(false); }}
      onDrop={e => { e.preventDefault(); setOver(false); create([...e.dataTransfer.files]); }}>
      <div className="scroll"><div className="stack today">
        <PageHead title="اليوم" />

        {/* لقطة اليوم: the pick closest to the song, from the directors' feeds. Link and picture only; the source is always named. */}
        {hero && <section className="today-pick">
          <a className="today-hero" href={hero.watch ?? hero.link} target="_blank" rel="noreferrer" aria-label={`شوف ${hero.work}`}>
            <Pic src={hero.thumb} stand={stand} kb />
            {/* the headline is the line Claude wrote about it; the work and its director stay in the tooltip and on the inspiration page */}
            <span className="hero-cap glass headline" title={[hero.work, hero.director].filter(Boolean).join(' · ')}><b>{hero.line}</b></span>
            <span className="hero-play glass" aria-hidden="true"><Play size={22} weight="fill" /></span>
          </a>
          <div className="today-under">
            <div className="today-text"><p className="ltr" title={hero.work}>{hero.source_name}</p></div>
            {heroTaken ? <span className="gbtn soft done-tag"><Check size={20} weight="bold" />اتحفظ</span> : <button className="gbtn secondary" onClick={() => take(hero)}>خده مرجع</button>}
          </div>
        </section>}

        {/* خطوتك الجاية: the song, how far it is, and the first three segments that need work */}
        {songs?.map(s => { const f = full[s.id]; const next = (f?.segments ?? []).filter(x => x.status !== 'done' && x.status !== 'editing').slice(0, 3); return (
          <section key={s.id} className="today-sec">
            <div className="next-head">
              <span className="ring-ink" aria-label={`${s.done} من ${s.total}`}><ProgressRing done={s.done} total={s.total} size={56} />{s.done > 0 && <b>{arNum(s.done)}</b>}</span>
              <div className="next-text"><h2>خطوتك الجاية</h2>{(songs.length > 1 || s.done > 0) && <p>{songs.length > 1 ? <span className="ltr">{s.title}</span> : null}{songs.length > 1 && s.done > 0 ? ' · ' : ''}{s.done > 0 ? `${arNum(s.done)} من ${arNum(s.total)} خلص` : ''}</p>}</div>
              <button className="gbtn primary" onClick={() => open(s.id, s.resume ?? undefined)}>كمّل</button>
            </div>
            {next.length > 0 && <div className="fstrip" role="list">
              {next.map(x => { const sec = f ? [...f.sections].reverse().find(y => y.start <= x.start_s + 0.01) : null; const bars = f ? Math.round((x.end_s - x.start_s) / f.bar) : 0; return (
                <button key={x.id} className="strip-cell" role="listitem" onClick={() => open(s.id, x.id)}>
                  <span className="strip-pic"><Pic src={picOf(x)} stand={stand} /></span>
                  <span className="strip-cap">{secShort(sec?.name ?? x.group_label)}{bars ? <small className="bars">{arNum(bars)} بار</small> : null}</span>
                </button>
              ); })}
            </div>}
          </section>
        ); })}

        {/* شغلك: approved shots only, in song order, from the gallery */}
        {shots.length > 0 && <section className="today-sec">
          <a className="sec-h" href="#/gallery"><h2>شغلك</h2><span>{arNum(shots.length)} لقطات</span><CaretLeft size={22} /></a>
          <div className="fstrip reel-strip" role="list">
            {shots.map(t => (
              <button key={t.id} className="strip-cell wide" role="listitem" onClick={() => { location.hash = `/board/${t.song_id}/${t.segment_id}`; }}>
                <span className="strip-pic"><Pic src={t.thumb} stand={stand} /></span>
                <span className="strip-cap"><span className="ltr lyric">{t.line ?? t.scene ?? ''}</span><small className="ltr tcode">{tcode(t.at)}</small></span>
              </button>
            ))}
          </div>
        </section>}

        {/* من النخبة: the rest of today's picks; tap to watch, «الكل» for the full page with «خده مرجع» on each */}
        {rest.length > 0 && <section className="today-sec">
          <a className="sec-h" href="#/inspiration"><h2>من النخبة</h2><CaretLeft size={22} /></a>
          <div className="fstrip" role="list">
            {rest.map(it => (
              <a key={it.id} className="strip-cell" role="listitem" href={it.watch ?? it.link} target="_blank" rel="noreferrer" title={[it.work, it.director, it.source_name].filter(Boolean).join(' · ')}>
                <span className="strip-pic"><Pic src={it.thumb} stand={stand} /></span>
                <span className="strip-cap ltr">{short(it.work)}</span>
              </a>
            ))}
          </div>
        </section>}

        <div className={'new-song' + (over ? ' over' : '')}>
          <button className="gbtn soft" onClick={() => pick.current?.click()} disabled={busy}><Plus size={22} />أغنية جديدة</button>
          <input ref={pick} type="file" hidden multiple accept="audio/*,.srt" onChange={e => create([...(e.target.files ?? [])])} />
        </div>
      </div></div>
      {linking && <LinkSheet it={linking} onClose={() => setLinking(null)} />}
    </div>
  );
}
