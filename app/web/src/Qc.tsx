// الفحص: the score (the weakest check), one line saying why, and each check. It only recommends — «اعتمد» stays yours.
import { useEffect, useState } from 'react';
import { CheckCircle, Warning, Clock, MinusCircle, ArrowClockwise } from '@phosphor-icons/react';

export type Check = { key: string; label: string; state: 'pass' | 'fail' | 'na' | 'pending' | 'error'; score: number | null; line: string };
export type Qc = { score: number | null; status: 'pass' | 'redo' | 'pending'; reason: string; checks: Check[]; created_at?: string; vision_cached?: number | boolean };
export const QC_LABEL: Record<Qc['status'], string> = { pass: 'معدّي', redo: 'محتاج إعادة', pending: 'ناقص فحص' };
const ar = (n: number) => n.toLocaleString('ar-EG');

export function useQc(assetId: string) {
  const [qc, setQc] = useState<Qc | null>(null); const [busy, setBusy] = useState(false); const [today, setToday] = useState<number | null>(null);
  useEffect(() => { setQc(null); fetch(`/api/assets/${assetId}/qc`).then(r => r.json()).then(d => { setQc(d.qc); setToday(d.vision_today); }); }, [assetId]);
  // «افحص تاني» = a new paid look on purpose
  const rerun = async () => { setBusy(true); const r = await fetch(`/api/assets/${assetId}/qc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ force: true }) }).then(r => r.json()).catch(() => null); setBusy(false); if (r?.qc) { setQc(r.qc); setToday(r.vision_today); } };
  return { qc, busy, rerun, today };
}

export function QcChip({ qc }: { qc: Qc | null }) {
  if (!qc) return null;
  return <span className={'qc-chip ' + qc.status} title={QC_LABEL[qc.status]}>{qc.score != null ? ar(qc.score) : '—'}</span>;
}

const ICON = { pass: CheckCircle, fail: Warning, na: MinusCircle, pending: Clock, error: Warning } as const;

export function QcCard({ qc, busy, rerun, today }: { qc: Qc | null; busy: boolean; rerun: () => void; today?: number | null }) {
  return (
    <section className={'qc-card ' + (qc?.status ?? 'none')}>
      <div className="qc-head">
        <div className="qc-score">{qc?.score != null ? ar(qc.score) : '—'}<small>{qc?.status === 'pending' ? 'من غير الوش' : 'من ١٠٠'}</small></div>
        <div className="qc-text">
          <b>{qc ? QC_LABEL[qc.status] : 'لسه ما اتفحصش'}</b>
          <p>{qc ? qc.reason : 'الفحص بيرشّح بس، وإنت اللي بتعتمد'}</p>
        </div>
        <button className="gbtn icon soft" onClick={rerun} disabled={busy} aria-label="افحص تاني" title="افحص تاني"><ArrowClockwise size={22} className={busy ? 'spin' : ''} /></button>
      </div>
      {qc && <ul className="qc-list">{qc.checks.map(c => { const I = ICON[c.state]; return (
        <li key={c.key + c.label} className={c.state}><I size={20} weight={c.state === 'pass' || c.state === 'fail' ? 'fill' : 'regular'} /><b>{c.label}</b><span>{c.line}</span>{c.score != null && c.state !== 'pass' && <em>{ar(c.score)}</em>}</li>
      ); })}</ul>}
      <details className="details qc-more"><summary>تفاصيل</summary><div className="details-body">
        <p>الفحص البصري النهارده: {ar(today ?? 0)}</p>
        {qc && <p>{qc.vision_cached ? 'الفحص البصري هنا من مرة سابقة لنفس الملف (ببلاش)' : 'الفحص البصري اتعمل للملف ده'}</p>}
        <p>الدقة والإيقاع والوش بيتعملوا كل مرة. ↻ بيعيد الفحص البصري بفلوس.</p>
      </div></details>
    </section>
  );
}
