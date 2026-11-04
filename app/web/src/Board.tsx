// لوحة المقاطع: cards like the library, a strip view on the waveform, status filters, and the segment sheet.
// No save button: every change is saved as it happens, with versions and undo (⌘Z).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, Plus, Minus, X, ArrowRight, ArrowLeft, Scissors, ArrowsMerge, SquaresFour, Waveform, Copy, DownloadSimple, ArrowSquareOut, CheckCircle, ArrowCounterClockwise, FilmStrip, Warning } from '@phosphor-icons/react';
import { api, type Asset } from './api.ts';
import { toast } from './ui.tsx';
import { ProgressRing, arNum } from './Songs.tsx';

type Seg = { id: string; idx: number; start_s: number; end_s: number; label: string | null; group_label: string | null; lyric: string; status: Status; direction: string; prompt_partial: string;
  tool: string; backup: { tool?: string; direction?: string; prompt_partial?: string }; refs: string[]; video_asset_id: string | null; kit_code: string | null; notes: string; updated_at: string; draft: number };
type Status = 'idea' | 'ready' | 'generating' | 'done' | 'editing';
type Tool = { name: string; via: string; mode: 'mcp' | 'bridge'; url: string };
type Song = { id: string; title: string; bpm: number; bpm_approved: number; beat_offset: number; bar: number; duration: number; sections: { name: string; start: number }[]; peaks: number[] | null;
  poster: string | null; audio: string | null; segment_seconds: number; segments: Seg[]; tools: Record<string, Tool>; bpm_candidates: { bpm: number; conf: number; offset?: number; tracked?: boolean }[]; plan_note: string | null; master_missing?: boolean;
  tempo_local?: { t: number; bpm: number }[]; grid_measured?: boolean };
type Shot = { id: string; code: string; title: string; start_s: number; end_s: number; status: 'approved' | 'candidate' | 'redo' | 'pending'; kind: string | null; note: string | null; source: string; segment_id: string; conflicts: number[]; questions: string[]; blocked: string | null; answers: string[] };
type Conflict = { id: string; n: number; title: string; proposal: string; shots: string[]; status: string; decision: string | null };
export const SHOT: Record<Shot['status'], { t: string; c: string }> = { approved: { t: 'معتمد', c: '#30d158' }, candidate: { t: 'مرشّح', c: '#0a84ff' }, redo: { t: 'قيد إعادة', c: '#ff9f0a' }, pending: { t: 'لسه', c: '#8e8e93' } };

