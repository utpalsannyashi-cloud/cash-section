import { formatCurrency } from '@/utils/currency';
import type { Settlement } from '@/types';

export function SettlementSummary({
  settlements,
  currency,
  canMarkPaid,
  onTogglePaid
}: {
  settlements: Settlement[];
  currency: string;
  canMarkPaid: (s: Settlement) => boolean;
  onTogglePaid: (s: Settlement) => void;
}) {
  if (settlements.length === 0) {
    return (
      <div className="receipt-card p-6 text-center">
        <p className="text-sm text-ink-soft">Everyone's even. Nothing to settle.</p>
      </div>
    );
  }

  return (
    <div className="receipt-card overflow-hidden">
      <div className="p-4 border-b border-dashed border-rule">
        <p className="label-eyebrow">Settle up</p>
      </div>
      <ul>
        {settlements.map((s) => (
          <li key={s.id} className="p-4 border-b border-rule last:border-b-0 flex items-center justify-between">
            <div className="ledger-row flex-1">
              <span className={`text-sm ${s.is_paid ? 'line-through text-ink-faint' : 'text-ink'}`}>
                @{s.from_profile?.username}
              </span>
              <span className="text-ink-faint text-xs">owes</span>
              <span className={`text-sm ${s.is_paid ? 'line-through text-ink-faint' : 'text-ink'}`}>
                @{s.to_profile?.username}
              </span>
              <span className="ledger-fill" />
              <span className={`ledger-amount text-sm ${s.is_paid ? 'text-ink-faint' : 'text-brick'}`}>
                {formatCurrency(s.amount, currency)}
              </span>
            </div>
            {canMarkPaid(s) ? (
              <button
                onClick={() => onTogglePaid(s)}
                className={`ml-3 text-[11px] font-mono uppercase tracking-wide px-2 py-1 rounded shrink-0 ${
                  s.is_paid ? 'bg-ink/5 text-ink-faint' : 'bg-emerald-light text-emerald-dark'
                }`}
              >
                {s.is_paid ? 'Paid' : 'Mark paid'}
              </button>
            ) : (
              <span
                className={`ml-3 text-[11px] font-mono uppercase tracking-wide px-2 py-1 rounded shrink-0 ${
                  s.is_paid ? 'bg-ink/5 text-ink-faint' : 'bg-brick-light text-brick'
                }`}
              >
                {s.is_paid ? 'Paid' : 'Pending'}
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="receipt-tear" />
    </div>
  );
}
