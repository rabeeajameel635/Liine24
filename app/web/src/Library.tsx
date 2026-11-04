// المكتبة — a full-bleed photo grid with floating glass controls, like a phone's photo library.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MagnifyingGlass, CheckCircle, Heart, CloudSlash, SelectionAll, X, Plus, PaperPlaneTilt, FilmSlate, Rows } from '@phosphor-icons/react';
import { api, fmtDur, type Asset, type Album } from './api.ts';
import { Status, toast, PageHead } from './ui.tsx';
import { arNum } from './Songs.tsx';
import { Viewer } from './Viewer.tsx';

type Group = 'all' | 'song' | 'shot';
const GROUP_LABEL: Record<Group, string> = { all: 'كل حاجة', song: 'بالأغنية', shot: 'باللقطة' };

export function statusOf(a: Asset): 'ok' | 'warn' | 'wait' {
  if (a.face_check === 'warn' || a.warn) return 'warn';
  return a.approved ? 'ok' : 'wait';
}

const CHIP: Record<string, string> = { all: 'الكل', approved: 'المعتمد', locked: 'المقفول', waiting: 'مستني', favorites: 'المفضّل', videos: 'الفيديو' };

export function Library({ album, title, albums, people, go, onPick, refreshAlbums }: { album: string; title: string; albums: Album[]; people: Album[]; go: (album: string) => void; onPick: (a: Asset | null) => void; refreshAlbums: () => void }) {
  const [items, setItems] = useState<Asset[] | null>(null);
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<Group>('all');
  const [cols, setCols] = useState(() => (innerWidth < 820 ? 3 : 5));
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const [drag, setDrag] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  const load = useCallback(() => api.assets(album, q).then(d => setItems(d.items)), [album, q]);
  useEffect(() => { const t = setTimeout(load, q ? 180 : 0); return () => clearTimeout(t); }, [load, q]);
  useEffect(() => { first.current = true; setSel(new Set()); setSelecting(false); }, [album]);
  // newest at the bottom: land at the bottom like Photos
  useEffect(() => { if (items && first.current && scroller.current) { scroller.current.scrollTop = scroller.current.scrollHeight; first.current = false; } }, [items]);

  // pinch (trackpad ctrl+wheel, or two-finger touch) changes density
  useEffect(() => {
    const el = scroller.current; if (!el) return;
    const wheel = (e: WheelEvent) => { if (!e.ctrlKey) return; e.preventDefault(); setCols(c => Math.max(2, Math.min(10, c + (e.deltaY > 0 ? 1 : -1)))); };
    let d0 = 0; const pts = new Map<number, PointerEvent>();
    const down = (e: PointerEvent) => { pts.set(e.pointerId, e); if (pts.size === 2) { const [a, b] = [...pts.values()]; d0 = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); } };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, e);
      if (pts.size === 2 && d0) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (Math.abs(d - d0) > 60) { setCols(c => Math.max(2, Math.min(10, c + (d < d0 ? 1 : -1)))); d0 = d; } }
    };
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); if (pts.size < 2) d0 = 0; };
    el.addEventListener('wheel', wheel, { passive: false }); el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    return () => { el.removeEventListener('wheel', wheel); el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
  }, []);

  const groups = useMemo(() => {
    if (!items) return [];
    if (group === 'all') return [{ key: 'all', title: '', items }];
    const key = (a: Asset) => group === 'song' ? (a.project_title ?? 'من غير أغنية') : (a.shot_id ?? 'من غير لقطة');
    const m = new Map<string, Asset[]>(); items.forEach(a => { const k = key(a); m.set(k, [...(m.get(k) ?? []), a]); });
    return [...m].map(([k, v]) => ({ key: k, title: k, items: v }));
  }, [items, group]);
  const flat = useMemo(() => groups.flatMap(g => g.items), [groups]);

  const toggle = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // long-press enters selection mode (and selects that tile); the click that follows a long-press is swallowed
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const onTileDown = (a: Asset) => { longPressed.current = false; press.current = setTimeout(() => { longPressed.current = true; setSelecting(true); toggle(a.id); }, 450); };
  const onTileUp = () => { if (press.current) clearTimeout(press.current); };
  const onTileClick = (a: Asset, i: number) => {
    onPick(a);
    if (longPressed.current) { longPressed.current = false; return; }
    if (selecting) toggle(a.id); else setOpen(i);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setDrag(false);
    const files = [...e.dataTransfer.files]; if (!files.length) return;
    toast(`بيستورد ${files.length}…`);
    const r = await api.upload(files); const n = r.imported?.filter((x: { duplicate: boolean }) => !x.duplicate).length ?? 0;
    toast(n ? `اتضاف ${n}` : 'موجود قبل كده'); first.current = true; load(); refreshAlbums();
  };

  const update = (a: Asset) => { setItems(xs => xs?.map(x => x.id === a.id ? a : x) ?? null); onPick(a); refreshAlbums(); };

  return (
    <div className="work" onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={e => { if (e.currentTarget === e.target) setDrag(false); }} onDrop={onDrop}>
      <div className="topbar">
        <label className="search glass">
          <MagnifyingGlass size={22} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="ابحث" aria-label="بحث" />
          {q && <button className="gbtn icon" onClick={() => setQ('')} aria-label="امسح"><X size={18} /></button>}
        </label>
        <span className="sp" />
        <div className="capsule glass">
          <button className="gbtn icon" aria-label={'اجمع: ' + GROUP_LABEL[group]} title={GROUP_LABEL[group]} onClick={() => { const n = group === 'all' ? 'song' : group === 'song' ? 'shot' : 'all'; setGroup(n); toast(GROUP_LABEL[n]); }}><Rows size={22} weight={group === 'all' ? 'regular' : 'fill'} /></button>
          <button className="gbtn" aria-pressed={selecting} onClick={() => { setSelecting(s => !s); setSel(new Set()); }}>{selecting ? 'خلاص' : 'اختيار'}</button>
        </div>
      </div>

      <div className="scroll" ref={scroller}>
        <PageHead title={title} line={items ? `${arNum(items.length)} عنصر` : ' '} />
        <label className="search m-search glass"><MagnifyingGlass size={22} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="ابحث" aria-label="بحث في الموبايل" /></label>
        <div className="chips-row lib-chips">
          {albums.filter(a => CHIP[a.id] && (a.count || a.id === 'all')).map(a => <button key={a.id} className="chip-f" aria-pressed={album === a.id} onClick={() => go(a.id)}>{CHIP[a.id]}</button>)}
          {people.map(a => <button key={a.id} className="chip-f" aria-pressed={album === a.id} onClick={() => go(a.id)}>{a.title}</button>)}
        </div>
        {items && !items.length && <div className="empty-ins">{q ? 'مفيش نتايج' : 'فاضية · اسحب ملفات هنا'}</div>}
        <div className="grid" style={{ ['--cols' as string]: cols }}>
          {!items && Array.from({ length: cols * 4 }, (_, i) => <div key={i} className="tile" />)}
          {groups.map(g => (
            <FragmentGroup key={g.key} title={g.title} count={g.items.length}>
              {g.items.map(a => {
                const i = flat.indexOf(a);
                return <Tile key={a.id} a={a} selecting={selecting} selected={sel.has(a.id)}
                  onDown={() => onTileDown(a)} onUp={onTileUp} onClick={() => onTileClick(a, i)} />;
              })}
            </FragmentGroup>
          ))}
        </div>
      </div>

      <div className="bottombar">
        {selecting && sel.size > 0 ? (
          <div className="selbar glass-strong">
            <span className="count">{sel.size} مختار</span>
            <button className="gbtn" onClick={() => toast('اللقطات جاية في خطوة الكليب')}><FilmSlate size={22} />للقطة</button>
            <button className="gbtn" onClick={() => toast('الإرسال جاي بعد تسجيل الدخول')}><PaperPlaneTilt size={22} />ابعت</button>
          </div>
        ) : (
          <div className="zoom glass" title="كبّر أو صغّر (أو قرّب بإصبعين)">
            <SelectionAll size={18} />
            <input type="range" min={2} max={10} step={1} value={12 - cols} onChange={e => setCols(12 - Number(e.target.value))} aria-label="الحجم" />
            <Plus size={18} />
          </div>
        )}
      </div>

      {drag && <div className="drop-veil">سيب الملفات هنا</div>}
      {open != null && flat[open] && <Viewer items={flat} index={open} onIndex={i => { setOpen(i); onPick(flat[i]); }} onClose={() => setOpen(null)} onUpdate={update} />}
    </div>
  );
}