export const STATUS: Record<Status, { t: string; c: string }> = {
  idea: { t: 'فكرة', c: '#8e8e93' }, ready: { t: 'جاهز للتوليد', c: '#0a84ff' }, generating: { t: 'بيتولّد', c: '#ff9f0a' }, done: { t: 'تمّت ✓', c: '#30d158' }, editing: { t: 'في المونتاج', c: '#5e5ce6' }
};
const tc = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const patch = (id: string, body: Partial<Seg>) => fetch(`/api/segments/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ ok: r.ok, data: await r.json() }));
const post = (url: string, body?: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then(async r => ({ ok: r.ok, data: await r.json() }));

export function Board({ songId, segId, go }: { songId: string; segId?: string; go: (seg?: string) => void }) {
  const [song, setSong] = useState<Song | null>(null);
  const [view, setView] = useState<'cards' | 'strip'>('cards');
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [assets, setAssets] = useState<Record<string, Asset>>({});
  const [shots, setShots] = useState<Shot[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const load = useCallback(() => { fetch(`/api/songs/${songId}`).then(r => r.json()).then(setSong); fetch(`/api/songs/${songId}/shots`).then(r => r.json()).then(d => { setShots(d.shots); setConflicts(d.conflicts); }); }, [songId]);
  useEffect(() => { load(); api.assets('all').then(d => setAssets(Object.fromEntries(d.items.map(a => [a.id, a])))); }, [load]);
  if (!song) return <div className="work"><div className="title-block"><h1> </h1></div></div>;

  const segs = song.segments, done = segs.filter(s => s.status === 'done' || s.status === 'editing').length;
  const resume = segs.find(s => s.status !== 'done' && s.status !== 'editing');
  const counts = segs.reduce((m, s) => ({ ...m, [s.status]: (m[s.status] ?? 0) + 1 }), {} as Record<string, number>);
  const list = filter === 'all' ? segs : segs.filter(s => s.status === filter);
  const sel = segId ? segs.find(s => s.id === segId) : undefined;
  const thumbOf = (s: Seg) => (s.video_asset_id && assets[s.video_asset_id]?.thumb) || (s.refs[0] && assets[s.refs[0]]?.thumb) || null;

  return (
    <div className="work">
      <div className="topbar">
        <div className="seg glass">
          <button aria-pressed={view === 'cards'} onClick={() => setView('cards')}><SquaresFour size={16} /> كروت</button>
          <button aria-pressed={view === 'strip'} onClick={() => setView('strip')}><Waveform size={16} /> شريط</button>
        </div>
        <span className="sp" />
        <a className="gbtn glass" href={`#/montage/${song.id}`} aria-label="المونتاج"><FilmStrip size={18} /><span className="hide-m">المونتاج</span></a>
        {resume && <button className="gbtn primary" onClick={() => go(resume.id)}>كمّل من حيث وقفت</button>}
      </div>
      <div className="scroll">
        <header className="board-head">
          {song.poster && <img className="board-poster" src={song.poster} alt="" />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className="ltr" style={{ textAlign: 'right' }}>{song.title}</h1>
            <div className="board-meta">
              <span className="bpm"><b>{song.bpm}</b> BPM</span>
              <span className="mute">{song.bpm_approved ? 'معتمد' : 'مستني اعتمادك'}</span>
              <span className="mute">· البار {song.bar.toFixed(2)} ث</span>
            </div>
          </div>
          <div className="board-ring"><ProgressRing done={done} total={segs.length} size={72} /><span>{arNum(done)} من {arNum(segs.length)} ✓</span></div>
        </header>
        {!song.audio && <AudioMissing song={song} reload={load} />}
        {song.audio && !song.bpm_approved && song.bpm_candidates.length > 0 && <BpmCompare song={song} reload={load} />}
        {song.plan_note && <div className="banner glass soft"><span className="pill sm">{shots.length ? 'v44' : 'مبدئي'}</span><span>{song.plan_note}</span></div>}
        {song.master_missing && <div className="banner glass soft"><Warning size={18} weight="fill" color="#ff9f0a" /><span>ملف الماستر FLAC لسه ناقص للتصدير النهائي.</span></div>}
        {conflicts.length > 0 && <ConflictList conflicts={conflicts} />}
        <SplitBar song={song} reload={load} />
        <div className="filters">
          <button className="chip-f" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>الكل <b>{arNum(segs.length)}</b></button>
          {(Object.keys(STATUS) as Status[]).map(k => (
            <button key={k} className="chip-f" aria-pressed={filter === k} onClick={() => setFilter(k)} disabled={!counts[k]}><i style={{ background: STATUS[k].c }} />{STATUS[k].t} <b>{arNum(counts[k] ?? 0)}</b></button>
          ))}
        </div>
        {view === 'cards' ? (
          <div className="seg-grid">
            {list.map(s => (
              <button key={s.id} className="seg-card" onClick={() => go(s.id)}>
                <div className="seg-thumb">{thumbOf(s) ? <img src={thumbOf(s)!} alt="" loading="lazy" /> : <span className="seg-num-big">{s.label ?? s.idx}</span>}
                  <span className="seg-dot" style={{ background: STATUS[s.status].c }} title={STATUS[s.status].t} /></div>
                {(() => { const mine = shots.filter(x => x.segment_id === s.id); const warn = mine.some(x => x.blocked || x.conflicts.some(n => conflicts.find(c => c.n === n && c.status === 'open'))); return warn ? <span className="seg-warn" title={mine.find(x => x.blocked)?.blocked ?? 'فيه تعارض مستني قرارك'}><Warning size={16} weight="fill" /></span> : null; })()}
                <div className="seg-body">
                  <div className="seg-top"><b>{s.label ?? String(s.idx).padStart(2, '0')}</b>{!!s.draft && <span className="pill sm ghost">مبدئي</span>}<span className="tc">{tc(s.start_s)}</span></div>
                  {s.group_label && <span className="seg-sec">{s.group_label}</span>}
                  {shots.some(x => x.segment_id === s.id) ? <div className="shot-chips">{shots.filter(x => x.segment_id === s.id).map(x => <span key={x.id} className={'shot-chip' + (x.blocked ? ' blocked' : '')} title={`${x.title} · ${SHOT[x.status].t}${x.blocked ? ' · ' + x.blocked : ''}`}><i style={{ background: SHOT[x.status].c }} />{x.code}</span>)}</div> : <p className="ltr">{s.lyric || '—'}</p>}
                </div>
              </button>
            ))}
          </div>
        ) : <Strip song={song} reload={load} open={go} />}
      </div>
      {sel && <SegmentSheet song={song} seg={sel} assets={assets} close={() => go()} reload={load} setAssets={setAssets} shots={shots.filter(x => x.segment_id === sel.id)} conflicts={conflicts} />}
    </div>
  );
}

