// الغرفة: a segment as a room. A table of its shots (picture, scene, stars from the check, two lamps), the percent that is
// approved, and its folders. Claude's lamp is a recommendation (the take arrived and passed the check); Rabee's lamp is his
// «اعتمد», and only his press sets it. Nothing here generates anything.
import { useCallback, useEffect, useState } from 'react';
import { Star, Sparkle, CheckCircle, Images, FilmStrip, Hourglass, ArrowsLeftRight } from '@phosphor-icons/react';
import { toast } from './ui.tsx';
import { arNum } from './Songs.tsx';

export type RoomShot = { code: string; title: string; start_s: number; end_s: number; take_id: string | null; thumb: string | null; takes: number;
  stars: number | null; checked: 'none' | 'partial' | 'full'; claude: boolean; approved: boolean };
export type Room = { shots: RoomShot[]; total: number; approved: number; percent: number; waiting: number; takes_ready: number; tests: number };
export type RoomsOfSong = { rooms: { segment_id: string; idx: number; total: number; approved: number; percent: number; waiting: number }[]; total: number; approved: number; percent: number; ready: { segment_id: string; idx: number }[] };

export function useRoom(segId: string) {
  const [room, setRoom] = useState<Room | null>(null);
  const load = useCallback(() => fetch(`/api/segments/${segId}/room`).then(r => r.json()).then(setRoom).catch(() => setRoom(null)), [segId]);
  useEffect(() => { setRoom(null); load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]); // a take can arrive while the room is open
  return { room, reload: load };
}
export function useRooms(songId: string | undefined) {
  const [d, setD] = useState<RoomsOfSong | null>(null);
  useEffect(() => { if (!songId) return; fetch(`/api/songs/${songId}/rooms`).then(r => r.json()).then(setD).catch(() => setD(null)); }, [songId]);
  return d;
}

/** A thin ring with the percent inside: how much of the room Rabee approved. */
export function Percent({ value, size = 56, onPicture }: { value: number; size?: number; onPicture?: boolean }) {
  const r = size / 2 - 3, c = 2 * Math.PI * r;
  return (
    <span className={'pct' + (onPicture ? ' on-pic' : '')} style={{ width: size, height: size }} role="img" aria-label={`${value}٪ جاهز`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset 700ms cubic-bezier(.2,.8,.2,1)' }} />
      </svg>
      <b>{arNum(value)}٪</b>
    </span>
  );
}

const stars = (s: RoomShot) => s.stars ? `${arNum(s.stars)} نجوم من ٥` : s.checked === 'partial' ? 'اتفحصت من غير الوش' : s.take_id ? 'بتتفحص' : 'لسه مفيش نسخة';
const state = (s: RoomShot) => `${stars(s)} · ${s.claude ? 'Claude: عدّت الفحص' : 'Claude: لسه'} · ${s.approved ? 'معتمدة' : 'مش معتمدة'}`;
const sceneOf = (t: string) => t.split('،')[0].replace(/\([^)]*\)/g, ' ').replace(/["«][^"»]*["»]/g, ' ').replace(/\s+/g, ' ').trim();

/** The shots of the room. A row opens its take (or its frame when nothing arrived yet). */
export function RoomTable({ room, stand, reload, open }: { room: Room; stand: string | null; reload: () => void; open: (s: RoomShot, i: number) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const approve = async (s: RoomShot) => {
    if (!s.take_id) { toast('لسه مفيش نسخة للّقطة دي'); return; }
    setBusy(s.code);
    const r = await fetch(`/api/takes/${s.take_id}/${s.approved ? 'reject' : 'approve'}`, { method: 'POST' });
    setBusy(null); if (r.ok) { toast(s.approved ? 'اتشال الاعتماد' : 'اللقطة اتعتمدت'); reload(); } else toast('ما اتسجلش، جرّب تاني');
  };
  return (
    <div className="room-table" role="table" aria-label="لقطات الغرفة">
      {room.shots.map((s, i) => (
        <div key={s.code} className="room-row" role="row" aria-label={`لقطة ${arNum(i + 1)} · ${sceneOf(s.title)} · ${state(s)}`}>
          <span role="cell" className="room-cell">
          <button className="room-open" onClick={() => open(s, i)} aria-label={`لقطة ${arNum(i + 1)} · ${sceneOf(s.title)} · ${stars(s)} · افتح`}>
            <span className="room-pic">{(s.thumb ?? stand) && <img src={s.thumb ?? stand ?? ''} alt="" loading="lazy" className={s.thumb ? undefined : 'temp'} />}<i className="room-n">{arNum(i + 1)}</i></span>
            <span className="room-text">
              <b>{sceneOf(s.title)}</b>
              <span className="room-stars">
                {s.stars ? [1, 2, 3, 4, 5].map(n => <Star key={n} size={18} weight={n <= s.stars! ? 'fill' : 'regular'} />) : <small>{s.checked === 'partial' ? 'من غير الوش' : s.take_id ? 'بيتفحص' : 'لسه'}</small>}
              </span>
            </span>
          </button>
          </span>
          {/* Claude's lamp: lit when the take passed the check. A recommendation, never an approval. */}
          <span role="cell"><span role="img" className={'lamp claude' + (s.claude ? ' on' : '')} title={s.claude ? 'Claude: عدّت الفحص' : 'Claude: لسه'} aria-label={s.claude ? 'Claude: عدّت الفحص' : 'Claude: لسه'}><Sparkle size={20} weight={s.claude ? 'fill' : 'regular'} aria-hidden="true" /></span></span>
          {/* Rabee's lamp: his «اعتمد» on this shot's take. */}
          <span role="cell"><button className={'lamp rabee' + (s.approved ? ' on' : '')} disabled={busy === s.code || !s.take_id} aria-pressed={s.approved} onClick={() => approve(s)} aria-label={s.approved ? `لقطة ${arNum(i + 1)} معتمدة · شيل الاعتماد` : s.take_id ? `اعتمد لقطة ${arNum(i + 1)}` : `لقطة ${arNum(i + 1)} · لسه مفيش نسخة تتعتمد`} title={s.approved ? 'معتمدة' : s.take_id ? 'اعتمد' : 'لسه مفيش نسخة'}><CheckCircle size={26} weight={s.approved ? 'fill' : 'regular'} aria-hidden="true" /></button></span>
        </div>
      ))}
    </div>
  );
}

/** The room's folders: pictures, ready shots, what is left, and the backup plan. Each opens the panel that already holds it. */
export function RoomFolders({ pics, ready, left, go }: { pics: number; ready: number; left: number; go: (p: 'board' | 'takes' | 'shots' | 'prompt') => void }) {
  const F = ({ p, I, t, n }: { p: 'board' | 'takes' | 'shots' | 'prompt'; I: typeof Images; t: string; n?: number }) => (
    <button className="folder" data-panel={p} onClick={() => go(p)} aria-label={n != null ? `${t} · ${arNum(n)}` : t}><I size={26} /><b>{t}</b>{n != null && <small>{arNum(n)}</small>}</button>
  );
  return (
    <div className="folders" role="group" aria-label="مجلدات الغرفة">
      <F p="board" I={Images} t="الصور" n={pics} />
      <F p="takes" I={FilmStrip} t="الجاهز" n={ready} />
      <F p="shots" I={Hourglass} t="الباقي" n={left} />
      <F p="prompt" I={ArrowsLeftRight} t="الاحتياط" />
    </div>
  );
}