function FragmentGroup({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return <>{title && <div className="group-h glass">{title}<small>{count}</small></div>}{children}</>;
}

function Tile({ a, selecting, selected, onDown, onUp, onClick }: { a: Asset; selecting: boolean; selected: boolean; onDown: () => void; onUp: () => void; onClick: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const vid = useRef<HTMLVideoElement>(null);
  const st = statusOf(a);
  return (
    <button className={'tile' + (loaded ? ' loaded' : '') + (failed ? ' offline' : '') + (selected ? ' sel' : '')}
      onPointerDown={onDown} onPointerUp={onUp} onPointerLeave={() => { onUp(); vid.current?.pause(); }}
      onMouseEnter={() => { vid.current?.play().catch(() => {}); }}
      onClick={onClick} aria-label={a.label ?? 'عنصر'} aria-pressed={selecting ? selected : undefined}>
      {a.kind === 'video' && a.src
        ? <video ref={vid} src={a.src} poster={a.thumb ?? undefined} muted loop playsInline preload="metadata" onLoadedData={() => setLoaded(true)} onError={() => setFailed(true)} />
        : a.thumb && !failed && <img src={a.thumb} alt="" loading="lazy" decoding="async" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />}
      {failed && <span className="off"><CloudSlash size={26} /></span>}
      {st !== 'wait' && <span className="st"><Status kind={st} iconOnly size={20} /></span>}
      {a.favorite && <span className="fav"><Heart size={16} weight="fill" /></span>}
      {a.kind === 'video' && <span className="dur">{fmtDur(a.duration)}</span>}
      {selecting && <span className="check">{selected && <CheckCircle size={22} weight="fill" />}</span>}
    </button>
  );
}
