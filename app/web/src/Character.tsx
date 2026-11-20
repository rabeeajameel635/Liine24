// بطاقة الشخصية — portrait hero, constants with suggested palette, looks, references (≤20), identity, modesty, forbidden, locked text.
import { useEffect, useState } from 'react';
import { LockSimple } from '@phosphor-icons/react';
import { Status, toast, PageHead, Card, Details } from './ui.tsx';
import { arNum } from './Songs.tsx';

type Ref = { id: string; label: string | null; role: string | null; locked: boolean; approved: boolean; thumb: string; src: string; palette: string[] | null };
type Piece = { id: string; name: string; hex: string[]; approved: boolean; crop: string };
type Card = {
  id: string; name: string; brand: string; line: string; version: number; approved: boolean; locked_text: string; modesty: string; voice: string | null;
  wardrobe: { reference?: string; sheet?: string; looks?: string[]; constants?: string[] }; forbidden: string[];
  identity: { baseline: number | null; threshold: number; model: string | null }; refs: Ref[];
};

const LOOK: Record<string, string> = { Departure: 'الرحيل', Fame: 'الشهرة', Love: 'الحب' };

export function CharacterScreen({ id = 'donia' }: { id?: string }) {
  const [c, setC] = useState<Card | null>(null);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [zoom, setZoom] = useState<Piece | null>(null);
  useEffect(() => { fetch(`/api/characters/${id}`).then(r => r.json()).then(setC); fetch(`/api/characters/${id}/pieces`).then(r => r.json()).then(d => setPieces(d.pieces)); }, [id]);
  const approvePiece = async (p: Piece) => { await fetch(`/api/pieces/${p.id}/approve`, { method: 'POST' }); setPieces(ps => ps.map(x => x.id === p.id ? { ...x, approved: true } : x)); toast('الألوان اتقفلت'); };
  if (!c) return <div className="work" />;

  const hair = c.refs.find(r => r.label?.includes('المشبك'));
  const shoe = c.refs.find(r => r.label === 'الجزمة');
  const looks = (c.wardrobe.looks ?? []).map(l => c.refs.find(r => r.label === l)).filter(Boolean) as Ref[];
  const approve = async () => { await fetch(`/api/characters/${id}/approve`, { method: 'POST' }); setC({ ...c, approved: true }); toast('البطاقة اتعتمدت'); };

  const PART = (p: Piece) => p.hex.length === 2 ? ['الأساسي', 'ظل القطيفة'] : ['الأساسي', 'الظل', 'النور'];
  return (
    <div className="work"><div className="scroll"><div className="stack">
      <PageHead title={c.name} line={c.approved ? 'الشخصية المعتمدة للكليب' : 'مستنية اعتمادك'}
        action={c.approved ? <Status kind="ok" /> : <button className="gbtn primary" onClick={approve}>اعتمد</button>} />
      <div className="portrait" style={{ backgroundImage: hair ? `url(${hair.src})` : undefined }} role="img" aria-label={c.name} />

      <div className="section-h"><h2>الثوابت</h2></div>
      <div className="const-grid">
        <Card img={shoe?.thumb} title="اللوفر الأبيض" />
        <Card img={hair?.thumb} title="مشبك «سِرّ»" />
        <Card img={looks[1]?.thumb ?? looks[0]?.thumb} title="من غير مجوهرات" />
      </div>

      <div className="section-h"><h2>اللوكات</h2><span>{arNum(looks.length)}</span></div>
      <div className="h-scroll">{looks.map((l, i) => <figure key={l.id} className="look"><img src={l.thumb} alt="" /><figcaption>{LOOK[l.label?.split(' ')[0] ?? ''] ?? `لوك ${arNum(i + 1)}`}</figcaption></figure>)}</div>

      <div className="section-h"><h2>المراجع</h2><span>{arNum(c.refs.length)} من ٢٠</span></div>
      <div className="h-scroll">{c.refs.map(r => <figure key={r.id} className="ref"><img src={r.thumb} alt="" />{r.locked && <span className="ref-lock"><LockSimple size={18} weight="fill" /></span>}</figure>)}</div>

      <div className="section-h"><h2>الألوان</h2></div>
      {pieces.map(p => (
        <Card key={p.id} title={p.name} line={p.approved ? 'مقفولة' : 'مستنية اعتمادك'} onClick={() => setZoom(p)}
          action={p.approved ? <span className="swatches">{p.hex.map((h, i) => <i key={h + i} style={{ background: h }} />)}</span> : <button className="gbtn secondary" onClick={() => approvePiece(p)}>اعتمد</button>} />
      ))}

      <Card title="تطابق الوش" line="٩٥٪ · خط الأساس جاهز" />
      <Card title="الاحتشام" line="الصدر والضهر مغطيين">
        <div className="card-more"><Details><p>{c.modesty}</p></Details></div>
      </Card>
      <Card title="الوصف المقفول" line="بيتحط في كل برومبت">
        <div className="card-more"><Details><div className="prompt ltr">{c.locked_text}</div>{c.forbidden.length > 0 && <p>ممنوع: {c.forbidden.join('، ')}</p>}</Details></div>
      </Card>

      {zoom && (
        <div className="zoom-wrap" onClick={() => setZoom(null)} role="dialog" aria-label={zoom.name}>
          <div className="zoom-card glass-strong" onClick={e => e.stopPropagation()}>
            <img src={`${zoom.crop}?size=large`} alt="" />
            <div className="zoom-sw">
              <h2>{zoom.name}</h2>
              {zoom.hex.map((h, i) => <span key={h + i} className="hex"><i style={{ background: h }} /><span>{PART(zoom)[i]}</span></span>)}
              <Details><p className="ltr">{zoom.hex.join(' · ')}</p></Details>
              <button className="gbtn soft" onClick={() => setZoom(null)}>اقفل</button>
            </div>
          </div>
        </div>
      )}
    </div></div></div>
  );
}
