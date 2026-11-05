// لوحة المقاطع: cards like the library, a strip view on the waveform, status filters, and the segment sheet.
// No save button: every change is saved as it happens, with versions and undo (⌘Z).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, Plus, Minus, X, ArrowRight, ArrowLeft, Scissors, ArrowsMerge, SquaresFour, Waveform, Copy, DownloadSimple, ArrowSquareOut, CheckCircle, ArrowCounterClockwise, FilmStrip, Warning, CaretRight, CaretDown, FilmSlate, DotsThree, Images as ImagesIcon, TextAa, NotePencil, At } from '@phosphor-icons/react';
import { api, type Asset } from './api.ts';
import { toast, PageHead, Card, Row } from './ui.tsx';
import { useRefs, useResolution, PromptBox, RefsList } from './Refs.tsx';
import { useQc, QcCard, QC_LABEL } from './Qc.tsx';
import { ProgressRing, arNum } from './Songs.tsx';

type Seg = { id: string; idx: number; start_s: number; end_s: number; label: string | null; group_label: string | null; lyric: string; status: Status; direction: string; prompt_partial: string;
  tool: string; backup: { tool?: string; direction?: string; prompt_partial?: string }; refs: string[]; video_asset_id: string | null; kit_code: string | null; notes: string; updated_at: string; draft: number };
type Status = 'idea' | 'ready' | 'generating' | 'done' | 'editing';
type Tool = { name: string; via: string; mode: 'mcp' | 'bridge'; url: string };
type Song = { id: string; title: string; bpm: number; bpm_approved: number; beat_offset: number; bar: number; duration: number; sections: { name: string; start: number }[]; peaks: number[] | null;
  poster: string | null; audio: string | null; segment_seconds: number; segments: Seg[]; tools: Record<string, Tool>; bpm_candidates: { bpm: number; conf: number; offset?: number; tracked?: boolean }[]; plan_note: string | null; master_missing?: boolean;
  tempo_local?: { t: number; bpm: number }[]; grid_measured?: boolean };
type Shot = { id: string; code: string; prompt: string | null; title: string; start_s: number; end_s: number; status: 'approved' | 'candidate' | 'redo' | 'pending'; kind: string | null; note: string | null; source: string; segment_id: string; conflicts: number[]; questions: string[]; blocked: string | null; answers: string[] };
type Conflict = { id: string; n: number; title: string; proposal: string; shots: string[]; status: string; decision: string | null };
// dots: green = ready or confirmed, orange = waiting, grey = idea
const G = 'var(--ok)', O = 'var(--warn)', N = '#8E8E93';
export const SHOT: Record<Shot['status'], { t: string; c: string }> = { approved: { t: 'معتمد', c: G }, candidate: { t: 'مرشّح', c: O }, redo: { t: 'قيد إعادة', c: O }, pending: { t: 'لسه', c: N } };

