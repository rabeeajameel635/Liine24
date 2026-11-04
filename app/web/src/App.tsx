import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Sun, SquaresFour, Images, Sparkle, CheckCircle, Heart, LockSimple, Clock, VideoCamera, UserCircle, Folder,
  MusicNotes, User, PlugsConnected, FileText, MagnifyingGlass, Moon, Circle
} from '@phosphor-icons/react';
import type { Icon as PIcon } from '@phosphor-icons/react';
import { api, fmtDate, type Album, type Asset } from './api.ts';
import { Library, statusOf } from './Library.tsx';
import { Status, Toaster } from './ui.tsx';
import { CharacterScreen } from './Character.tsx';

type Route = { view: 'today' | 'studio' | 'library' | 'assistant' | 'song' | 'characters' | 'connections' | 'skills'; album: string };
const parse = (): Route => { const [, v = 'library', a = 'all'] = location.hash.split('/'); return { view: (v || 'library') as Route['view'], album: decodeURIComponent(a) }; };
const ALBUM_ICON: Record<string, PIcon> = { all: Images, approved: CheckCircle, favorites: Heart, locked: LockSimple, waiting: Clock, videos: VideoCamera };
type Theme = 'auto' | 'light' | 'dark';
const pref = { get: (k: string, d: string) => { try { return localStorage.getItem('ghorfa.' + k) ?? d; } catch { return d; } }, set: (k: string, v: string) => { try { localStorage.setItem('ghorfa.' + k, v); } catch { /* */ } } };

export function App() {
  const [route, setRoute] = useState<Route>(parse);
  const [albums, setAlbums] = useState<{ albums: Album[]; projects: Album[]; people: Album[] } | null>(null);
  const [project, setProject] = useState<{ title: string; brand: string; line: string } | null>(null);
  const [picked, setPicked] = useState<Asset | null>(null);
  const [palette, setPalette] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => pref.get('theme', 'auto') as Theme);

  const loadAlbums = useCallback(() => { api.albums().then(setAlbums).catch(() => {}); }, []);
  useEffect(() => { loadAlbums(); api.bootstrap().then(d => setProject(d.projects?.[0] ?? null)).catch(() => {}); }, [loadAlbums]);
  useEffect(() => { const f = () => setRoute(parse()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  useEffect(() => { if (theme === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme; pref.set('theme', theme); }, [theme]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => !p); }
      if (mod && e.key.toLowerCase() === 'j') { e.preventDefault(); go('assistant'); }
    };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, []);
  const go = (view: Route['view'], album = 'all') => { location.hash = `/${view}/${encodeURIComponent(album)}`; };

  const allAlbums = useMemo(() => [...(albums?.albums ?? []), ...(albums?.projects ?? []), ...(albums?.people ?? [])], [albums]);
  const albumTitle = allAlbums.find(a => a.id === route.album)?.title ?? 'المكتبة';
  const isLib = route.view === 'library';

  const SideItem = ({ icon: I, label, active, count, onClick, disabled }: { icon: PIcon; label: string; active: boolean; count?: number; onClick: () => void; disabled?: boolean }) => (
    <button className="si" aria-current={active ? 'page' : undefined} onClick={onClick} disabled={disabled}>
      <I size={20} weight={active ? 'fill' : 'regular'} /><span>{label}</span>{count != null && <span className="n">{count}</span>}
    </button>
  );

  return (
    <div className={'shell' + (isLib ? '' : ' no-ins')}>
      <aside className="side" aria-label="الشريط">
        <div className="side-proj"><span className="av">L24</span><div><b className="ltr" style={{ textAlign: 'right' }}>{project?.title ?? '…'}</b><span className="ltr" style={{ textAlign: 'right' }}>{project ? `${project.brand} / ${project.line}` : ''}</span></div></div>
        <nav>
          <SideItem icon={Sun} label="اليوم" active={route.view === 'today'} onClick={() => go('today')} />
          <SideItem icon={SquaresFour} label="الاستوديو" active={route.view === 'studio'} onClick={() => go('studio')} />
          <SideItem icon={Sparkle} label="المساعد" active={route.view === 'assistant'} onClick={() => go('assistant')} />
        </nav>
        <div>
          <h6>المكتبة</h6>
          <nav>{(albums?.albums ?? []).map(a => <SideItem key={a.id} icon={ALBUM_ICON[a.id] ?? Images} label={a.title} count={a.count} active={isLib && route.album === a.id} onClick={() => go('library', a.id)} />)}</nav>
        </div>
        <div>
          <h6>الأشخاص</h6>
          <nav>{(albums?.people ?? []).map(a => <SideItem key={a.id} icon={UserCircle} label={a.title} count={a.count} active={isLib && route.album === a.id} onClick={() => go('library', a.id)} />)}</nav>
        </div>
        <div>
          <h6>المشاريع</h6>
          <nav>{(albums?.projects ?? []).map(a => <SideItem key={a.id} icon={Folder} label={a.title} count={a.count} active={isLib && route.album === a.id} onClick={() => go('library', a.id)} />)}</nav>
        </div>
        <div>
          <h6>الاستوديو</h6>
          <nav>
            <SideItem icon={MusicNotes} label="الأغنية" active={route.view === 'song'} onClick={() => go('song')} />
            <SideItem icon={User} label="الشخصيات" active={route.view === 'characters'} onClick={() => go('characters')} />
            <SideItem icon={PlugsConnected} label="الاتصالات" active={route.view === 'connections'} onClick={() => go('connections')} />
            <SideItem icon={FileText} label="السكيلز" active={route.view === 'skills'} onClick={() => go('skills')} />
          </nav>
        </div>
        <div className="seg" style={{ marginTop: 'auto', background: 'var(--hover)' }}>
          {([['auto', 'تلقائي'], ['light', 'فاتح'], ['dark', 'غامق']] as [Theme, string][]).map(([v, t]) => <button key={v} aria-pressed={theme === v} onClick={() => setTheme(v)} style={{ flex: 1 }}>{t}</button>)}
        </div>
      </aside>

      {isLib && <Library album={route.album} title={albumTitle} onPick={setPicked} refreshAlbums={loadAlbums} />}
      {route.view === 'today' && <Today albums={albums} go={go} />}
      {route.view === 'studio' && <Studio go={go} />}
      {route.view === 'song' && <SongHero />}
      {route.view === 'characters' && <CharacterScreen />}
      {(route.view === 'connections' || route.view === 'skills' || route.view === 'assistant') && <Soon view={route.view} />}

      {isLib && <Inspector a={picked} />}

      <nav className="tabbar glass-strong" aria-label="التبويبات">
        {([['today', 'اليوم', Sun], ['studio', 'الاستوديو', SquaresFour], ['library', 'المكتبة', Images], ['assistant', 'المساعد', Sparkle]] as [Route['view'], string, PIcon][]).map(([v, t, I]) => (
          <button key={v} aria-current={route.view === v ? 'page' : undefined} onClick={() => go(v)}><I size={24} weight={route.view === v ? 'fill' : 'regular'} />{t}</button>
        ))}
      </nav>
      {palette && <Palette onClose={() => setPalette(false)} go={go} setTheme={setTheme} albums={allAlbums} />}
      <Toaster />
    </div>
  );
}