function AudioMissing({ song, reload }: { song: Song; reload: () => void }) {
  const inp = useRef<HTMLInputElement>(null); const [busy, setBusy] = useState(false);
  const up = async (f?: File) => { if (!f) return; setBusy(true); const fd = new FormData(); fd.append('file', f, f.name); await fetch(`/api/songs/${song.id}/audio`, { method: 'POST', body: fd }); setBusy(false); toast('اتحلل — الـ BPM مستني اعتمادك'); reload(); };
  return (
    <div className="banner glass" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); up(e.dataTransfer.files[0]); }}>
      <Warning size={20} weight="fill" color="#ff9f0a" />
      <span>ملف الأغنية مش هنا. اسحب <b className="ltr">I_Am_The_World_v44_FINAL.flac</b> عشان الموجة والتشغيل وقياس الـ BPM.</span>
      <button className="gbtn" onClick={() => inp.current?.click()} disabled={busy}>{busy ? 'بيحلل…' : 'اختار الملف'}</button>
      <input ref={inp} type="file" accept="audio/*" hidden onChange={e => up(e.target.files?.[0])} />
    </div>
  );
}

function BpmCompare({ song, reload }: { song: Song; reload: () => void }) {
  const top = song.bpm_candidates[0]; const ref = 71.9;
  const diff = +(top.bpm - song.bpm).toFixed(2);
  const approve = async (bpm: number, offset?: number) => { await fetch(`/api/songs/${song.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bpm, beat_offset: offset }) }); await fetch(`/api/songs/${song.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bpm_approved: true }) }); toast(`الإيقاع اتعتمد: ${bpm}`); reload(); };
  return (
    <div className="bpm-compare glass">
      <div><span className="mute">{top.tracked ? 'متوسط القياس من الملف' : 'القياس من الملف'}</span><b className="big">{top.bpm}</b></div>
      <div><span className="mute">القياس السابق</span><b className="big">{song.bpm}</b></div>
      <div><span className="mute">الفرق</span><b className="big">{diff > 0 ? '+' : ''}{diff}</b><span className="mute">{Math.abs(diff) < 0.05 ? 'مطابق' : `≈ ${Math.abs(diff / ref * 100).toFixed(2)}٪`}</span></div>
      {!!song.tempo_local?.length && <TempoDrift local={song.tempo_local} dur={song.duration} />}
      <div className="bc-actions">
        <button className="gbtn primary" onClick={() => approve(top.bpm, top.offset)}>اعتمد {top.bpm}</button>
        <button className="gbtn" onClick={() => approve(song.bpm)}>خلّي {song.bpm}</button>
        {song.bpm_candidates.slice(1, 3).map(c => <button key={c.bpm} className="chip-f" onClick={() => approve(c.bpm, c.offset)}>{c.bpm} <b>{Math.round(c.conf * 100)}٪</b></button>)}
      </div>
    </div>
  );
}

function TempoDrift({ local, dur }: { local: { t: number; bpm: number }[]; dur: number }) {
  const lo = Math.min(...local.map(l => l.bpm)), hi = Math.max(...local.map(l => l.bpm)), span = Math.max(0.5, hi - lo);
  const m = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  return (
    <div className="tempo-drift">
      <span className="mute">الإيقاع مش ثابت: من {lo} لـ {hi}. البارات ماشية على الضربات الحقيقية.</span>
      <div className="td-bars" dir="ltr">{local.map(l => <i key={l.t} title={`${m(l.t)} · ${l.bpm}`} style={{ height: `${20 + 80 * (l.bpm - lo) / span}%`, width: `${100 * 16 / dur}%` }} />)}</div>
    </div>
  );
}

function SplitBar({ song, reload }: { song: Song; reload: () => void }) {
  const [sec, setSec] = useState(song.segment_seconds || 15);
  const bars = Math.max(1, Math.round(sec / song.bar));
  const apply = async () => { const r = await post(`/api/songs/${song.id}/split`, { seconds: sec }); if (r.ok) { toast('اتقسمت'); reload(); } else toast(`${r.data.what}. ${r.data.fix ?? ''}`); };
  return (
    <div className="splitbar">
      <span>مدة المقطع</span>
      <button className="gbtn icon" onClick={() => setSec(s => Math.max(song.bar, s - song.bar))} aria-label="أقل"><Minus size={16} /></button>
      <b>{arNum(Math.round(sec))} ث</b>
      <button className="gbtn icon" onClick={() => setSec(s => s + song.bar)} aria-label="أكتر"><Plus size={16} /></button>
      <span className="mute">≈ {arNum(bars)} بار = {(bars * song.bar).toFixed(1)} ث</span>
      <button className="gbtn" onClick={apply}>قسّم</button>
    </div>
  );
}

