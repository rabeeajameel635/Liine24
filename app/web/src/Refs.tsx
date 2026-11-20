// @ references in the segment sheet: typing @ suggests handles, recognised ones show under the prompt,
// and «المراجع» lists exactly what goes to the generator, in its order.
import { useEffect, useRef, useState } from 'react';
import { Warning, CheckCircle, Lock } from '@phosphor-icons/react';

export type RefInfo = { handle: string; scope: 'film' | 'place' | 'asset'; kind: string; title_ar: string; locked: boolean; pending_version: number | null; assets: { id: string; thumb: string | null; blocked: boolean }[]; text_en: string | null; note_ar: string | null };
export type Resolved = { handle: string; scope: RefInfo['scope']; kind: string; title_ar: string; version: number | null; pending: boolean;
  images: { id: string; label: string | null; thumb: string | null; n: number }[]; blocked: { id: string; label: string | null }[]; text_en: string | null; how: string; warn: string[] };
export type Resolution = { tool: string; family: string; refs: Resolved[]; unknown: string[]; prompt_out: string; files: { n: number; asset: string; label: string | null }[]; problems: string[]; notes: string[] };

const ar = (t: string) => t.replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);

export const SCOPE: Record<RefInfo['scope'], string> = { film: 'ثابت للفيلم', place: 'ثابت للمكان', asset: 'من المكتبة' };

export function useRefs() {
  const [refs, setRefs] = useState<RefInfo[]>([]);
  useEffect(() => { fetch('/api/refs').then(r => r.json()).then(d => setRefs(d.refs)); }, []);
  return refs;
}

/** Server-side resolution of the prompt for one tool (debounced). The kit uses the very same function. */
export function useResolution(prompt: string, tool: string) {
  const [res, setRes] = useState<Resolution | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      fetch('/api/refs/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, tool }) }).then(r => r.json()).then(setRes).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [prompt, tool]);
  return res;
}

/** Prompt box with @ suggestions. */
export function PromptBox({ value, onChange, placeholder, refs, res }: { value: string; onChange: (v: string) => void; placeholder: string; refs: RefInfo[]; res: Resolution | null }) {
  const box = useRef<HTMLTextAreaElement>(null);
  const [q, setQ] = useState<string | null>(null);
  const scan = (el: HTMLTextAreaElement) => { const m = el.value.slice(0, el.selectionStart).match(/@([\p{L}\p{M}0-9-]*)$/u); setQ(m ? m[1] : null); };
  const bare = (s: string) => s.replace(/[ً-ٰٟـ]/g, '');
  const list = q == null ? [] : refs.filter(r => r.scope !== 'asset' || q.length > 0).filter(r => bare(r.handle).includes(bare(q)))
    .sort((a, b) => Number(bare(b.handle).startsWith(bare(q))) - Number(bare(a.handle).startsWith(bare(q))) || ({ film: 0, place: 1, asset: 2 }[a.scope] - { film: 0, place: 1, asset: 2 }[b.scope])).slice(0, 8);
  const pick = (h: string) => {
    const el = box.current!; const at = el.selectionStart; const before = el.value.slice(0, at).replace(/@([\p{L}\p{M}0-9-]*)$/u, `@${h} `);
    const next = before + el.value.slice(at); onChange(next); setQ(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(before.length, before.length); });
  };
  return (
    <div className="prompt-box">
      <textarea ref={box} className="pw-partial" dir="auto" value={value} placeholder={placeholder} rows={5}
        onChange={e => { onChange(e.target.value); scan(e.target); }} onKeyUp={e => scan(e.currentTarget)} onClick={e => scan(e.currentTarget)}
        onKeyDown={e => { if (list.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pick(list[0].handle); } if (e.key === 'Escape' && list.length) { e.preventDefault(); e.stopPropagation(); setQ(null); } }} />
      {list.length > 0 && <div className="at-list" role="listbox" aria-label="المراجع">
        {list.map(r => <button key={r.handle} role="option" className="at-item" onMouseDown={e => { e.preventDefault(); pick(r.handle); }}>
          {r.assets[0]?.thumb ? <img src={r.assets[0].thumb} alt="" /> : <span className="at-ico">@</span>}
          <b>@{r.handle}</b><span>{SCOPE[r.scope]}</span></button>)}
      </div>}
      {res && (res.refs.length > 0 || res.unknown.length > 0) && <div className="at-found">
        {res.refs.map(r => <span key={r.handle} className={'at-chip' + (r.warn.length ? ' warn' : '')}>{r.warn.length ? <Warning size={18} weight="fill" /> : <CheckCircle size={18} weight="fill" />}@{r.handle}</span>)}
        {res.unknown.map(u => <span key={u} className="at-chip bad"><Warning size={18} weight="fill" />@{u}</span>)}
      </div>}
    </div>
  );
}

/** «المراجع»: what goes with this segment, numbered in the generator's order. */
export function RefsList({ res, toolName }: { res: Resolution | null; toolName: string }) {
  if (!res) return null;
  if (!res.refs.length) return <p className="panel-line">اكتب @ في البرومبت عشان تضيف مرجع</p>;
  return (
    <div className="ref-list">
      <p className="panel-line">بيتبعت لـ <b className="ltr">{toolName}</b> بالترتيب ده</p>
      {res.refs.map(r => (
        <div key={r.handle} className={'ref-row' + (r.warn.length ? ' warn' : '')}>
          <div className="ref-pics">
            {r.images.length ? r.images.map(im => <figure key={im.id}>{im.thumb && <img src={im.thumb} alt="" />}{im.n > 0 && <span className="slot-n">{im.n.toLocaleString('ar-EG')}</span>}</figure>)
              : <span className="ref-text">نص</span>}
          </div>
          <div className="ref-main">
            <b>@{r.handle}</b>
            <span className="ref-meta">{SCOPE[r.scope]}{r.version ? <> · <Lock size={16} weight="fill" /> نسخة {r.version.toLocaleString('ar-EG')}</> : ''}</span>
            <span className="ref-how">{ar(r.how)}</span>
            {r.warn.map(w => <span key={w} className="ref-warn"><Warning size={18} weight="fill" /> {w}</span>)}
            {r.blocked.length > 0 && <span className="ref-off">{r.blocked.map(b => b.label).join('، ')}: مش بيتبعت</span>}
          </div>
        </div>
      ))}
      {res.unknown.map(u => <div key={u} className="ref-row warn"><div className="ref-main"><b>@{u}</b><span className="ref-warn"><Warning size={18} weight="fill" /> مش معروف</span></div></div>)}
      {res.notes.map(n => <p key={n} className="panel-line">{ar(n)}</p>)}
    </div>
  );
}