function Inspector({ a }: { a: Asset | null }) {
  if (!a) return <aside className="inspector"><div className="empty-ins">اختار صورة.</div></aside>;
  const p = a.provenance;
  return (
    <aside className="inspector" aria-label="المفتش">
      <div className="ins-hero">{a.thumb && <img src={a.thumb} alt="" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />}</div>
      <div className="ins-card"><h4>الحالة</h4><Status kind={statusOf(a)} /></div>
      <div className="ins-card">
        <h4>الملف</h4>
        <dl className="kv">
          <dt>الاسم</dt><dd className="ltr mono">{a.name}</dd>
          <dt>المصدر</dt><dd>{a.source === 'higgsfield' ? 'Higgsfield' : a.source === 'watch' ? 'الفولدر المراقَب' : 'سحب وإفلات'}</dd>
          {p.higgsfield_project && <><dt>المشروع</dt><dd className="ltr">{p.higgsfield_project}</dd></>}
          {a.source_ref && <><dt>المعرّف</dt><dd className="ltr mono">{a.source_ref}</dd></>}
          {a.folder && <><dt>الفولدر</dt><dd className="ltr">{a.folder}</dd></>}
          <dt>الإضافة</dt><dd>{fmtDate(a.created_at)}</dd>
          <dt>الأصل</dt><dd>{a.original && !a.remote_url ? 'محفوظ' : 'لسه ما نزلش'}</dd>
        </dl>
      </div>
      {a.remote_url && <div className="ins-card"><h4>التحميل</h4><p style={{ margin: 0, fontSize: 13.5 }}>الملف متسجل، والتحميل مستني الاتصال بمخزن Higgsfield.</p></div>}
    </aside>
  );
}

function Hero({ art, children }: { art?: React.ReactNode; children: React.ReactNode }) {
  return <div className="work"><div className="hero"><div className="hero-art">{art}</div><div className="hero-body">{children}</div></div></div>;
}

function Today({ albums, go }: { albums: { albums: Album[] } | null; go: (v: Route['view'], a?: string) => void }) {
  const waiting = albums?.albums.find(a => a.id === 'waiting')?.count ?? 0;
  return (
    <div className="work"><div className="scroll"><div className="title-block"><h1>اليوم</h1><p>{new Date().toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })}</p></div>
      <div style={{ padding: '6px 22px', display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))' }}>
        <button className="si glass" style={{ height: 'auto', padding: 20, borderRadius: 24, flexDirection: 'column', alignItems: 'flex-start', gap: 8 }} onClick={() => go('library', 'waiting')}>
          <Status kind="wait" /><span className="big-num" style={{ fontSize: 56 }}>{waiting}</span><span className="mute">في المكتبة</span>
        </button>
      </div></div></div>
  );
}