function Strip({ song, reload, open }: { song: Song; reload: () => void; open: (id: string) => void }) {
  const PX = 12, W = Math.ceil(song.duration * PX);
  const [sel, setSel] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; side: 'start' | 'end'; x0: number; t0: number; t: number } | null>(null);
  const colors = ['#2c2c2e', '#3a3a3c', '#48484a', '#636366'];
  const onUp = async () => {
    if (!drag) return; const d = drag; setDrag(null);
    const r = await post(`/api/segments/${d.id}/edge`, { side: d.side, t: d.t });
    if (!r.ok) toast(r.data.what); reload();
  };
  const selSeg = song.segments.find(s => s.id === sel);
  return (
    <div className="strip-wrap" onPointerMove={e => drag && setDrag({ ...drag, t: Math.max(0, drag.t0 + (drag.x0 - e.clientX) / PX * (document.documentElement.dir === 'rtl' ? 1 : -1)) })} onPointerUp={onUp}>
      <div className="strip-scroll"><div className="strip-inner" style={{ width: W }}>
        <div className="strip-wave">
          {song.peaks ? song.peaks.map((p, i) => <i key={i} style={{ left: i / song.peaks!.length * W, height: `${Math.max(4, p * 100)}%` }} />)
            : song.sections.map((s, i) => { const e = song.sections[i + 1]?.start ?? song.duration; return <span key={i} className="sec-band" style={{ left: s.start * PX, width: (e - s.start) * PX, background: colors[i % 4] }}>{s.name}</span>; })}
        </div>
        <div className="strip-segs">
          {song.segments.map(s => {
            const st = drag?.id === s.id && drag.side === 'start' ? drag.t : s.start_s, en = drag?.id === s.id && drag.side === 'end' ? drag.t : s.end_s;
            return (
              <div key={s.id} className={'strip-seg' + (sel === s.id ? ' sel' : '')} style={{ left: st * PX, width: Math.max(8, (en - st) * PX), borderColor: STATUS[s.status].c }}
                onClick={() => setSel(s.id)} onDoubleClick={() => open(s.id)}>
                <i className="edge s" onPointerDown={e => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); setDrag({ id: s.id, side: 'start', x0: e.clientX, t0: s.start_s, t: s.start_s }); }} />
                <b>{s.label ?? s.idx}</b><span className="ltr">{s.lyric}</span>
                <i className="edge e" onPointerDown={e => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); setDrag({ id: s.id, side: 'end', x0: e.clientX, t0: s.end_s, t: s.end_s }); }} />
              </div>
            );
          })}
        </div>
        <div className="strip-ruler">{Array.from({ length: Math.floor(song.duration / 10) + 1 }, (_, i) => <span key={i} style={{ left: i * 10 * PX }}>{Math.floor(i * 10 / 60)}:{String(i * 10 % 60).padStart(2, '0')}</span>)}</div>
      </div></div>
      <div className="strip-actions">
        {selSeg ? <>
          <b>{selSeg.label ?? selSeg.idx}</b><span className="mute">{tc(selSeg.start_s)} → {tc(selSeg.end_s)} · {arNum(Math.round((selSeg.end_s - selSeg.start_s) / song.bar))} بار</span>
          <button className="gbtn" onClick={async () => { const r = await post(`/api/segments/${selSeg.id}/split`); r.ok ? reload() : toast(r.data.what); }}><Scissors size={16} /> قسّم</button>
          <button className="gbtn" onClick={async () => { const r = await post(`/api/segments/${selSeg.id}/merge`); r.ok ? reload() : toast(r.data.what); }}><ArrowsMerge size={16} /> ادمج مع اللي بعده</button>
          <button className="gbtn" onClick={() => open(selSeg.id)}>افتح الورقة</button>
        </> : <span className="mute">اختار مقطع. اسحب حدوده وهتلزق على البار.</span>}
      </div>
    </div>
  );
}

function useSaved() { const [at, setAt] = useState<number>(0); return { saved: at, mark: () => setAt(Date.now()) }; }

function ConflictList({ conflicts }: { conflicts: Conflict[] }) {
  const [open, setOpen] = useState(false); const n = conflicts.filter(c => c.status === 'open').length;
  return (
    <div className="conflicts glass">
      <button className="conf-head" onClick={() => setOpen(o => !o)}>{n ? <Warning size={18} weight="fill" color="#ff9f0a" /> : <CheckCircle size={18} weight="fill" color="#30d158" />}<b>{n ? `${arNum(n)} تعارضات مستنية قرارك` : `${arNum(conflicts.length)} تعارضات اتقررت`}</b><span className="mute">{n ? 'المقاطع اللي فيها ⚠ مش هتتولّد قبلها' : 'وافقت على الاقتراحات زي ما هي'}</span><span className="sp" /><span className="mute">{open ? 'اخفي' : 'اعرض'}</span></button>
      {open && <ol>{conflicts.map(c => <li key={c.id}><b>{c.title}</b><p><span className="mute">{c.status === 'decided' ? 'اتقرر:' : 'الاقتراح:'}</span> {c.proposal}</p><div className="shot-chips">{c.shots.map(x => <span key={x} className="shot-chip">{x}</span>)}</div></li>)}</ol>}
    </div>
  );
}

