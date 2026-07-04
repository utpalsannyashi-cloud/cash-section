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
          <li key={s.id} className="p-4 border-b border-rule last:border-b-0 flex items-center gap-3">
            <span className="avatar-circle shrink-0">{s.from_profile?.username?.charAt(0)}</span>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium flex items-center gap-1.5 ${s.is_paid ? 'line-through text-ink-faint' : 'text-ink'}`}>
                <span className="truncate">@{s.from_profile?.username}</span>
                <span className="text-ink-faint text-xs shrink-0">→</span>
                <span className="truncate">@{s.to_profile?.username}</span>
              </p>
              <p className={`font-mono text-xs mt-0.5 ${s.is_paid ? 'text-ink-faint' : 'text-amber'}`}>
                {formatCurrency(s.amount, currency)}
              </p>
            </div>
            {canMarkPaid(s) ? (
              <button
                onClick={() => onTogglePaid(s)}
                className={`status-pill shrink-0 ${
                  s.is_paid ? 'bg-ink/5 text-ink-faint' : 'bg-emerald-light text-emerald-dark'
                }`}
              >
                {s.is_paid ? 'Paid' : 'Mark paid'}
              </button>
            ) : (
              <span
                className={`status-pill shrink-0 ${
                  s.is_paid ? 'bg-ink/5 text-ink-faint' : 'bg-amber-light text-amber'
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
