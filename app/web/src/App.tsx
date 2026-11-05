import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Sun, SquaresFour, Images, Sparkle, CheckCircle, Heart, LockSimple, Clock, VideoCamera, UserCircle, Folder,
  MusicNotes, User, PlugsConnected, FileText, MagnifyingGlass, Moon, Circle, CaretLeft, House, Lightbulb, At
} from '@phosphor-icons/react';
import type { Icon as PIcon } from '@phosphor-icons/react';
import { api, fmtDate, type Album, type Asset } from './api.ts';
import { Library, statusOf } from './Library.tsx';
import { Status, Toaster, PageHead, Card, Details, Row } from './ui.tsx';
import { arNum } from './Songs.tsx';
import { CharacterScreen } from './Character.tsx';
import { Home } from './Songs.tsx';
import { Board, Montage } from './Board.tsx';
import { Connections } from './Connections.tsx';
import { InspirationPage } from './Inspiration.tsx';
import { ConstantsPage } from './Constants.tsx';

type Route = { view: 'home' | 'today' | 'studio' | 'library' | 'assistant' | 'song' | 'characters' | 'connections' | 'skills' | 'board' | 'montage' | 'inspiration' | 'constants'; album: string; sub?: string };
const parse = (): Route => { const [, v = 'home', a = 'all', sub] = location.hash.split('/'); const view = (v === 'today' ? 'home' : v || 'home') as Route['view']; return { view, album: decodeURIComponent(a), sub: sub ? decodeURIComponent(sub) : undefined }; };
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
  const albumTitle = route.album === 'all' ? 'المكتبة' : allAlbums.find(a => a.id === route.album)?.title ?? 'المكتبة';
  const isLib = route.view === 'library';

  const SideItem = ({ icon: I, label, active, onClick }: { icon: PIcon; label: string; active: boolean; onClick: () => void }) => (
    <button className="si" aria-current={active ? 'page' : undefined} onClick={onClick}><I size={24} weight={active ? 'fill' : 'regular'} /><span>{label}</span></button>
  );
  const onHome = route.view === 'home' || route.view === 'board' || route.view === 'montage';
  const onStudio = ['studio', 'characters', 'connections', 'skills', 'song', 'inspiration', 'constants'].includes(route.view);

  return (
    <div className={'shell' + (isLib && picked ? '' : ' no-ins')}>
      <aside className="side" aria-label="الشريط">
        <div className="side-proj"><span className="av">L24</span></div>
        <nav>
          <SideItem icon={House} label="الرئيسية" active={onHome} onClick={() => go('home')} />
          <SideItem icon={SquaresFour} label="الاستوديو" active={onStudio} onClick={() => go('studio')} />
          <SideItem icon={Images} label="المكتبة" active={isLib} onClick={() => go('library')} />
          <SideItem icon={Sparkle} label="المساعد" active={route.view === 'assistant'} onClick={() => go('assistant')} />
        </nav>
        <button className="si side-search" onClick={() => setPalette(true)}><MagnifyingGlass size={24} /><span>بحث</span></button>
      </aside>

      {isLib && <Library album={route.album} title={albumTitle} albums={albums?.albums ?? []} people={albums?.people ?? []} go={a => go('library', a)} onPick={setPicked} refreshAlbums={loadAlbums} />}
      {route.view === 'home' && <Home open={(song, seg) => { location.hash = `/board/${song}${seg ? '/' + seg : ''}`; }} />}
      {route.view === 'board' && <Board songId={route.album} segId={route.sub} go={seg => { location.hash = `/board/${route.album}${seg ? '/' + seg : ''}`; }} />}
      {route.view === 'montage' && <Montage songId={route.album} />}
      {route.view === 'studio' && <Studio go={go} />}
      {route.view === 'song' && <Redirect to="#/board/iatw-v44" />}
      {route.view === 'characters' && <CharacterScreen />}
      {route.view === 'connections' && <Connections />}
      {route.view === 'inspiration' && <InspirationPage />}
      {route.view === 'constants' && <ConstantsPage />}
      {(route.view === 'skills' || route.view === 'assistant') && <Soon view={route.view} />}

      {isLib && picked && <Inspector a={picked} />}

      <div className="tab-fade" aria-hidden="true" />
      <div className="tabbar">
        <nav className="tabs glass-strong" aria-label="التبويبات">
          {([['home', 'الرئيسية', House], ['studio', 'الاستوديو', SquaresFour], ['library', 'المكتبة', Images], ['assistant', 'المساعد', Sparkle]] as [Route['view'], string, PIcon][]).map(([v, t, I]) => {
            const on = v === 'home' ? onHome : v === 'studio' ? onStudio : route.view === v;
            return <button key={v} aria-current={on ? 'page' : undefined} aria-label={t} onClick={() => go(v)}><I size={26} weight={on ? 'fill' : 'regular'} /><span className="t-label">{t}</span></button>;
          })}
        </nav>
        <button className="tab-search glass-strong" aria-label="بحث (⌘K)" onClick={() => setPalette(true)}><MagnifyingGlass size={26} weight="bold" /></button>
      </div>
      {palette && <Palette onClose={() => setPalette(false)} go={go} setTheme={setTheme} albums={allAlbums} />}
      <Toaster />
    </div>
  );
}