function SegmentSheet({ song, seg, assets, close, reload, setAssets, shots = [], conflicts = [] }: { song: Song; seg: Seg; assets: Record<string, Asset>; close: () => void; reload: () => void; setAssets: (f: (a: Record<string, Asset>) => Record<string, Asset>) => void; shots?: Shot[]; conflicts?: Conflict[] }) {
  const [s, setS] = useState<Seg>(seg);
  const [plan, setPlan] = useState<'primary' | 'backup'>('primary');
  const [card, setCard] = useState<{ locked_text: string } | null>(null);
  const [picker, setPicker] = useState<'refs' | 'video' | null>(null);
  const [kit, setKit] = useState<{ kit: string; zip: string | null; files: number; audio: boolean; open: string } | null>(null);
  const [err, setErr] = useState<{ what: string; fix?: string } | null>(null);
  const [versions, setVersions] = useState<{ id: number; at: string }[]>([]);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const { saved, mark } = useSaved();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setS(seg); setKit(null); setErr(null); }, [seg.id]);
  useEffect(() => { fetch('/api/characters/donia').then(r => r.json()).then(setCard); }, []);
  const loadVersions = useCallback(() => fetch(`/api/segments/${seg.id}/versions`).then(r => r.json()).then(d => setVersions(d.versions)), [seg.id]);
  useEffect(() => { loadVersions(); }, [loadVersions, saved]);

  const save = (body: Partial<Seg>, now = false) => {
    setS(x => ({ ...x, ...body }));
    if (timer.current) clearTimeout(timer.current);
    const run = async () => { const r = await patch(seg.id, body); if (r.ok) { mark(); reload(); } else { toast(r.data.what); reload(); } };
    if (now) run(); else timer.current = setTimeout(run, 500);
  };
  const undo = async (version?: number) => { const r = await post(`/api/segments/${seg.id}/undo`, version ? { version } : {}); if (r.ok) { setS({ ...s, ...r.data }); reload(); loadVersions(); toast('رجعت'); } else toast(r.data.what); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !(e.target as HTMLElement).closest('textarea,input')) { e.preventDefault(); undo(); } if (e.key === 'Escape' && !picker) close(); };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  });

  const section = [...song.sections].reverse().find(x => x.start <= s.start_s + 0.01) ?? song.sections[0];
  const bars = Math.round((s.end_s - s.start_s) / song.bar);
  const backup = s.backup ?? {};
  const toolKey = plan === 'primary' ? s.tool : (backup.tool ?? 'stills');
  const partial = plan === 'primary' ? s.prompt_partial : (backup.prompt_partial ?? '');
  const direction = plan === 'primary' ? s.direction : (backup.direction ?? '');
  const mood = `Mood: ${section?.name ?? ''}${s.lyric ? ` — “${s.lyric.split(' / ')[0]}”` : ''}. Cut on the downbeat; ${bars} bars at ${song.bpm} BPM.`;
  const prompt = useMemo(() => [card?.locked_text, partial || direction, mood].filter(Boolean).join('\n\n'), [card, partial, direction, mood]);

  const edge = async (d: number) => { const r = await post(`/api/segments/${seg.id}/edge`, { side: 'end', t: s.end_s + d * song.bar }); if (r.ok) { setS(x => ({ ...x, end_s: r.data.t })); reload(); mark(); } else toast(r.data.what); };
  const play = () => {
    const a = audio.current; if (!a || !song.audio) { toast('ملف الأغنية مش موجود'); return; }
    if (playing) { a.pause(); setPlaying(false); return; }
    a.currentTime = s.start_s; a.play(); setPlaying(true);
    const stop = () => { if (a.currentTime >= s.end_s) { a.pause(); setPlaying(false); a.removeEventListener('timeupdate', stop); } }; a.addEventListener('timeupdate', stop);
  };
  const prepare = async () => {
    setErr(null); setKit(null);
    const r = await post(`/api/segments/${seg.id}/prepare`, { prompt, which: plan });
    if (r.ok) { setKit(r.data); setS(x => ({ ...x, status: x.status === 'idea' || x.status === 'ready' ? 'generating' : x.status })); reload(); mark(); } else setErr(r.data);
  };
  const setPlan_ = (body: { tool?: string; prompt_partial?: string }) => plan === 'primary' ? save(body) : save({ backup: { ...backup, ...body } });
  const move = (i: number, d: number) => { const r = [...s.refs]; const j = i + d; if (j < 0 || j >= r.length) return; [r[i], r[j]] = [r[j], r[i]]; save({ refs: r }, true); };
  const [dragI, setDragI] = useState<number | null>(null); const [overI, setOverI] = useState<number | null>(null);
  const dropAt = (to: number) => { if (dragI == null || dragI === to) { setDragI(null); setOverI(null); return; } const r = [...s.refs]; const [x] = r.splice(dragI, 1); r.splice(to, 0, x); setDragI(null); setOverI(null); save({ refs: r }, true); };
  const peaks = song.peaks ? song.peaks.slice(Math.floor(s.start_s / song.duration * song.peaks.length), Math.ceil(s.end_s / song.duration * song.peaks.length)) : null;
  const video = s.video_asset_id ? assets[s.video_asset_id] : null;

  return (
    <div className="seg-sheet-wrap" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <section className="seg-sheet glass-strong" role="dialog" aria-label={`مقطع ${s.label ?? s.idx}`}>
        <div className="grab" />
        <header className="ss-head">
          <button className="gbtn icon" onClick={close} aria-label="اقفل"><X size={20} /></button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ss-title"><h2>مقطع {s.label ?? s.idx}</h2>{s.group_label && <span className="pill">{s.group_label}</span>}{!!s.draft && <span className="pill ghost">مبدئي · v7</span>}<span className="tc">{tc(s.start_s)} → {tc(s.end_s)}</span></div>
            <p className="ss-lyric ltr">{s.lyric || '—'}</p>
          </div>
          <span className="saved mute">{saved ? 'اتحفظ' : ''}</span>
        </header>

        <div className="status-row">
          {(Object.keys(STATUS) as Status[]).map(k => (
            <button key={k} className="chip-f" aria-pressed={s.status === k} onClick={() => k === 'done' && !s.video_asset_id ? toast('حط الفيديو الأول') : save({ status: k }, true)}><i style={{ background: STATUS[k].c }} />{STATUS[k].t}</button>
          ))}
        </div>

        <div className="ss-wave">
          <button className="gbtn icon play" onClick={play} aria-label="شغّل المقطع" disabled={!song.audio}>{playing ? <Pause size={20} weight="fill" /> : <Play size={20} weight="fill" />}</button>
          <div className="mini-wave">{peaks ? peaks.map((p, i) => <i key={i} style={{ height: `${Math.max(6, p * 100)}%` }} />) : <span className="no-audio">مفيش ملف صوت لسه</span>}</div>
          <div className="bars-ctl">
            <button className="gbtn icon" onClick={() => edge(-1)} aria-label="بار أقل"><Minus size={16} /></button>
            <span><b>{arNum(bars)}</b> بار · {(s.end_s - s.start_s).toFixed(1)} ث</span>
            <button className="gbtn icon" onClick={() => edge(1)} aria-label="بار أكتر"><Plus size={16} /></button>
          </div>
          {song.audio && <audio ref={audio} src={song.audio} preload="none" />}
        </div>

        {shots.length > 0 && <>
          <h3 className="ss-h">اللقطات <span className="mute">من تايم لاين v44</span></h3>
          <div className="shot-list">
            {shots.map(x => { const cf = x.conflicts.map(n => conflicts.find(c => c.n === n)).filter(c => c && c.status === 'open') as Conflict[]; return (
              <div key={x.id} className="shot-row">
                <span className="shot-code">{x.code}</span>
                <div className="shot-main"><b>{x.title}</b><span className="mute tc">{tc(x.start_s)} → {tc(x.end_s)}</span>{x.source && <span className="mute src">{x.source}</span>}
                  {cf.map(c => <span key={c.id} className="shot-conf"><Warning size={14} weight="fill" /> تعارض #{c.n}: {c.title}</span>)}
                  {x.note && <span className="shot-q">{x.note}</span>}
                  {x.blocked && <span className="shot-conf"><Warning size={14} weight="fill" /> {x.blocked}</span>}
                  {x.answers.length > 0 && <ul className="shot-answers">{x.answers.map(a => <li key={a}>{a}</li>)}</ul>}
                  {x.questions.length > 0 && <span className="shot-q">محتاج قرارك: {x.questions.join(' · ')}</span>}</div>
                <span className="shot-st" style={{ color: SHOT[x.status].c }}><i style={{ background: SHOT[x.status].c }} />{SHOT[x.status].t}{x.kind ? ` (${x.kind})` : ''}</span>
              </div>
            ); })}
          </div>
        </>}

        <h3 className="ss-h">الصور <span className="mute">الترتيب = ترتيب الإرسال · اسحب لترتيبها</span></h3>
        <div className="slots">
          {s.refs.map((id, i) => { const a = assets[id]; return (
            <figure key={id + i} className={'slot' + (a?.no_generation ? ' blocked' : '') + (dragI === i ? ' dragging' : '') + (overI === i && dragI !== i ? ' over' : '')}
              draggable onDragStart={e => { setDragI(i); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { setDragI(null); setOverI(null); }}
              onDragOver={e => { e.preventDefault(); setOverI(i); }} onDrop={e => { e.preventDefault(); dropAt(i); }}>
              {a?.thumb && <img src={a.thumb} alt="" />}
              <span className="slot-n">{arNum(i + 1)}</span>
              {a?.no_generation ? <span className="slot-warn"><Warning size={14} weight="fill" /> ممنوع كمرجع</span> : null}
              <div className="slot-ctl">
                <button onClick={() => move(i, 1)} aria-label="بعدها"><ArrowLeft size={14} /></button>
                <button onClick={() => save({ refs: s.refs.filter((_, j) => j !== i) }, true)} aria-label="شيل"><X size={14} /></button>
                <button onClick={() => move(i, -1)} aria-label="قبلها"><ArrowRight size={14} /></button>
              </div>
              <figcaption>{a?.label ?? ''}</figcaption>
            </figure>
          ); })}
          <button className="slot add" onClick={() => setPicker('refs')}><Plus size={26} /><span>من المكتبة</span></button>
        </div>

        <div className="plan-tabs seg">
          <button aria-pressed={plan === 'primary'} onClick={() => setPlan('primary')}>الأساسية</button>
          <button aria-pressed={plan === 'backup'} onClick={() => setPlan('backup')}>البديلة</button>
        </div>
        <div className="tools">
          {Object.entries(song.tools).map(([k, t]) => (
            <button key={k} className="tool" aria-pressed={toolKey === k} onClick={() => setPlan_({ tool: k })}>
              <b>{t.name}</b><span>{t.via}</span><em className={t.mode}>{t.mode === 'mcp' ? 'MCP' : 'جسر'}</em>
            </button>
          ))}
        </div>

        <div className="prompt-win">
          <div className="pw-locked"><span className="pw-k">مقفول · من بطاقة دنيا</span>{card?.locked_text}</div>
          <textarea className="pw-partial" dir="auto" value={partial} placeholder={direction || 'وصف المقطع'} onChange={e => setPlan_({ prompt_partial: e.target.value })} rows={4} />
          {!partial && direction && <button className="gbtn sm" onClick={() => setPlan_({ prompt_partial: direction })}>{s.draft ? 'استخدم وصف v7 (مبدئي)' : 'استخدم وصف الخريطة'}</button>}
          <div className="pw-mood"><span className="pw-k">الإحساس · بيتضاف لوحده</span>{mood}</div>
        </div>

        <div className="prepare-row">
          <button className="gbtn primary big" onClick={prepare}>جهّز للتوليد</button>
          <button className="gbtn" onClick={() => { navigator.clipboard?.writeText(prompt); toast('اتنسخ البرومبت'); }}><Copy size={16} /> انسخ البرومبت</button>
        </div>
        {err && <div className="note-err"><Warning size={18} weight="fill" /><div><b>{err.what}</b>{err.fix && <p>{err.fix}</p>}</div></div>}
        {kit && (
          <div className="kit glass">
            <b className="ltr">{kit.kit}</b>
            <span className="mute">{arNum(kit.files)} صور مترقّمة · البرومبت{kit.audio ? ' · مقطع الصوت' : ''}</span>
            <div className="kit-actions">
              {kit.zip && <a className="gbtn" href={kit.zip}><DownloadSimple size={16} /> الكيت</a>}
              <button className="gbtn" onClick={() => { navigator.clipboard?.writeText(prompt); toast('اتنسخ'); }}><Copy size={16} /> البرومبت</button>
              {kit.open && <a className="gbtn" href={kit.open} target="_blank" rel="noreferrer"><ArrowSquareOut size={16} /> افتح الموقع</a>}
            </div>
            <span className="mute" style={{ fontSize: 13 }}>الفيديو اللي اسمه فيه <b className="ltr">{kit.kit.split('_').pop()}</b> وينزل في Inbox هيتربط هنا لوحده.</span>
          </div>
        )}

        <h3 className="ss-h">الفيديو</h3>
        <div className="video-slot" onDragOver={e => e.preventDefault()} onDrop={async e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (!f) return; const r = await api.upload([f]); const id = r.imported?.[0]?.id; if (id) { const d = await api.assets('all'); setAssets(() => Object.fromEntries(d.items.map(a => [a.id, a]))); save({ video_asset_id: id }, true); } }}>
          {video?.src ? <video src={video.src} poster={video.thumb ?? undefined} controls playsInline /> : <button className="vs-empty" onClick={() => setPicker('video')}><FilmStrip size={30} /><span>اسحب الفيديو هنا أو اختار من المكتبة</span></button>}
        </div>
        {video && s.status !== 'done' && s.status !== 'editing' && <button className="gbtn done big" onClick={() => save({ status: 'done' }, true)}><CheckCircle size={20} weight="fill" /> تمّت</button>}

        <h3 className="ss-h">ملاحظات</h3>
        <textarea className="notes" value={s.notes} onChange={e => save({ notes: e.target.value })} rows={3} placeholder="أي حاجة تفتكرها للمقطع ده" />

        <h3 className="ss-h">النسخ <span className="mute">⌘Z يرجّع آخر تعديل</span></h3>
        <div className="versions">
          {versions.length ? versions.slice(0, 8).map(v => <button key={v.id} className="chip-f" onClick={() => undo(v.id)}><ArrowCounterClockwise size={14} />{new Date(v.at + 'Z').toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</button>) : <span className="mute">لسه مفيش تعديلات</span>}
        </div>
      </section>
      {picker && <Picker kind={picker} assets={assets} chosen={picker === 'refs' ? s.refs : []} onClose={() => setPicker(null)}
        onPick={ids => { if (picker === 'refs') save({ refs: [...s.refs, ...ids.filter(i => !s.refs.includes(i))] }, true); else save({ video_asset_id: ids[0] }, true); setPicker(null); }} />}
    </div>
  );
}

function Picker({ kind, assets, chosen, onPick, onClose }: { kind: 'refs' | 'video'; assets: Record<string, Asset>; chosen: string[]; onPick: (ids: string[]) => void; onClose: () => void }) {
  const [sel, setSel] = useState<string[]>([]);
  const list = Object.values(assets).filter(a => kind === 'video' ? a.kind === 'video' : a.kind === 'image').sort((a, b) => Number(b.approved) - Number(a.approved));
  return (
    <div className="picker-wrap" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="picker glass-strong">
        <header><b>{kind === 'refs' ? 'اختار الصور بالترتيب' : 'اختار الفيديو'}</b><span className="sp" /><button className="gbtn" onClick={onClose}>إلغاء</button><button className="gbtn primary" disabled={!sel.length} onClick={() => onPick(sel)}>ضيف {sel.length ? arNum(sel.length) : ''}</button></header>
        <div className="picker-grid">
          {list.length ? list.map(a => { const n = sel.indexOf(a.id); const off = kind === 'refs' && (!!a.no_generation || chosen.includes(a.id)); return (
            <button key={a.id} className={'tile loaded' + (n >= 0 ? ' sel' : '')} disabled={off} title={a.no_generation ? 'ممنوع كمرجع توليد' : a.label ?? ''}
              onClick={() => setSel(x => kind === 'video' ? [a.id] : x.includes(a.id) ? x.filter(i => i !== a.id) : [...x, a.id])}>
              {a.thumb && <img src={a.thumb} alt="" />}
              {n >= 0 && <span className="pick-n">{arNum(n + 1)}</span>}
              {a.no_generation ? <span className="st"><Warning size={18} weight="fill" color="#ff9f0a" /></span> : a.approved ? <span className="st"><CheckCircle size={18} weight="fill" color="#30d158" /></span> : null}
            </button>
          ); }) : <p className="mute" style={{ padding: 20 }}>{kind === 'video' ? 'مفيش فيديوهات في المكتبة لسه.' : 'مفيش صور.'}</p>}
        </div>
      </div>
    </div>
  );
}

export function Montage({ songId }: { songId: string }) {
  const [song, setSong] = useState<Song | null>(null);
  const [assets, setAssets] = useState<Record<string, Asset>>({});
  const [t, setT] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => { fetch(`/api/songs/${songId}`).then(r => r.json()).then(setSong); api.assets('all').then(d => setAssets(Object.fromEntries(d.items.map(a => [a.id, a])))); }, [songId]);
  if (!song) return <div className="work" />;
  const done = song.segments.filter(s => (s.status === 'done' || s.status === 'editing') && s.video_asset_id);
  const cur = done.find(s => t >= s.start_s && t < s.end_s);
  const v = cur && assets[cur.video_asset_id!];
  return (
    <div className="work"><div className="scroll">
      <div className="title-block"><h1>المونتاج</h1><p className="ltr" style={{ textAlign: 'right' }}>{song.title} · {arNum(done.length)} من {arNum(song.segments.length)}</p></div>
      <div className="montage">
        <div className="m-screen">{v?.src ? <video key={v.id} src={v.src} muted autoPlay playsInline /> : <span className="mute">{done.length ? 'مفيش مقطع هنا' : 'لسه مفيش مقاطع تمّت'}</span>}</div>
        {song.audio && <audio ref={audio} src={song.audio} controls onTimeUpdate={e => setT(e.currentTarget.currentTime)} style={{ width: '100%' }} />}
        <div className="m-line">{song.segments.map(s => <i key={s.id} style={{ left: `${s.start_s / song.duration * 100}%`, width: `${(s.end_s - s.start_s) / song.duration * 100}%`, background: STATUS[s.status].c, opacity: s.video_asset_id ? 1 : .35 }} />)}<b style={{ left: `${t / song.duration * 100}%` }} /></div>
        <a className="gbtn primary big" href={`/api/songs/${song.id}/fcpxml`} download>صدّر FCPXML لـ Final Cut</a>
      </div>
    </div></div>
  );
}
