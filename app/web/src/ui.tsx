import { CheckCircle, WarningCircle, Clock } from '@phosphor-icons/react';
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