export const STATUS: Record<Status, { t: string; c: string }> = {
  idea: { t: 'فكرة', c: N }, ready: { t: 'جاهز للتوليد', c: G }, generating: { t: 'بيتولّد', c: O }, done: { t: 'تمّت ✓', c: G }, editing: { t: 'في المونتاج', c: G }
};
const tc = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const patch = (id: string, body: Partial<Seg>) => fetch(`/api/segments/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ ok: r.ok, data: await r.json() }));
const post = (url: string, body?: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then(async r => ({ ok: r.ok, data: await r.json() }));

/** Short section name for one-line captions: drops quotes, brackets, timecodes and counts. */
export const secShort = (name?: string | null) => {
  const t = (name ?? '').replace(/"[^"]*"/g, ' ').replace(/«[^»]*»/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/[×+]\S*/g, ' ').replace(/\d+:\d+(\.\d+)?/g, ' ').replace(/\s+/g, ' ').trim();
  return t.split(' ').slice(0, 2).join(' ') || 'مقطع';
};

export function Board({ songId, segId, go }: { songId: string; segId?: string; go: (seg?: string) => void }) {
  const [song, setSong] = useState<Song | null>(null);
  const [view, setView] = useState<'cards' | 'strip'>('cards');
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [assets, setAssets] = useState<Record<string, Asset>>({});
  const [shots, setShots] = useState<Shot[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const load = useCallback(() => { fetch(`/api/songs/${songId}`).then(r => r.json()).then(setSong); fetch(`/api/songs/${songId}/shots`).then(r => r.json()).then(d => { setShots(d.shots); setConflicts(d.conflicts); }); }, [songId]);
  useEffect(() => { load(); api.assets('all').then(d => setAssets(Object.fromEntries(d.items.map(a => [a.id, a])))); }, [load]);
  // real pictures for segments that have none yet: approved images of the character, never an empty grey box
  const fallback = useMemo(() => { const all = Object.values(assets).filter(a => a.kind === 'image' && !a.no_generation && a.thumb); const looks = all.filter(a => a.role === 'look'); return (looks.length ? looks : all.filter(a => a.approved)).map(a => a.thumb!); }, [assets]);
  if (!song) return <div className="work" />;

  const segs = song.segments, done = segs.filter(s => s.status === 'done' || s.status === 'editing').length;
  const resume = segs.find(s => s.status !== 'done' && s.status !== 'editing');
  const counts = segs.reduce((m, s) => ({ ...m, [s.status]: (m[s.status] ?? 0) + 1 }), {} as Record<string, number>);
  const list = filter === 'all' ? segs : segs.filter(s => s.status === filter);
  const sel = segId ? segs.find(s => s.id === segId) : undefined;
  const thumbOf = (s: Seg) => (s.video_asset_id && assets[s.video_asset_id]?.thumb) || (s.refs[0] && assets[s.refs[0]]?.thumb) || null;
  const picOf = (s: Seg) => thumbOf(s) ?? (fallback.length ? fallback[(s.idx - 1) % fallback.length] : song.poster);
  const warnOf = (s: Seg) => shots.filter(x => x.segment_id === s.id).some(x => x.blocked || x.conflicts.some(n => conflicts.find(c => c.n === n && c.status === 'open')));

  return (
    <div className="work">
      <div className="topbar">
        <span className="sp" />
        <MoreMenu items={[
          { icon: view === 'cards' ? Waveform : SquaresFour, label: view === 'cards' ? 'عرض الشريط' : 'عرض الكروت', run: () => setView(v => v === 'cards' ? 'strip' : 'cards') },
          { icon: FilmStrip, label: 'المونتاج', href: `#/montage/${song.id}` },
          { icon: CaretRight, label: 'الرئيسية', href: '#/home' }
        ]} />
      </div>
      <div className="scroll"><div className="stack">
        <PageHead title={song.title} line={<><span className="ltr bpm-small">{song.bpm} BPM</span>{song.bpm_approved ? '' : ' · مستني اعتمادك'}</>} />
        <div className="progress" role="progressbar" aria-label={`${done} من ${segs.length}`} aria-valuenow={done} aria-valuemax={segs.length}><i style={{ width: `${segs.length ? done / segs.length * 100 : 0}%` }} /></div>
        {resume && (
          <Card wide img={picOf(resume)} imgClass={thumbOf(resume) ? '' : 'temp'} title={resume.label ?? `مقطع ${arNum(resume.idx)}`} ltrTitle line={`${secShort(resume.group_label)} · ${STATUS[resume.status].t}`}
            action={<button className="gbtn primary" onClick={() => go(resume.id)}>كمّل</button>} />
        )}
        {!song.audio && <AudioMissing song={song} reload={load} />}
        {song.audio && !song.bpm_approved && song.bpm_candidates.length > 0 && <BpmCompare song={song} reload={load} />}
        <NotesCard song={song} conflicts={conflicts} hasShots={shots.length > 0} />
        {view === 'cards' ? <>
          <div className="section-h"><h2>المقاطع</h2><span>{arNum(segs.length)}</span></div>
          {Object.keys(counts).length > 1 && <div className="chips-row flush">
            <button className="chip-f" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>الكل</button>
            {(Object.keys(STATUS) as Status[]).filter(k => counts[k]).map(k => <button key={k} className="chip-f" aria-pressed={filter === k} onClick={() => setFilter(k)}><i className="dot" style={{ background: STATUS[k].c }} />{STATUS[k].t}</button>)}
          </div>}
          <div className="seg-grid">
            {list.map(s => (
              <button key={s.id} className="seg-tile" onClick={() => go(s.id)}>
                <span className="seg-pic"><img src={picOf(s) ?? ''} alt="" loading="lazy" className={thumbOf(s) ? '' : 'stand-in'} />
                  <i className="seg-dot" style={{ background: STATUS[s.status].c }} title={STATUS[s.status].t} />
                  {warnOf(s) && <span className="seg-warn"><Warning size={22} weight="fill" /></span>}</span>
                <b className="ltr">{s.label ?? arNum(s.idx)}</b>
                <span className="seg-line">{secShort(s.group_label)} · {STATUS[s.status].t}</span>
              </button>
            ))}
          </div>
        </> : <><SplitBar song={song} reload={load} /><Strip song={song} reload={load} open={go} /></>}
      </div></div>
      {sel && <SegmentSheet song={song} seg={sel} assets={assets} close={() => go()} reload={load} setAssets={setAssets} shots={shots.filter(x => x.segment_id === sel.id)} conflicts={conflicts} />}
    </div>
  );
}