function Inspector({ a }: { a: Asset }) {
  const p = a.provenance;
  return (
    <aside className="inspector" aria-label="المفتش">
      <div className="ins-hero">{a.thumb && <img src={a.thumb} alt="" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />}</div>
      <div className="ins-card">
        <h2 className="ins-title">{a.label ?? (a.kind === 'video' ? 'فيديو' : 'صورة')}</h2>
        <Status kind={statusOf(a)} />
      </div>
      <Details>
        <dl className="kv">
          <dt>المصدر</dt><dd>{a.source === 'higgsfield' ? 'Higgsfield' : a.source === 'watch' ? 'الفولدر المراقَب' : 'سحب وإفلات'}</dd>
          {p.higgsfield_project && <><dt>المشروع</dt><dd className="ltr">{p.higgsfield_project}</dd></>}
          {a.folder && <><dt>الفولدر</dt><dd className="ltr">{a.folder}</dd></>}
          <dt>الإضافة</dt><dd>{fmtDate(a.created_at)}</dd>
          <dt>الأصل</dt><dd>{a.original && !a.remote_url ? 'محفوظ' : 'لسه ما نزلش'}</dd>
        </dl>
      </Details>
    </aside>
  );
}

function Redirect({ to }: { to: string }) { useEffect(() => { location.replace(to); }, [to]); return null; }

function Studio({ go }: { go: (v: Route['view']) => void }) {
  const [d, setD] = useState<{ poster: string | null; title: string; donia: string | null; waiting: number; inspo: string | null; inspoN: number } | null>(null);
  useEffect(() => {
    Promise.all([fetch('/api/songs').then(r => r.json()), fetch('/api/characters/donia').then(r => r.json()).catch(() => null), fetch('/api/connections').then(r => r.json()).catch(() => null), fetch('/api/inspiration').then(r => r.json()).catch(() => null)]).then(([s, c, k, ins]) => {
      const song = s.songs?.[0]; const hair = c?.refs?.find((r: { label?: string }) => r.label?.includes('المشبك'));
      setD({ poster: song?.poster ?? null, title: song?.title ?? '', donia: hair?.thumb ?? c?.refs?.[0]?.thumb ?? null, waiting: (k?.services ?? []).filter((x: { kind: string; status: string }) => x.kind === 'mcp' && x.status !== 'connected').length,
        inspo: ins?.items?.find((x: { thumb: string | null }) => x.thumb?.startsWith('/'))?.thumb ?? null, inspoN: ins?.items?.length ?? 0 });
    });
  }, []);
  return (
    <div className="work"><div className="scroll"><div className="stack">
      <PageHead title="الاستوديو" line="كل أدوات الكليب" />
      <div className="studio-grid">
        <Card img={d?.poster} title="الأغنية" line="الكليب الحالي" onClick={() => { location.hash = '/board/iatw-v44'; }} />
        <Card img={d?.donia} title="الشخصيات" line="دنيا معتمدة" onClick={() => go('characters')} />
      </div>
      <Row icon={At} title="الثوابت" line="@دنيا · @الممر · @اللوفر" onClick={() => go('constants')} />
      <Row icon={Lightbulb} img={d?.inspo} title="الإلهام" line={d ? `${arNum(d.inspoN)} عمل من المصادر` : ' '} onClick={() => go('inspiration')} />
      <Row icon={PlugsConnected} title="الاتصالات" line={d ? (d.waiting ? `${arNum(d.waiting)} مستنية الدخول` : 'كلها متوصلة') : ' '} onClick={() => go('connections')} />
      <Row icon={FileText} title="السكيلز" line="جاية قريب" onClick={() => go('skills')} />
    </div></div></div>
  );
}

