// الرئيسية = غرف الأغاني: poster, progress ring, one button «كمّل من حيث وقفت», and «أغنية جديدة» by dropping the files.
import { useEffect, useRef, useState } from 'react';
import { Plus, MusicNotes } from '@phosphor-icons/react';
import { toast } from './ui.tsx';

export type SongCard = { id: string; title: string; bpm: number; bpm_approved: boolean; duration: number; poster: string | null; total: number; done: number; resume: string | null; has_audio: boolean };
export const arNum = (n: number) => n.toLocaleString('ar-EG');

export function ProgressRing({ done, total, size = 64 }: { done: number; total: number; size?: number }) {
  const r = size / 2 - 4, c = 2 * Math.PI * r, f = total ? done / total : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="5" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#30d158" strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - f)} />
    </svg>
  );
}

export function Home({ open }: { open: (song: string, seg?: string) => void }) {
  const [songs, setSongs] = useState<SongCard[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const load = () => fetch('/api/songs').then(r => r.json()).then(d => setSongs(d.songs));
  useEffect(() => { load(); }, []);

  const create = async (files: File[]) => {
    const audio = files.find(f => /\.(mp3|wav|flac|m4a|aiff?|ogg)$/i.test(f.name)); const srt = files.find(f => /\.srt$/i.test(f.name));
    if (!audio) { toast('اسحب ملف الأغنية (ومعاه SRT لو موجود)'); return; }
    setBusy(true); toast('بيحلل الإيقاع والأقسام…');
    const fd = new FormData(); fd.append('title', audio.name.replace(/\.[^.]+$/, '')); fd.append('audio', audio, audio.name); if (srt) fd.append('srt', srt, srt.name);
    const r = await fetch('/api/songs', { method: 'POST', body: fd }).then(r => r.json()).catch(() => null);
    setBusy(false);
    if (r?.id) { toast('جاهزة'); open(r.id); } else toast(r?.what ?? 'ما قدرتش أحلل الملف');
  };

  return (
    <div className="work" onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={e => { if (e.currentTarget === e.target) setOver(false); }}
      onDrop={e => { e.preventDefault(); setOver(false); create([...e.dataTransfer.files]); }}>
      <div className="scroll">
        <div className="title-block"><h1>الأغاني</h1><p>{songs ? `${arNum(songs.length)} أغنية` : ' '}</p></div>
        <div className="posters">
          {!songs && [0, 1].map(i => <div key={i} className="poster skeleton" />)}
          {songs?.map(s => (
            <article key={s.id} className="poster">
              {s.poster ? <img src={s.poster} alt="" /> : <div className="poster-blank"><MusicNotes size={72} weight="thin" /></div>}
              <div className="poster-shade" />
              <div className="poster-ring"><ProgressRing done={s.done} total={s.total} /><span>{arNum(s.done)} من {arNum(s.total)} ✓</span></div>
              <div className="poster-body">
                <h2 className="ltr">{s.title}</h2>
                <p>{s.bpm ? `${s.bpm} BPM${s.bpm_approved ? '' : ' · مستني اعتمادك'}` : ''}</p>
                <button className="gbtn primary big" onClick={() => open(s.id, s.resume ?? undefined)}>كمّل من حيث وقفت</button>
              </div>
            </article>
          ))}
          <button className={'poster new' + (over ? ' over' : '')} onClick={() => pick.current?.click()} disabled={busy}>
            <Plus size={40} weight="light" /><b>أغنية جديدة</b><span>اسحب ملف الأغنية + SRT</span>
            <input ref={pick} type="file" hidden multiple accept="audio/*,.srt" onChange={e => create([...(e.target.files ?? [])])} />
          </button>
        </div>
      </div>
    </div>
  );
}
