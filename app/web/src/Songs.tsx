// اليوم: a magazine cover, not a task board. One cinematic picture from the inspiration (the work closest to an open segment),
// one idea line, one button that opens the segment it serves. Then «كمّل من حيث وقفت», then five more works to thumb through.
// Nothing here generates, publishes or approves anything; «أغنية جديدة» stays: drop the files anywhere on the page.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, CaretLeft, ArrowLeft } from '@phosphor-icons/react';
import { toast } from './ui.tsx';
import { api, type Asset } from './api.ts';
import type { Inspo } from './Inspiration.tsx';
import { useCover, InspoSheet, shortWork, type Fit } from './Inspo.tsx';
import { Pic } from './Lens.tsx';
import { useRooms, Percent } from './Room.tsx';

export type SongCard = { id: string; title: string; bpm: number; bpm_approved: boolean; duration: number; poster: string | null; total: number; done: number; resume: string | null; has_audio: boolean };
export const arNum = (n: number) => n.toLocaleString('ar-EG');

export function ProgressRing({ done, total, size = 64 }: { done: number; total: number; size?: number }) {
  const r = size / 2 - 2, c = 2 * Math.PI * r, f = total ? done / total : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity=".22" strokeWidth="2" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - f)} />
    </svg>
  );
}

export function Home({ open }: { open: (song: string, seg?: string) => void }) {
  const [songs, setSongs] = useState<SongCard[] | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [sheet, setSheet] = useState<Fit | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  const cover = useCover();
  const [areas, setAreas] = useState<{ id: string; name: string; items: Inspo[] }[]>([]);
  useEffect(() => { fetch('/api/inspiration/discover').then(r => r.json()).then(d => setAreas(d.areas ?? [])).catch(() => {}); }, []);
  useEffect(() => { fetch('/api/songs').then(r => r.json()).then(d => setSongs(d.songs)); api.assets('all').then(d => setAssets(d.items)).catch(() => {}); }, []);

  // a real picture where a feed picture can't be reached: an approved look, else any approved picture
  const stand = useMemo(() => { const all = assets.filter(a => a.kind === 'image' && !a.no_generation && a.thumb); const looks = all.filter(a => a.role === 'look'); return (looks[0] ?? all.find(a => a.approved) ?? all[0])?.thumb ?? null; }, [assets]);

  const create = async (files: File[]) => {
    const audio = files.find(f => /\.(mp3|wav|flac|m4a|aiff?|ogg)$/i.test(f.name)); const srt = files.find(f => /\.srt$/i.test(f.name));
    if (!audio) { toast('اسحب ملف الأغنية'); return; }
    setBusy(true); toast('بيحلل الأغنية…');
    const fd = new FormData(); fd.append('title', audio.name.replace(/\.[^.]+$/, '')); fd.append('audio', audio, audio.name); if (srt) fd.append('srt', srt, srt.name);
    const r = await fetch('/api/songs', { method: 'POST', body: fd }).then(r => r.json()).catch(() => null);
    setBusy(false);
    if (r?.id) { toast('جاهزة'); open(r.id); } else toast(r?.what ?? 'ما قدرتش أحلل الملف');
  };

  const song = songs?.[0];
  const rooms = useRooms(song?.id);
  // what arrived and waits for me comes first; else the room I stopped at
  const ready = rooms?.ready[0];
  const cur = rooms?.rooms.find(r => r.segment_id === song?.resume);
  const when = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long' }) : '';

  return (
    <div className="work" onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={e => { if (e.currentTarget === e.target) setOver(false); }}
      onDrop={e => { e.preventDefault(); setOver(false); create([...e.dataTransfer.files]); }}>
      <div className="scroll"><div className="stack today">

        {/* الغلاف: the picture leads; the text sits on a soft dark gradient; one white capsule opens the segment this idea serves */}
        {cover && <section className="cover" key={cover.id}>
          <Pic src={cover.thumb} stand={stand} />
          <div className="cover-shade" aria-hidden="true" />
          <div className="cover-text">
            <p className="cover-credit ltr" title={cover.work}>{shortWork(cover.work)}{cover.director ? ` · ${cover.director}` : ''}</p>
            <h1 className="cover-idea">{cover.why || cover.line}</h1>
            <button className="gbtn cover-btn" onClick={() => open(cover.song_id, cover.segment_id)}>اشتغل على <span className="ltr">{cover.seg_label ?? ''}</span></button>
          </div>
        </section>}
        {cover === null && <section className="cover empty"><div className="cover-text"><h1 className="cover-idea">الإلهام بيتجاب</h1><p className="cover-credit">أول عمل بيوصل لما المصادر تتقرا على الماك</p></div></section>}

        {/* كمّل من حيث وقفت */}
        {song && <section className="next-head">
          <Percent value={rooms?.percent ?? 0} size={56} />
          <div className="next-text"><h2>{ready ? `غرفة ${arNum(ready.idx)} جاهزة` : cur ? `كمّل غرفة ${arNum(cur.idx)}` : 'كمّل من حيث وقفت'}</h2></div>
          <button className="gbtn primary icon" onClick={() => open(song.id, ready?.segment_id ?? song.resume ?? undefined)} aria-label="افتح" title="افتح"><ArrowLeft size={26} weight="bold" /></button>
        </section>}

        {/* الاكتشافات: a living magazine under the cover. One strip per area (clips, shorts, music, tools); each card: picture, short title,
            source and date, and «يفيدنا في …». Fresh only (30 days), never without a picture. A tap opens the work large, with «شوف» and «خده مرجع». */}
        {areas.map(a => (
          <section key={a.id} className="today-sec">
            <a className="sec-h" href="#/inspiration"><h2>{a.name}</h2><CaretLeft size={22} /></a>
            <div className="fstrip" role="list">
              {a.items.filter(it => it.id !== cover?.id).map(it => (
                <button key={it.id} className="strip-cell disc" role="listitem" title={[it.work, it.director, it.source_name].filter(Boolean).join(' · ')} onClick={() => setSheet({ ...it, why: it.use ? `يفيدنا في ${it.use}` : it.line })}>
                  <span className="strip-pic"><Pic src={it.thumb} stand={stand} /></span>
                  <span className="disc-title ltr">{shortWork(it.work)}</span>
                  <span className="disc-meta"><span className="ltr">{it.source_name}</span>{it.published ? ` · ${when(it.published)}` : ''}</span>
                  {it.use && <span className="disc-use">يفيدنا في {it.use}</span>}
                </button>
              ))}
            </div>
          </section>
        ))}

        <div className={'new-song' + (over ? ' over' : '')}>
          <button className="gbtn soft" onClick={() => pick.current?.click()} disabled={busy}><Plus size={22} />أغنية جديدة</button>
          <input ref={pick} type="file" hidden multiple accept="audio/*,.srt" onChange={e => create([...(e.target.files ?? [])])} />
        </div>
      </div></div>
      {sheet && song && <InspoSheet it={sheet} segId={song.resume ?? ''} stand={stand} onClose={() => setSheet(null)} />}
    </div>
  );
}

export type { Inspo };