function Soon({ view }: { view: string }) {
  const t: Record<string, string> = { connections: 'الاتصالات', skills: 'السكيلز', assistant: 'المساعد' };
  return <div className="work"><div className="scroll"><div className="stack"><PageHead title={t[view]} line="جاية في الخطوة الجاية" /></div></div></div>;
}

function Palette({ onClose, go, setTheme, albums }: { onClose: () => void; go: (v: Route['view'], a?: string) => void; setTheme: (t: Theme) => void; albums: Album[] }) {
  const [q, setQ] = useState(''); const [i, setI] = useState(0); const inp = useRef<HTMLInputElement>(null);
  const cmds = [
    ...albums.map(a => ({ id: a.id, label: 'افتح ' + a.title, icon: Images, run: () => go('library', a.id) })),
    { id: 'home', label: 'الرئيسية', icon: House, run: () => go('home') },
    { id: 'studio', label: 'الاستوديو', icon: SquaresFour, run: () => go('studio') },
    { id: 'song', label: 'الأغنية', icon: MusicNotes, run: () => go('song') },
    { id: 'chars', label: 'الشخصيات', icon: User, run: () => go('characters') },
    { id: 'inspo', label: 'الإلهام', icon: Lightbulb, run: () => go('inspiration') },
    { id: 'const', label: 'الثوابت', icon: At, run: () => go('constants') },
    { id: 'assist', label: 'المساعد', icon: Sparkle, run: () => go('assistant') },
    { id: 'light', label: 'المظهر: فاتح', icon: Sun, run: () => setTheme('light') },
    { id: 'dark', label: 'المظهر: غامق', icon: Moon, run: () => setTheme('dark') },
    { id: 'auto', label: 'المظهر: تلقائي', icon: Circle, run: () => setTheme('auto') }
  ].filter(c => c.label.includes(q.trim())).slice(0, q.trim() ? 12 : 6);
  useEffect(() => inp.current?.focus(), []);
  const run = (c?: (typeof cmds)[number]) => { if (c) { c.run(); onClose(); } };
  return (
    <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,.25)', display: 'flex', justifyContent: 'center', paddingTop: '14vh' }}>
      <div className="glass-strong" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label="الأوامر" style={{ width: 'min(600px,92vw)', borderRadius: 24, overflow: 'hidden', alignSelf: 'flex-start' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 18px', borderBottom: '1px solid var(--line)' }}>
          <MagnifyingGlass size={24} className="mute" />
          <input ref={inp} value={q} onChange={e => { setQ(e.target.value); setI(0); }} placeholder="دوّر" style={{ flex: 1, border: 0, background: 'none', outline: 'none', height: 64, fontSize: 21 }}
            onKeyDown={e => { if (e.key === 'ArrowDown') setI(x => Math.min(x + 1, cmds.length - 1)); if (e.key === 'ArrowUp') setI(x => Math.max(0, x - 1)); if (e.key === 'Enter') run(cmds[i]); if (e.key === 'Escape') onClose(); }} />
        </label>
        <div style={{ padding: 6, maxHeight: '50vh', overflow: 'auto' }}>
          {cmds.map((c, n) => <button key={c.id} className="si" aria-current={n === i ? 'page' : undefined} style={{ width: '100%' }} onMouseEnter={() => setI(n)} onClick={() => run(c)}><c.icon size={24} />{c.label}</button>)}
        </div>
      </div>
    </div>
  );
}