function NotesCard({ song, conflicts, hasShots }: { song: Song; conflicts: Conflict[]; hasShots: boolean }) {
  const [open, setOpen] = useState(false);
  const openN = conflicts.filter(c => c.status === 'open').length;
  const line = openN ? `${arNum(openN)} تعارضات مستنية قرارك` : song.master_missing ? 'الماستر ناقص' : 'كله تمام';
  return (
    <Card title="ملاحظات" line={line} onClick={() => setOpen(o => !o)} action={<button className="gbtn icon soft" aria-label={open ? 'اخفي' : 'اعرض'} aria-expanded={open} onClick={() => setOpen(o => !o)}><CaretDown size={22} style={{ transform: open ? 'rotate(180deg)' : undefined }} /></button>}>
      {open && <div className="card-more" onClick={e => e.stopPropagation()}>
        {song.master_missing && <p><Warning size={20} weight="fill" color="var(--warn)" /> ملف الماستر (FLAC) لسه ناقص للتصدير النهائي.</p>}
        {song.plan_note && <p>{hasShots ? 'الخطة: ' : ''}{song.plan_note}</p>}
        {conflicts.length > 0 && <ConflictList conflicts={conflicts} />}
      </div>}
    </Card>
  );
}

function AudioMissing({ song, reload }: { song: Song; reload: () => void }) {
  const inp = useRef<HTMLInputElement>(null); const [busy, setBusy] = useState(false);
  const up = async (f?: File) => { if (!f) return; setBusy(true); const fd = new FormData(); fd.append('file', f, f.name); await fetch(`/api/songs/${song.id}/audio`, { method: 'POST', body: fd }); setBusy(false); toast('الإيقاع مستني اعتمادك'); reload(); };
  return (
    <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); up(e.dataTransfer.files[0]); }}>
      <Card title="ملف الأغنية" line="ناقص · اسحبه هنا" action={<><button className="gbtn secondary" onClick={() => inp.current?.click()} disabled={busy}>{busy ? 'بيحلل…' : 'اختار'}</button><input ref={inp} type="file" accept="audio/*" hidden onChange={e => up(e.target.files?.[0])} /></>} />
    </div>
  );
}

function BpmCompare({ song, reload }: { song: Song; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const top = song.bpm_candidates[0];
  const approve = async (bpm: number, offset?: number) => { await fetch(`/api/songs/${song.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bpm, beat_offset: offset }) }); await fetch(`/api/songs/${song.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bpm_approved: true }) }); toast('الإيقاع اتعتمد'); reload(); };
  const n = (x: number) => x.toLocaleString('ar-EG', { maximumFractionDigits: 2 });
  return (
    <Card title="الإيقاع" line={`${n(top.bpm)} بدل ${n(song.bpm)}`} onClick={() => setOpen(o => !o)}
      action={<button className="gbtn secondary" onClick={() => approve(top.bpm, top.offset)}>اعتمد</button>}>
      {open && <div className="card-more" onClick={e => e.stopPropagation()}>
        {!!song.tempo_local?.length && <TempoDrift local={song.tempo_local} dur={song.duration} />}
        <p>ده متوسط الأغنية كلها. الأغنية بتسرّع في النص، والبارات ماشية على الضربات الحقيقية.</p>
        <div className="row-btns">
          <button className="gbtn soft" onClick={() => approve(song.bpm)}>خلّي {n(song.bpm)}</button>
          {song.bpm_candidates.slice(1, 3).map(c => <button key={c.bpm} className="gbtn soft" onClick={() => approve(c.bpm, c.offset)}>{n(c.bpm)}</button>)}
        </div>
      </div>}
    </Card>
  );
}

function TempoDrift({ local, dur }: { local: { t: number; bpm: number }[]; dur: number }) {
  const lo = Math.min(...local.map(l => l.bpm)), hi = Math.max(...local.map(l => l.bpm)), span = Math.max(0.5, hi - lo);
  const m = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  return (
    <div className="tempo-drift">
      <span className="mute">من {lo.toLocaleString('ar-EG')} لـ {hi.toLocaleString('ar-EG')}</span>
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
      <span>قسّم كل</span>
      <button className="gbtn icon" onClick={() => setSec(s => Math.max(song.bar, s - song.bar))} aria-label="أقل"><Minus size={16} /></button>
      <b>{arNum(Math.round(sec))} ث</b>
      <button className="gbtn icon" onClick={() => setSec(s => s + song.bar)} aria-label="أكتر"><Plus size={16} /></button>
      <span className="mute">{arNum(bars)} بار</span>
      <button className="gbtn secondary" onClick={apply}>قسّم</button>
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
          <b className="ltr">{selSeg.label ?? selSeg.idx}</b><span className="mute">{arNum(Math.round((selSeg.end_s - selSeg.start_s) / song.bar))} بار</span>
          <button className="gbtn" onClick={async () => { const r = await post(`/api/segments/${selSeg.id}/split`); r.ok ? reload() : toast(r.data.what); }}><Scissors size={16} /> قسّم</button>
          <button className="gbtn" onClick={async () => { const r = await post(`/api/segments/${selSeg.id}/merge`); r.ok ? reload() : toast(r.data.what); }}><ArrowsMerge size={20} /> ادمج</button>
          <button className="gbtn" onClick={() => open(selSeg.id)}>افتح</button>
        </> : <span className="mute">اختار مقطع واسحب حدوده</span>}
      </div>
    </div>
  );
}

