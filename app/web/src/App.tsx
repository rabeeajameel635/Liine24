import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './icons.tsx';
import { SCREENS, type Screen, type Sheet } from './screens.tsx';

type Project = { id: string; title: string; brand: string; line: string };
type Theme = 'auto' | 'light' | 'dark';
type Cmd = { id: string; label: string; icon: string; key?: string; run: () => void };

const pref = {
  get: (k: string, d: string) => { try { return localStorage.getItem('ghorfa.' + k) ?? d; } catch { return d; } },
  set: (k: string, v: string) => { try { localStorage.setItem('ghorfa.' + k, v); } catch { /* private mode */ } }
};

export function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [screenId, setScreenId] = useState(() => location.hash.slice(2) || 'library');
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<'inspector' | 'assistant'>('inspector');
  const [palette, setPalette] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => pref.get('theme', 'auto') as Theme);

  const screen = SCREENS.find(s => s.id === screenId && !s.later) ?? SCREENS[0];
  const sheet = screen.sheets.find(s => s.id === selected) ?? null;

  useEffect(() => {
    fetch('/api/bootstrap').then(r => r.json()).then(d => { setProject(d.projects[0] ?? null); setOnline(true); }).catch(() => setOnline(false));
  }, []);
  useEffect(() => { location.hash = '/' + screen.id; setSelected(null); }, [screen.id]);
  useEffect(() => {
    if (theme === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme;
    pref.set('theme', theme);
  }, [theme]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => !p); }
      if (mod && e.key.toLowerCase() === 'j') { e.preventDefault(); setPanel(p => p === 'assistant' ? 'inspector' : 'assistant'); }
      if (e.key === 'Escape') setPalette(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const commands: Cmd[] = useMemo(() => [
    ...SCREENS.filter(s => !s.later).map(s => ({ id: 'go-' + s.id, label: 'افتح ' + s.title, icon: s.icon, run: () => setScreenId(s.id) })),
    { id: 'primary', label: screen.primary + ' (' + screen.title + ')', icon: 'spark', run: () => {} },
    { id: 'assistant', label: 'افتح المساعد', icon: 'spark', key: '⌘J', run: () => setPanel('assistant') },
    { id: 'inspector', label: 'افتح المفتش', icon: 'inspector', run: () => setPanel('inspector') },
    { id: 'theme-light', label: 'المظهر: فاتح', icon: 'theme', run: () => setTheme('light') },
    { id: 'theme-dark', label: 'المظهر: غامق', icon: 'theme', run: () => setTheme('dark') },
    { id: 'theme-auto', label: 'المظهر: تلقائي', icon: 'theme', run: () => setTheme('auto') }
  ], [screen]);

  const groups: [Screen['group'], string][] = [['project', 'المشروع'], ['later', 'المرحلة الجاية'], ['system', 'النظام']];

  return (
    <div className="shell">
      <aside className="side" aria-label="الشريط">
        <button className="proj" title="المشروع">
          <span className="proj-t ltr">{project?.title ?? '…'}</span>
          <span className="proj-b ltr">{project ? `${project.brand} / ${project.line}` : online === false ? 'السيرفر مش شغال' : ''}</span>
        </button>
        {groups.map(([g, label]) => (
          <nav className="nav-g" key={g} aria-label={label}>
            <div className="nav-h">{label}</div>
            {SCREENS.filter(s => s.group === g).map(s => (
              <button key={s.id} className="nav-i" disabled={s.later} aria-current={s.id === screen.id ? 'page' : undefined} onClick={() => setScreenId(s.id)}>
                <Icon name={s.icon} /><span>{s.title}</span>{s.later && <span className="k">لاحقاً</span>}
              </button>
            ))}
          </nav>
        ))}
        <div className="side-foot">
          <button className="nav-i" onClick={() => setPalette(true)}><Icon name="search" /><span>الأوامر</span><span className="k kbd">⌘K</span></button>
          <button className="nav-i" onClick={() => setPanel(p => p === 'assistant' ? 'inspector' : 'assistant')}><Icon name="spark" /><span>المساعد</span><span className="k kbd">⌘J</span></button>
          <div className="seg" role="group" aria-label="المظهر" style={{ alignSelf: 'stretch', justifyContent: 'space-between' }}>
            {([['auto', 'تلقائي'], ['light', 'فاتح'], ['dark', 'غامق']] as [Theme, string][]).map(([v, t]) => (
              <button key={v} aria-pressed={theme === v} onClick={() => setTheme(v)} style={{ flex: 1 }}>{t}</button>
            ))}
          </div>
        </div>
      </aside>

      <main className="work">
        <header className="bar">
          <div>
            <div className="crumb ltr" style={{ textAlign: 'right' }}>{project ? `${project.brand} · ${project.title}` : ''}</div>
            <h1>{screen.title}</h1>
          </div>
          <span className="sp" />
          <button className="btn primary">{screen.primary}</button>
        </header>
        <div className="stack">
          {screen.sheets.map(s => (
            <section key={s.id} className={'sheet' + (s.id === selected ? ' sel' : '')} onClick={() => setSelected(s.id)} tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') setSelected(s.id); }}>
              <div className="sheet-k">{s.kind}</div>
              <h2>{s.title}</h2>
              <div style={{ marginTop: 10 }}>{s.body}</div>
            </section>
          ))}
        </div>
      </main>

      <aside className="inspector" aria-label={panel === 'assistant' ? 'المساعد' : 'المفتش'}>
        <div className="ins-h">
          <div className="seg" role="tablist">
            <button aria-pressed={panel === 'inspector'} onClick={() => setPanel('inspector')}>المفتش</button>
            <button aria-pressed={panel === 'assistant'} onClick={() => setPanel('assistant')}>المساعد</button>
          </div>
        </div>
        {panel === 'inspector' ? <Inspector sheet={sheet} /> : <Assistant sheet={sheet} screen={screen} />}
      </aside>

      {palette && <Palette commands={commands} onClose={() => setPalette(false)} />}
    </div>
  );
}

