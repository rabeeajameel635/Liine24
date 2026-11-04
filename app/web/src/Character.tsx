// بطاقة الشخصية — portrait hero, constants with suggested palette, looks, references (≤20), identity, modesty, forbidden, locked text.
import { useEffect, useState } from 'react';
import { Prohibit, ShieldCheck, Sneaker, Sparkle, ScanSmiley } from '@phosphor-icons/react';
import { Status, toast } from './ui.tsx';

type Ref = { id: string; label: string | null; role: string | null; locked: boolean; approved: boolean; thumb: string; src: string; palette: string[] | null };
type Piece = { id: string; name: string; hex: string[]; approved: boolean; crop: string };
type Card = {
  id: string; name: string; brand: string; line: string; version: number; approved: boolean; locked_text: string; modesty: string; voice: string | null;
  wardrobe: { reference?: string; sheet?: string; looks?: string[]; constants?: string[] }; forbidden: string[];
  identity: { baseline: number | null; threshold: number; model: string | null }; refs: Ref[];
};

export function CharacterScreen({ id = 'donia' }: { id?: string }) {
  const [c, setC] = useState<Card | null>(null);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [zoom, setZoom] = useState<Piece | null>(null);
  useEffect(() => { fetch(`/api/characters/${id}`).then(r => r.json()).then(setC); fetch(`/api/characters/${id}/pieces`).then(r => r.json()).then(d => setPieces(d.pieces)); }, [id]);
  const approvePiece = async (p: Piece) => { await fetch(`/api/pieces/${p.id}/approve`, { method: 'POST' }); setPieces(ps => ps.map(x => x.id === p.id ? { ...x, approved: true } : x)); toast(`${p.name}: الألوان اتقفلت`); };
  if (!c) return <div className="work"><div className="hero"><div className="hero-art" /></div></div>;

  const hair = c.refs.find(r => r.label?.includes('المشبك'));
  const shoe = c.refs.find(r => r.label === 'الجزمة');
  const jacket = c.refs.find(r => r.label === 'الجاكيت');
  const looks = (c.wardrobe.looks ?? []).map(l => c.refs.find(r => r.label === l)).filter(Boolean) as Ref[];
  const approve = async () => { await fetch(`/api/characters/${id}/approve`, { method: 'POST' }); setC({ ...c, approved: true }); toast('البطاقة اتعتمدت'); };

  return (
    <div className="work">
      <div className="hero char">
        <div className="char-top">
          <div className="portrait" style={{ backgroundImage: hair ? `url(${hair.src})` : undefined }} role="img" aria-label={c.name} />
          <div className="char-id">
            <h1>{c.name}</h1>
            <p className="mute ltr" style={{ textAlign: 'right' }}>{c.brand} · Donia-Final · v{c.version}</p>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
              <Status kind={c.approved ? 'ok' : 'wait'} />
              {!c.approved && <button className="gbtn primary" style={{ height: 44 }} onClick={approve}>اعتمد البطاقة</button>}
            </div>
            <div className="consts">
              <Const img={shoe} icon={<Sneaker size={22} />} text="نفس اللوفر الأبيض" />
              <Const img={hair} icon={<Sparkle size={22} />} text="مشبك «سِرّ» القرمزي" />
              <Const icon={<Prohibit size={22} />} text="من غير مجوهرات" />
            </div>
          </div>
        </div>

        <section className="band">
          <h2>اللوكات</h2>
          <div className="looks">
            {looks.map(l => <figure key={l.id}><img src={l.thumb} alt="" /><figcaption className="ltr">{l.label}</figcaption></figure>)}
          </div>
        </section>

        <section className="band">
          <h2>المراجع <small>{c.refs.length}/٢٠</small></h2>
          <div className="refs">
            {c.refs.map(r => (
              <figure key={r.id}>
                <img src={r.thumb} alt="" />
                <figcaption>{r.label ?? 'مرجع'}{r.locked && ' · مقفول'}</figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="band">
          <h2>الألوان <small>من القطعة نفسها</small></h2>
          <div className="pieces">
            {pieces.map(p => (
              <div key={p.id} className="piece">
                <img src={p.crop} alt="" onClick={() => setZoom(p)} />
                <div className="piece-body">
                  <b>{p.name}</b>
                  <div className="hexes">{p.hex.map((h, i) => <span key={h + i} className="hex"><i style={{ background: h }} /><code className="ltr">{h}</code><small>{['الأساسي', 'الظل', 'النور'][i]}</small></span>)}</div>
                  {p.approved ? <Status kind="ok" label="مقفول" /> : <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Status kind="wait" /><button className="gbtn sm-btn" onClick={() => approvePiece(p)}>اعتمد</button></div>}
                </div>
              </div>
            ))}
          </div>
        </section>

        {zoom && (
          <div className="zoom-wrap" onClick={() => setZoom(null)} role="dialog" aria-label={zoom.name}>
            <div className="zoom-card glass-strong" onClick={e => e.stopPropagation()}>
              <img src={`${zoom.crop}?size=large`} alt="" />
              <div className="zoom-sw">
                <b style={{ fontSize: 20 }}>{zoom.name}</b>
                {zoom.hex.map((h, i) => <span key={h + i} className="hex"><i style={{ background: h }} /><code className="ltr">{h}</code><small>{['الأساسي · نور متوسط', 'الظل', 'النور'][i]}</small></span>)}
                <button className="gbtn" onClick={() => setZoom(null)}>اقفل</button>
              </div>
            </div>
          </div>
        )}

        <section className="band two">
          <div className="tile-card">
            <ScanSmiley size={26} />
            <h3>تطابق الوش</h3>
            <span className="big-num" style={{ fontSize: 44 }}>٩٥٪</span>
            <span className="mute">من خط الأساس</span>
            <Status kind="wait" label="النموذج مستني موافقتك" />
          </div>
          <div className="tile-card">
            <ShieldCheck size={26} />
            <h3>الاحتشام</h3>
            <p>{c.modesty}</p>
          </div>
          <div className="tile-card">
            <Prohibit size={26} />
            <h3>ممنوع</h3>
            <div className="chips">{c.forbidden.map(f => <span key={f} className="pill">{f}</span>)}</div>
          </div>
        </section>

        <section className="band">
          <h2>الوصف المقفول</h2>
          <div className="prompt" style={{ fontSize: 15 }}>{c.locked_text}</div>
        </section>
      </div>
    </div>
  );
}

function Const({ img, icon, text }: { img?: Ref; icon: React.ReactNode; text: string }) {
  return (
    <div className="const glass">
      {img ? <img src={img.thumb} alt="" /> : <span className="ico">{icon}</span>}
      <span>{text}</span>
    </div>
  );
}