function useSaved() { const [at, setAt] = useState<number>(0); return { saved: at, mark: () => setAt(Date.now()) }; }

function ConflictList({ conflicts }: { conflicts: Conflict[] }) {
  const [open, setOpen] = useState(false); const n = conflicts.filter(c => c.status === 'open').length;
  return (
    <div className="conflicts" onClick={e => e.stopPropagation()}>
      <button className="conf-head" onClick={() => setOpen(o => !o)}>{n ? <Warning size={18} weight="fill" color="var(--warn)" /> : <CheckCircle size={18} weight="fill" color="var(--ok)" />}<b>{n ? `${arNum(n)} تعارضات مستنية قرارك` : `${arNum(conflicts.length)} تعارضات اتقررت`}</b><span className="sp" /><CaretDown size={20} style={{ transform: open ? 'rotate(180deg)' : undefined }} /></button>
      {open && <ol>{conflicts.map(c => <li key={c.id}><b>{c.title}</b><p><span className="mute">{c.status === 'decided' ? 'اتقرر:' : 'الاقتراح:'}</span> {c.proposal}</p><div className="shot-chips">{c.shots.map(x => <span key={x} className="shot-chip">{x}</span>)}</div></li>)}</ol>}
    </div>
  );
}

function SegmentSheet({ song, seg, assets, close, reload, setAssets, shots = [], conflicts = [] }: { song: Song; seg: Seg; assets: Record<string, Asset>; close: () => void; reload: () => void; setAssets: (f: (a: Record<string, Asset>) => Record<string, Asset>) => void; shots?: Shot[]; conflicts?: Conflict[] }) {
  const [s, setS] = useState<Seg>(seg);
  const [plan, setPlan] = useState<'primary' | 'backup'>('primary');
  const [picker, setPicker] = useState<'refs' | 'video' | null>(null);
  const [kit, setKit] = useState<{ kit: string; zip: string | null; files: number; audio: boolean; open: string } | null>(null);
  const [err, setErr] = useState<{ what: string; fix?: string; confirm?: string } | null>(null);
  const [versions, setVersions] = useState<{ id: number; at: string }[]>([]);
  const [playing, setPlaying] = useState(false);
  const [panel, setPanel] = useState<null | 'shots' | 'refs' | 'prompt' | 'video' | 'notes'>(null);
  const [inspo, setInspo] = useState<{ id: string; label: string; thumb: string | null; link: string; watch: string | null; source: string; line: string | null }[]>([]);
  useEffect(() => { if (panel === 'refs') fetch(`/api/segments/${seg.id}/inspiration`).then(r => r.json()).then(d => setInspo(d.items)); }, [panel, seg.id]);
  const audio = useRef<HTMLAudioElement>(null);
  const { saved, mark } = useSaved();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setS(seg); setKit(null); setErr(null); setPanel(null); }, [seg.id]);
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
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !(e.target as HTMLElement).closest('textarea,input')) { e.preventDefault(); undo(); } if (e.key === 'Escape' && !picker && !e.defaultPrevented) { if (panel) setPanel(null); else close(); } };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  });

  const section = [...song.sections].reverse().find(x => x.start <= s.start_s + 0.01) ?? song.sections[0];
  const bars = Math.round((s.end_s - s.start_s) / song.bar);
  const backup = s.backup ?? {};
  const toolKey = plan === 'primary' ? s.tool : (backup.tool ?? 'stills');
  const partial = plan === 'primary' ? s.prompt_partial : (backup.prompt_partial ?? '');
  const direction = plan === 'primary' ? s.direction : (backup.direction ?? '');
  const mood = `Mood: ${section?.name ?? ''}${s.lyric ? ` — “${s.lyric.split(' / ')[0]}”` : ''}. Cut on the downbeat; ${bars} bars at ${song.bpm} BPM.`;
  // your words (with @handles) + the mood line; constants' fixed text is added server-side from the @ references
  const prompt = useMemo(() => [partial || direction, mood].filter(Boolean).join('\n\n'), [partial, direction, mood]);
  const allRefs = useRefs();
  const res = useResolution(prompt, toolKey);
  const firstPic = res?.refs.flatMap(r => r.images)[0]?.thumb ?? (s.refs[0] ? assets[s.refs[0]]?.thumb : null);

  const edge = async (d: number) => { const r = await post(`/api/segments/${seg.id}/edge`, { side: 'end', t: s.end_s + d * song.bar }); if (r.ok) { setS(x => ({ ...x, end_s: r.data.t })); reload(); mark(); } else toast(r.data.what); };
  const play = () => {
    const a = audio.current; if (!a || !song.audio) { toast('ملف الأغنية مش موجود'); return; }
    if (playing) { a.pause(); setPlaying(false); return; }
    a.currentTime = s.start_s; a.play(); setPlaying(true);
    const stop = () => { if (a.currentTime >= s.end_s) { a.pause(); setPlaying(false); a.removeEventListener('timeupdate', stop); } }; a.addEventListener('timeupdate', stop);
  };
  const prepare = async (confirm_no_donia = false) => {
    setErr(null); setKit(null);
    const r = await post(`/api/segments/${seg.id}/prepare`, { prompt, which: plan, confirm_no_donia });
    if (r.ok) { setKit(r.data); setS(x => ({ ...x, status: x.status === 'idea' || x.status === 'ready' ? 'generating' : x.status })); reload(); mark(); } else setErr(r.data);
  };
  const setPlan_ = (body: { tool?: string; prompt_partial?: string }) => plan === 'primary' ? save(body) : save({ backup: { ...backup, ...body } });
  const move = (i: number, d: number) => { const r = [...s.refs]; const j = i + d; if (j < 0 || j >= r.length) return; [r[i], r[j]] = [r[j], r[i]]; save({ refs: r }, true); };
  const [dragI, setDragI] = useState<number | null>(null); const [overI, setOverI] = useState<number | null>(null);
  const dropAt = (to: number) => { if (dragI == null || dragI === to) { setDragI(null); setOverI(null); return; } const r = [...s.refs]; const [x] = r.splice(dragI, 1); r.splice(to, 0, x); setDragI(null); setOverI(null); save({ refs: r }, true); };
  const peaks = song.peaks ? song.peaks.slice(Math.floor(s.start_s / song.duration * song.peaks.length), Math.ceil(s.end_s / song.duration * song.peaks.length)) : null;
  const video = s.video_asset_id ? assets[s.video_asset_id] : null;

  const redo = shots.filter(x => x.status === 'redo' || x.blocked).length;
  const PANEL: Record<NonNullable<typeof panel>, string> = { shots: 'اللقطات', refs: 'المراجع', prompt: 'البرومبت', video: 'الفيديو', notes: 'الحالة والملاحظات' };
  const primary = video && s.status !== 'done' && s.status !== 'editing'
    ? <button className="gbtn primary big" onClick={() => save({ status: 'done' }, true)}><CheckCircle size={24} weight="fill" /> تمّت</button>
    : <button className="gbtn primary big" onClick={() => prepare()}>جهّز للتوليد</button>;

  return (
    <div className="seg-sheet-wrap" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <section className="seg-sheet" role="dialog" aria-label={`مقطع ${s.label ?? s.idx}`}>
        <div className="grab" />
        {!panel ? <>
          <header className="ss-head">
            <div className="ph-text"><h1 className="ltr">{s.label ?? `مقطع ${arNum(s.idx)}`}</h1><p>{secShort(section?.name ?? s.group_label)} · {arNum(bars)} بار · {STATUS[s.status].t}</p></div>
            <button className="gbtn icon soft" onClick={() => setPanel('notes')} aria-label="الحالة والملاحظات"><NotePencil size={24} /></button>
            <button className="gbtn icon soft" onClick={close} aria-label="اقفل"><X size={24} /></button>
          </header>

          <div className="ss-wave">
            <button className="gbtn icon play" onClick={play} aria-label="شغّل المقطع" disabled={!song.audio}>{playing ? <Pause size={26} weight="fill" /> : <Play size={26} weight="fill" />}</button>
            <div className="mini-wave">{peaks ? peaks.map((p, i) => <i key={i} style={{ height: `${Math.max(6, p * 100)}%` }} />) : null}</div>
            <div className="bars-ctl">
              <button className="gbtn icon soft" onClick={() => edge(-1)} aria-label="بار أقل"><Minus size={22} /></button>
              <button className="gbtn icon soft" onClick={() => edge(1)} aria-label="بار أكتر"><Plus size={22} /></button>
            </div>
            {song.audio && <audio ref={audio} src={song.audio} preload="none" />}
          </div>

          <div className="ss-rows">
            {shots.length > 0 && <Row icon={FilmSlate} title="اللقطات" line={`${arNum(shots.length)} لقطات${redo ? ` · ${arNum(redo)} محتاجة شغل` : ''}`} onClick={() => setPanel('shots')} />}
            <Row icon={At} img={firstPic} title="المراجع" line={res?.refs.length ? (res.problems.length ? `${arNum(res.refs.length)} مراجع · فيه ${arNum(res.problems.length)} مشكلة` : `${arNum(res.refs.length)} مراجع · ${arNum(res.files.length + s.refs.filter(a => !res.files.some(f => f.asset === a)).length)} صور بالترتيب`) : 'اكتب @ في البرومبت'} onClick={() => setPanel('refs')} />
            <Row icon={TextAa} title="البرومبت" line={<span className="ltr">{song.tools[toolKey]?.name ?? toolKey}</span>} onClick={() => setPanel('prompt')} />
            {video ? <VideoRow id={video.id} thumb={video.thumb} open={() => setPanel('video')} /> : <Row icon={FilmStrip} title="الفيديو" line="مستني التوليد" onClick={() => setPanel('video')} />}
          </div>

          {err && <div className="note-err"><Warning size={24} weight="fill" /><div><b>{err.what}</b>{err.fix && <p>{err.fix}</p>}{err.confirm === 'no_donia' && <button className="gbtn soft" onClick={() => prepare(true)}>جهّز برضه</button>}</div></div>}
          {kit && (
            <Card title="الكيت جاهز" line={`${arNum(kit.files)} صور والبرومبت${kit.audio ? ' والصوت' : ''}`}
              action={kit.zip ? <a className="gbtn secondary" href={kit.zip}><DownloadSimple size={22} /> نزّل</a> : undefined}>
              <div className="card-more">
                <div className="row-btns">
                  <button className="gbtn soft" onClick={() => { navigator.clipboard?.writeText(res?.prompt_out ?? prompt); toast('اتنسخ'); }}><Copy size={22} /> انسخ البرومبت</button>
                  {kit.open && <a className="gbtn soft" href={kit.open} target="_blank" rel="noreferrer"><ArrowSquareOut size={22} /> افتح الموقع</a>}
                </div>
              </div>
            </Card>
          )}
          <div className="ss-primary">{primary}</div>
        </> : <>
          <header className="ss-head">
            <button className="gbtn icon soft" onClick={() => setPanel(null)} aria-label="رجوع"><CaretRight size={24} /></button>
            <div className="ph-text"><h2>{PANEL[panel]}</h2></div>
            <button className="gbtn icon soft" onClick={close} aria-label="اقفل"><X size={24} /></button>
          </header>

          {panel === 'shots' && <div className="shot-list">
            {shots.map(x => { const cf = x.conflicts.map(n => conflicts.find(c => c.n === n)).filter(c => c && c.status === 'open') as Conflict[]; return (
              <div key={x.id} className="shot-row">
                <div className="shot-top"><b className="ltr">{x.code}</b><span className="shot-st" style={{ color: SHOT[x.status].c }}><i style={{ background: SHOT[x.status].c }} />{SHOT[x.status].t}</span></div>
                <p className="shot-title">{x.title}</p>
                <ShotPrompt shot={x} tool={toolKey} refs={allRefs} />
                {cf.map(c => <p key={c.id} className="shot-conf"><Warning size={20} weight="fill" /> {c.title}</p>)}
                {x.blocked && <p className="shot-conf"><Warning size={20} weight="fill" /> {x.blocked}</p>}
                {(x.answers.length > 0 || x.note || x.questions.length > 0) && <details className="details"><summary>تفاصيل</summary><div className="details-body">
                  {x.note && <p>{x.note}</p>}
                  {x.answers.length > 0 && <ul className="shot-answers">{x.answers.map(a => <li key={a}>{a}</li>)}</ul>}
                  {x.questions.length > 0 && <p>محتاج قرارك: {x.questions.join(' · ')}</p>}
                  <p className="mute ltr">{tc(x.start_s)} → {tc(x.end_s)}{x.source ? ` · ${x.source}` : ''}</p>
                </div></details>}
              </div>
            ); })}
          </div>}

          {panel === 'refs' && <>
            <RefsList res={res} toolName={song.tools[toolKey]?.name ?? toolKey} />
            <div className="section-h"><h2>صور زيادة</h2><span>بعد المراجع</span></div>
            <div className="slots">
              {s.refs.map((id, i) => { const a = assets[id]; return (
                <figure key={id + i} className={'slot' + (a?.no_generation ? ' blocked' : '') + (dragI === i ? ' dragging' : '') + (overI === i && dragI !== i ? ' over' : '')}
                  draggable onDragStart={e => { setDragI(i); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { setDragI(null); setOverI(null); }}
                  onDragOver={e => { e.preventDefault(); setOverI(i); }} onDrop={e => { e.preventDefault(); dropAt(i); }}>
                  {a?.thumb && <img src={a.thumb} alt="" />}
                  <span className="slot-n">{arNum(i + 1)}</span>
                  {a?.no_generation ? <span className="slot-warn"><Warning size={20} weight="fill" /></span> : null}
                  <div className="slot-ctl">
                    <button onClick={() => move(i, 1)} aria-label="بعدها"><ArrowLeft size={20} /></button>
                    <button onClick={() => save({ refs: s.refs.filter((_, j) => j !== i) }, true)} aria-label="شيل"><X size={20} /></button>
                    <button onClick={() => move(i, -1)} aria-label="قبلها"><ArrowRight size={20} /></button>
                  </div>
                </figure>
              ); })}
              <button className="slot add" onClick={() => setPicker('refs')}><Plus size={30} /><span>ضيف</span></button>
            </div>
            {inspo.length > 0 && <>
              <div className="section-h"><h2>مراجع إلهام</h2><span>مش بتتبعت للتوليد</span></div>
              <div className="h-scroll">{inspo.map(x => (
                <a key={x.id} className="inspo-mini" href={x.watch ?? x.link} target="_blank" rel="noreferrer">
                  {x.thumb && <img src={x.thumb} alt="" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                  <b className="ltr">{x.label}</b><span>{x.line}</span><small className="ltr">{x.source}</small>
                </a>))}</div>
            </>}
          </>}

          {panel === 'prompt' && <>
            <div className="plan-tabs seg">
              <button aria-pressed={plan === 'primary'} onClick={() => setPlan('primary')}>الأساسية</button>
              <button aria-pressed={plan === 'backup'} onClick={() => setPlan('backup')}>البديلة</button>
            </div>
            <div className="tools">
              {Object.entries(song.tools).map(([k, t]) => (
                <button key={k} className="tool" aria-pressed={toolKey === k} onClick={() => setPlan_({ tool: k })}><b className="ltr">{t.name}</b></button>
              ))}
            </div>
            <PromptBox value={partial} onChange={v => setPlan_({ prompt_partial: v })} placeholder="وصف المقطع · اكتب @ للمراجع" refs={allRefs} res={res} />
            {!partial && direction && <button className="gbtn soft" onClick={() => setPlan_({ prompt_partial: direction })}>استخدم وصف اللقطات</button>}
            <details className="details"><summary>البرومبت كامل</summary><div className="details-body"><div className="prompt ltr">{res?.prompt_out ?? prompt}</div>
              <button className="gbtn soft" onClick={() => { navigator.clipboard?.writeText(res?.prompt_out ?? prompt); toast('اتنسخ'); }}><Copy size={22} /> انسخ</button></div></details>
          </>}

          {panel === 'video' && <>
            <div className="video-slot" onDragOver={e => e.preventDefault()} onDrop={async e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (!f) return; const r = await api.upload([f]); const id = r.imported?.[0]?.id; if (id) { const d = await api.assets('all'); setAssets(() => Object.fromEntries(d.items.map(a => [a.id, a]))); save({ video_asset_id: id }, true); } }}>
              {video?.src ? <video src={video.src} poster={video.thumb ?? undefined} controls playsInline /> : <button className="vs-empty" onClick={() => setPicker('video')}><FilmStrip size={40} /><span>اسحب الفيديو هنا</span></button>}
            </div>
            {video && <VideoQc id={video.id} />}
            {kit && <p className="panel-line">الفيديو اللي فيه رقم <b className="ltr">{kit.kit.split('_').pop()}</b> هيتربط لوحده</p>}
          </>}

          {panel === 'notes' && <>
            <div className="status-row">
              {(Object.keys(STATUS) as Status[]).map(k => (
                <button key={k} className="chip-f" aria-pressed={s.status === k} onClick={() => k === 'done' && !s.video_asset_id ? toast('حط الفيديو الأول') : save({ status: k }, true)}><i className="dot" style={{ background: STATUS[k].c }} />{STATUS[k].t}</button>
              ))}
            </div>
            <textarea className="notes" value={s.notes} onChange={e => save({ notes: e.target.value })} rows={4} placeholder="ملاحظة" />
            <div className="section-h"><h2>النسخ</h2><span>{saved ? 'اتحفظ' : ''}</span></div>
            <div className="versions">
              {versions.length ? versions.slice(0, 8).map(v => <button key={v.id} className="chip-f" onClick={() => undo(v.id)}><ArrowCounterClockwise size={20} />{new Date(v.at + 'Z').toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</button>) : <span className="mute">لسه مفيش تعديلات</span>}
            </div>
          </>}
        </>}
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
        <header><h2>{kind === 'refs' ? 'اختار بالترتيب' : 'اختار الفيديو'}</h2><span className="sp" /><button className="gbtn soft" onClick={onClose}>إلغاء</button><button className="gbtn primary" disabled={!sel.length} onClick={() => onPick(sel)}>ضيف {sel.length ? arNum(sel.length) : ''}</button></header>
        <div className="picker-grid">
          {list.length ? list.map(a => { const n = sel.indexOf(a.id); const off = kind === 'refs' && (!!a.no_generation || chosen.includes(a.id)); return (
            <button key={a.id} className={'tile loaded' + (n >= 0 ? ' sel' : '')} disabled={off} title={a.no_generation ? 'ممنوع كمرجع توليد' : a.label ?? ''}
              onClick={() => setSel(x => kind === 'video' ? [a.id] : x.includes(a.id) ? x.filter(i => i !== a.id) : [...x, a.id])}>
              {a.thumb && <img src={a.thumb} alt="" />}
              {n >= 0 && <span className="pick-n">{arNum(n + 1)}</span>}
              {a.no_generation ? <span className="st"><Warning size={18} weight="fill" color="var(--warn)" /></span> : a.approved ? <span className="st"><CheckCircle size={18} weight="fill" color="var(--ok)" /></span> : null}
            </button>
          ); }) : <p className="mute" style={{ padding: 20 }}>{kind === 'video' ? 'مفيش فيديوهات لسه' : 'مفيش صور'}</p>}
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
    <div className="work"><div className="scroll"><div className="stack">
      <PageHead title="المونتاج" line={`${arNum(done.length)} من ${arNum(song.segments.length)} مقطع جاهز`} />
      <div className="montage">
        <div className="m-screen">{v?.src ? <video key={v.id} src={v.src} muted autoPlay playsInline /> : <img src={song.poster ?? ''} alt="" className="m-poster" />}</div>
        {song.audio && <audio ref={audio} src={song.audio} controls onTimeUpdate={e => setT(e.currentTarget.currentTime)} style={{ width: '100%' }} />}
        <div className="m-line">{song.segments.map(s => <i key={s.id} style={{ left: `${s.start_s / song.duration * 100}%`, width: `${(s.end_s - s.start_s) / song.duration * 100}%`, background: STATUS[s.status].c, opacity: s.video_asset_id ? 1 : .35 }} />)}<b style={{ left: `${t / song.duration * 100}%` }} /></div>
        <a className="gbtn primary big" href={`/api/songs/${song.id}/fcpxml`} download>صدّر لـ Final Cut</a>
      </div>
    </div></div></div>
  );
}

type MenuItem = { icon: React.ComponentType<{ size?: number }>; label: string; run?: () => void; href?: string };
export function MoreMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (!open) return; const f = () => setOpen(false); const t = setTimeout(() => addEventListener('click', f), 0); return () => { clearTimeout(t); removeEventListener('click', f); }; }, [open]);
  return (
    <div className="more-wrap">
      <button className="gbtn icon glass" aria-label="المزيد" aria-expanded={open} onClick={() => setOpen(o => !o)}><DotsThree size={28} weight="bold" /></button>
      {open && <div className="more-menu glass-strong" role="menu">
        {items.map(it => it.href
          ? <a key={it.label} role="menuitem" href={it.href}><it.icon size={24} />{it.label}</a>
          : <button key={it.label} role="menuitem" onClick={() => { it.run?.(); setOpen(false); }}><it.icon size={24} />{it.label}</button>)}
      </div>}
    </div>
  );
}