function Inspector({ sheet }: { sheet: Sheet | null }) {
  if (!sheet) return <div className="ins-b"><p className="mute" style={{ margin: 0 }}>اختار ورقة عشان تشوف تفاصيلها هنا.</p></div>;
  return (
    <div className="ins-b">
      <div><div className="sheet-k">{sheet.kind}</div><b style={{ fontSize: 15 }}>{sheet.title}</b></div>
      <div className="rows">
        {sheet.inspect.map(i => <div className="row" key={i.label}><span className="mute">{i.label}</span><span className="v" style={{ color: 'var(--ink)' }}>{i.value}</span></div>)}
      </div>
    </div>
  );
}

function Assistant({ sheet, screen }: { sheet: Sheet | null; screen: Screen }) {
  return (
    <div className="assistant">
      <div className="ins-b" style={{ paddingBottom: 8 }}>
        <div className="sheet-k">شايف دلوقتي</div>
        <div className="ctx"><span className="pill">{screen.title}</span>{sheet && <span className="pill">{sheet.title}</span>}</div>
      </div>
      <div className="msgs">
        <div className="msg">أي أمر هقترحه هيطلع هنا كزرار موافقة، ومش هيتنفذ غير لما تدوس عليه.</div>
        <div className="proposal">
          <span className="sheet-k" style={{ margin: 0 }}>مثال على اقتراح</span>
          <span>حلّل BPM من الملف النهائي وسجّل النتيجة كـ «غير معتمد».</span>
          <div style={{ display: 'flex', gap: 8 }}><button className="btn" disabled>وافق</button><button className="btn ghost" disabled>لأ</button></div>
        </div>
      </div>
      <div className="compose"><textarea placeholder="المساعد يتوصل في الخطوة ٦" disabled rows={1} /></div>
    </div>
  );
}

function Palette({ commands, onClose }: { commands: Cmd[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = commands.filter(c => c.label.includes(q.trim()));
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => setI(0), [q]);
  const run = (c?: Cmd) => { if (c) { c.run(); onClose(); } };
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="الأوامر" onMouseDown={e => e.stopPropagation()}>
        <input ref={input} value={q} onChange={e => setQ(e.target.value)} placeholder="اكتب أمر…"
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setI(x => Math.min(x + 1, list.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setI(x => Math.max(x - 1, 0)); }
            if (e.key === 'Enter') run(list[i]);
          }} />
        {list.length ? (
          <ul role="listbox">
            {list.map((c, n) => (
              <li key={c.id} role="option" aria-selected={n === i} onMouseEnter={() => setI(n)} onClick={() => run(c)}>
                <Icon name={c.icon} />{c.label}{c.key && <span className="k kbd">{c.key}</span>}
              </li>
            ))}
          </ul>
        ) : <div className="none">مفيش أمر بالاسم ده.</div>}
      </div>
    </div>
  );
}
