import { CheckCircle, WarningCircle, Clock, CaretLeft } from '@phosphor-icons/react';
import type { Icon as PIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

/** ◔ running: progress ring. */
export function Ring({ value, size = 16 }: { value: number; size?: number }) {
  const r = size / 2 - 2, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="ring" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="2" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray={c} strokeDashoffset={c * (1 - value)} strokeLinecap="round" />
    </svg>
  );
}

export type StatusKind = 'ok' | 'run' | 'warn' | 'wait';
export function Status({ kind, label, progress = 0.4, iconOnly = false, size = 18 }: { kind: StatusKind; label?: string; progress?: number; iconOnly?: boolean; size?: number }) {
  const text = label ?? { ok: 'معتمد', run: 'شغّال', warn: 'محتاج نظرة', wait: 'مستني اعتمادك' }[kind];
  const icon = kind === 'ok' ? <CheckCircle size={size} weight="fill" /> : kind === 'warn' ? <WarningCircle size={size} weight="fill" />
    : kind === 'run' ? <Ring value={progress} size={size} /> : <Clock size={size} weight="regular" />;
  return <span className={'status ' + kind} title={text}>{icon}{!iconOnly && <span>{text}</span>}</span>;
}

let push: ((m: string) => void) | null = null;
export const toast = (m: string) => push?.(m);
export function Toaster() {
  const [msg, setMsg] = useState(''); const [on, setOn] = useState(false);
  useEffect(() => { let t: ReturnType<typeof setTimeout>; push = m => { setMsg(m); setOn(true); clearTimeout(t); t = setTimeout(() => setOn(false), 2400); }; return () => { push = null; }; }, []);
  return <div className={'toast glass-strong' + (on ? ' on' : '')} role="status" aria-live="polite">{msg}</div>;
}

// ---- shared building blocks for the type and word rules ----
// Page: title 40 bold + one grey line (≤ 6 words). Card: optional real image, title 28 bold (≤ 3 words), one line 19 grey (≤ 6 words), one action.
// Anything longer than a line goes inside <Details>, closed by default.

export function PageHead({ title, line, action }: { title: string; line?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <header className="page-head">
      <div className="ph-text"><h1>{title}</h1>{line && <p>{line}</p>}</div>
      {action && <div className="ph-action">{action}</div>}
    </header>
  );
}

export function Card({ img, imgAlt = '', imgClass, title, line, action, onClick, wide, children, className = '', ltrTitle }: {
  img?: string | null; imgAlt?: string; imgClass?: string; title: React.ReactNode; line?: React.ReactNode; action?: React.ReactNode; onClick?: () => void; wide?: boolean; children?: React.ReactNode; className?: string; ltrTitle?: boolean;
}) {
  const body = (
    <>
      {img && <div className="card-img"><img src={img} alt={imgAlt} loading="lazy" className={imgClass || undefined} /></div>}
      <div className="card-body">
        <div className="card-text"><h2 className={ltrTitle ? 'ltr' : undefined}>{title}</h2>{line && <p>{line}</p>}</div>
        {action && <div className="card-action" onClick={e => e.stopPropagation()}>{action}</div>}
      </div>
      {children}
    </>
  );
  const cls = 'card' + (wide ? ' wide' : '') + (onClick ? ' tap' : '') + (className ? ' ' + className : '');
  return onClick ? <div className={cls} role="button" tabIndex={0} onClick={onClick} onKeyDown={e => { if (e.key === 'Enter') onClick(); }}>{body}</div> : <section className={cls}>{body}</section>;
}

export function Details({ label = 'تفاصيل', children }: { label?: string; children: React.ReactNode }) {
  return <details className="details"><summary>{label}</summary><div className="details-body">{children}</div></details>;
}

export function Row({ icon: I, img, title, line, action, onClick }: { icon?: PIcon; img?: string | null; title: React.ReactNode; line?: React.ReactNode; action?: React.ReactNode; onClick?: () => void }) {
  return (
    <div className={'card card-row' + (onClick ? ' tap' : '')} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick} onKeyDown={e => { if (onClick && e.key === 'Enter') onClick(); }}>
      {img ? <img className="card-thumb" src={img} alt="" /> : I ? <span className="card-ico"><I size={30} /></span> : null}
      <div className="card-body">
        <div className="card-text"><h2>{title}</h2>{line && <p>{line}</p>}</div>
        <div className="card-action" onClick={e => e.stopPropagation()}>{action ?? (onClick ? <CaretLeft size={24} className="chev" /> : null)}</div>
      </div>
    </div>
  );
}

