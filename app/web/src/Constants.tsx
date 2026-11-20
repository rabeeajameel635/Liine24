// الثوابت: the @ references, at two levels — for the whole film (Donia and her fixed props) and per place (corridor, tower, room).
// A locked reference is never edited: «نسخة جديدة» writes a new version, the old one stays, and only an approved version is used.
import { useEffect, useState } from 'react';
import { MapPin, X, Plus, Lock } from '@phosphor-icons/react';
import { PageHead, Card, Details, toast } from './ui.tsx';
import { arNum } from './Songs.tsx';
import { SCOPE, type RefInfo } from './Refs.tsx';
import { api, type Asset } from './api.ts';

type Version = { version: number; assets: string[]; text_en: string | null; note_ar: string | null; element_id: string | null; created_at: string; approved_at: string | null };
type Full = RefInfo & { current_version: number; approved_version: number | null; versions: Version[]; element_id: string | null };

const status = (r: RefInfo & { current_version?: number }) => r.pending_version && r.locked ? `فيه نسخة ${arNum(r.pending_version)} مستنية` : r.locked ? 'مقفول' : 'مستني اعتمادك';

export function ConstantsPage() {
  const [refs, setRefs] = useState<RefInfo[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = () => fetch('/api/refs').then(r => r.json()).then(d => setRefs(d.refs));
  useEffect(() => { load(); }, []);
  const film = refs?.filter(r => r.scope === 'film') ?? [], place = refs?.filter(r => r.scope === 'place') ?? [], assets = refs?.filter(r => r.scope === 'asset') ?? [];
  return (
    <div className="work"><div className="scroll"><div className="stack">
      <PageHead title="الثوابت" line="اكتب @الاسم في أي برومبت" />
      <div className="section-h"><h2>للفيلم كله</h2></div>
      <div className="const-cards">{film.map(r => <Card key={r.handle} img={r.assets.find(a => !a.blocked)?.thumb} title={`@${r.handle}`} line={status(r)} onClick={() => setOpen(r.handle)} />)}</div>
      <div className="section-h"><h2>للمكان</h2></div>
      <div className="const-cards">{place.map(r => r.assets[0]?.thumb
        ? <Card key={r.handle} img={r.assets[0].thumb} title={`@${r.handle}`} line={status(r)} onClick={() => setOpen(r.handle)} />
        : <div key={r.handle} className="card tap place-card" role="button" tabIndex={0} onClick={() => setOpen(r.handle)}><span className="card-ico"><MapPin size={30} /></span><div className="card-body"><div className="card-text"><h2>@{r.handle}</h2><p>{r.text_en ? status(r) : 'ناقص'}</p></div></div></div>)}
      </div>
      <Details label={`صور المكتبة ${arNum(assets.length)}`}>
        <div className="handle-grid">{assets.map(r => <button key={r.handle} className="handle-chip" onClick={() => setOpen(r.handle)}>{r.assets[0]?.thumb && <img src={r.assets[0].thumb} alt="" />}<span>@{r.handle}</span>{r.locked && <Lock size={16} weight="fill" />}</button>)}</div>
      </Details>
      {open && <RefSheet handle={open} onClose={() => { setOpen(null); load(); }} />}
    </div></div></div>
  );
}

function RefSheet({ handle, onClose }: { handle: string; onClose: () => void }) {
  const [r, setR] = useState<Full | null>(null);
  const [edit, setEdit] = useState<{ text_en: string; note_ar: string; assets: string[] } | null>(null);
  const [lib, setLib] = useState<Record<string, Asset>>({});
  const [adding, setAdding] = useState(false);
  const load = () => fetch(`/api/refs/${encodeURIComponent(handle)}`).then(x => x.json()).then(setR);
  useEffect(() => { load(); api.assets('all').then(d => setLib(Object.fromEntries(d.items.map(a => [a.id, a])))); }, [handle]);
  if (!r) return null;
  const cur = r.versions.find(v => v.version === (r.approved_version ?? r.current_version))!;
  const approve = async (version: number) => {
    const x = await fetch(`/api/refs/${encodeURIComponent(handle)}/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version }) });
    if (x.ok) { toast(`@${handle} · نسخة ${arNum(version)} اتعتمدت`); load(); }
  };
  const save = async () => {
    const x = await fetch(`/api/refs/${encodeURIComponent(handle)}/versions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text_en: edit!.text_en || null, note_ar: edit!.note_ar || null, assets: edit!.assets }) });
    const d = await x.json(); if (x.ok) { toast(`نسخة ${arNum(d.version)} اتعملت · مستنية اعتمادك`); setEdit(null); load(); } else toast(d.what);
  };
  const pic = (id: string) => lib[id]?.thumb;
  return (
    <div className="seg-sheet-wrap" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="seg-sheet" role="dialog" aria-label={`@${handle}`}>
        <div className="grab" />
        <header className="ss-head">
          <div className="ph-text"><h1>@{handle}</h1><p>{SCOPE[r.scope]} · {status(r)}</p></div>
          <button className="gbtn icon soft" onClick={onClose} aria-label="اقفل"><X size={24} /></button>
        </header>
        {!edit ? <>
          <div className="ref-pics big">{cur.assets.length ? cur.assets.map(id => <figure key={id} className={lib[id]?.no_generation ? 'off' : ''}>{pic(id) && <img src={pic(id)!} alt="" />}{lib[id]?.no_generation && <span className="off-tag">مش بيتبعت</span>}</figure>) : <span className="panel-line">لسه ملوش صورة</span>}</div>
          {cur.note_ar && <p className="panel-line">{cur.note_ar}</p>}
          {(cur.text_en || cur.element_id) && <Details label="بيتكتب في البرومبت">{cur.text_en && <div className="prompt ltr">{cur.text_en}</div>}{cur.element_id && <p className="ltr">Higgsfield element · Donia-Final</p>}</Details>}
          <div className="section-h"><h2>النسخ</h2></div>
          <div className="versions-list">
            {r.versions.map(v => <div key={v.version} className="ver-row">
              <b>نسخة {arNum(v.version)}</b>
              <span>{v.version === r.approved_version ? 'المستخدمة' : v.approved_at ? 'اتعتمدت قبل كده' : 'مستنية اعتمادك'}</span>
              {v.version !== r.approved_version && <button className={v.approved_at ? 'gbtn soft' : 'gbtn primary'} onClick={() => approve(v.version)}>{v.approved_at ? 'ارجع لها' : 'اعتمد'}</button>}
            </div>)}
          </div>
          <button className="gbtn secondary" onClick={() => { const v = r.versions[0]; setEdit({ text_en: v.text_en ?? '', note_ar: v.note_ar ?? '', assets: v.assets }); }}>نسخة جديدة</button>
          {r.locked && <p className="panel-line">المقفول ما بيتعدلش: التعديل بيعمل نسخة جديدة، والقديمة بتفضل محفوظة.</p>}
        </> : <>
          <div className="section-h"><h2>الصور</h2><span>بالترتيب</span></div>
          <div className="ref-pics big">
            {edit.assets.map((id, i) => <figure key={id}>{pic(id) && <img src={pic(id)!} alt="" />}<span className="slot-n">{arNum(i + 1)}</span>
              <button className="fig-x" aria-label="شيل" onClick={() => setEdit({ ...edit, assets: edit.assets.filter(x => x !== id) })}><X size={18} /></button></figure>)}
            <button className="slot add" onClick={() => setAdding(a => !a)}><Plus size={28} /><span>ضيف</span></button>
          </div>
          {adding && <div className="pick-grid">{Object.values(lib).filter(a => a.kind === 'image' && !edit.assets.includes(a.id)).map(a =>
            <button key={a.id} className="tile loaded" onClick={() => { setEdit({ ...edit, assets: [...edit.assets, a.id] }); setAdding(false); }} aria-label={a.label ?? ''}>{a.thumb && <img src={a.thumb} alt="" />}</button>)}</div>}
          <div className="section-h"><h2>الوصف</h2><span>بيتكتب في البرومبت</span></div>
          <textarea className="pw-partial ltr" rows={5} value={edit.text_en} onChange={e => setEdit({ ...edit, text_en: e.target.value })} placeholder="English description sent with the reference" />
          <textarea className="notes" rows={2} value={edit.note_ar} onChange={e => setEdit({ ...edit, note_ar: e.target.value })} placeholder="ملاحظة ليك" />
          <div className="row-btns"><button className="gbtn primary" onClick={save}>احفظ نسخة جديدة</button><button className="gbtn soft" onClick={() => setEdit(null)}>إلغاء</button></div>
        </>}
      </section>
    </div>
  );
}