/** A shot's own prompt (@ handles work here too). Saved as you type. */
function ShotPrompt({ shot, tool, refs }: { shot: Shot; tool: string; refs: ReturnType<typeof useRefs> }) {
  const [v, setV] = useState(shot.prompt ?? '');
  const [open, setOpen] = useState(!!shot.prompt);
  const res = useResolution(v, tool);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const change = (x: string) => { setV(x); if (t.current) clearTimeout(t.current); t.current = setTimeout(() => fetch(`/api/shots/${shot.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: x }) }), 500); };
  if (!open) return <button className="gbtn soft shot-add" onClick={() => setOpen(true)}>اكتب برومبت للقطة</button>;
  return <PromptBox value={v} onChange={change} placeholder="برومبت اللقطة · اكتب @ للمراجع" refs={refs} res={res} />;
}

/** The video row shows its check: score and verdict (the check recommends; «تمّت» stays yours). */
function VideoRow({ id, thumb, open }: { id: string; thumb: string | null; open: () => void }) {
  const { qc } = useQc(id);
  return <Row icon={FilmStrip} img={thumb} title="الفيديو" line={qc ? `${qc.score != null ? qc.score.toLocaleString('ar-EG') + ' · ' : ''}${QC_LABEL[qc.status]}` : 'وصل · بيتفحص'} onClick={open} />;
}
function VideoQc({ id }: { id: string }) { const { qc, busy, rerun } = useQc(id); return <QcCard qc={qc} busy={busy} rerun={rerun} />; }