function Studio({ go }: { go: (v: Route['view']) => void }) {
  const cards: [Route['view'], string, PIcon][] = [['song', 'الأغنية', MusicNotes], ['characters', 'الشخصيات', User], ['connections', 'الاتصالات', PlugsConnected], ['skills', 'السكيلز', FileText]];
  return (
    <div className="work"><div className="scroll"><div className="title-block"><h1>الاستوديو</h1></div>
      <div style={{ padding: '6px 22px 120px', display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))' }}>
        {cards.map(([v, t, I]) => <button key={v} className="si" style={{ height: 120, borderRadius: 24, background: 'var(--bg-2)', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'space-between', padding: 18, fontSize: 17, fontWeight: 700 }} onClick={() => go(v)}><I size={30} />{t}</button>)}
      </div></div></div>
  );
}

function SongHero() {
  // placeholder bars until the song studio step measures the real file
  const colors = ['#b0102c', '#6e6e73', '#2c2c2e', '#8e8e93'];
  return (
    <Hero art={<div style={{ height: '100%', display: 'grid', placeItems: 'center', background: 'linear-gradient(160deg,#141416,#2a0a12)' }}><MusicNotes size={120} color="#ffffff40" /></div>}>
      <h1 className="ltr" style={{ textAlign: 'right' }}>I Am The World</h1>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, marginTop: 10 }}><span className="big-num">71.9</span><span className="mute" style={{ paddingBottom: 14 }}>BPM</span></div>
      <Status kind="warn" label="قياس قديم · يتقاس من الملف النهائي" />
      <div className="wave" aria-hidden="true">{Array.from({ length: 96 }, (_, i) => <i key={i} style={{ height: `${18 + Math.abs(Math.sin(i * 0.37)) * 70}%`, background: colors[Math.floor(i / 24)], opacity: .35 }} />)}</div>
    </Hero>
  );
}

function Soon({ view }: { view: string }) {
  const t: Record<string, string> = { connections: 'الاتصالات', skills: 'السكيلز', assistant: 'المساعد' };
  return <div className="work"><div className="scroll"><div className="title-block"><h1>{t[view]}</h1><p>جاية في المرحلة دي، خطوة خطوة.</p></div></div></div>;
}

function Palette({ onClose, go, setTheme, albums }: { onClose: () => void; go: (v: Route['view'], a?: string) => void; setTheme: (t: Theme) => void; albums: Album[] }) {
  const [q, setQ] = useState(''); const [i, setI] = useState(0); const inp = useRef<HTMLInputElement>(null);
  const cmds = [
    ...albums.map(a => ({ id: a.id, label: 'افتح ' + a.title, icon: Images, run: () => go('library', a.id) })),
    { id: 'today', label: 'اليوم', icon: Sun, run: () => go('today') },
    { id: 'studio', label: 'الاستوديو', icon: SquaresFour, run: () => go('studio') },
    { id: 'song', label: 'الأغنية', icon: MusicNotes, run: () => go('song') },
    { id: 'chars', label: 'الشخصيات', icon: User, run: () => go('characters') },
    { id: 'assist', label: 'المساعد ⌘J', icon: Sparkle, run: () => go('assistant') },
    { id: 'light', label: 'المظهر: فاتح', icon: Sun, run: () => setTheme('light') },
    { id: 'dark', label: 'المظهر: غامق', icon: Moon, run: () => setTheme('dark') },
    { id: 'auto', label: 'المظهر: تلقائي', icon: Circle, run: () => setTheme('auto') }
  ].filter(c => c.label.includes(q.trim()));
  useEffect(() => inp.current?.focus(), []);
  const run = (c?: (typeof cmds)[number]) => { if (c) { c.run(); onClose(); } };
  return (
    <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,.25)', display: 'flex', justifyContent: 'center', paddingTop: '14vh' }}>
      <div className="glass-strong" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label="الأوامر" style={{ width: 'min(600px,92vw)', borderRadius: 24, overflow: 'hidden', alignSelf: 'flex-start' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 18px', borderBottom: '1px solid var(--line)' }}>
          <MagnifyingGlass size={20} className="mute" />
          <input ref={inp} value={q} onChange={e => { setQ(e.target.value); setI(0); }} placeholder="اكتب أمر…" style={{ flex: 1, border: 0, background: 'none', outline: 'none', height: 56, fontSize: 17 }}
            onKeyDown={e => { if (e.key === 'ArrowDown') setI(x => Math.min(x + 1, cmds.length - 1)); if (e.key === 'ArrowUp') setI(x => Math.max(0, x - 1)); if (e.key === 'Enter') run(cmds[i]); if (e.key === 'Escape') onClose(); }} />
        </label>
        <div style={{ padding: 6, maxHeight: '50vh', overflow: 'auto' }}>
          {cmds.map((c, n) => <button key={c.id} className="si" aria-current={n === i ? 'page' : undefined} style={{ width: '100%' }} onMouseEnter={() => setI(n)} onClick={() => run(c)}><c.icon size={20} />{c.label}</button>)}
        </div>
      </div>
    </div>
  );
}
