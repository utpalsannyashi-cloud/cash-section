import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/utils/currency';
import type { Expense } from '@/types';

export function ExpenseCard({
  expense,
  currency,
  canManage,
  // True once this expense is at or before the group's settled_through
  // checkpoint (see GroupDashboard's "Start a fresh round") — struck
  // through so it reads as already cleared, the same visual language
  // SettlementSummary already uses for a paid transfer.
  settled = false,
  onEdit,
  onDelete
}: {
  expense: Expense;
  currency: string;
  canManage: boolean;
  settled?: boolean;
  onEdit: (expense: Expense) => void;
  onDelete: (id: string) => void;
}) {
  const [billUrl, setBillUrl] = useState<string | null>(null);
  const [loadingBill, setLoadingBill] = useState(false);

  const viewBill = async () => {
    if (!expense.attachment_path) return;
    if (billUrl) {
      window.open(billUrl, '_blank');
      return;
    }
    setLoadingBill(true);
    const { data } = await supabase.storage.from('bills').createSignedUrl(expense.attachment_path, 60);
    setLoadingBill(false);
    if (data?.signedUrl) {
      setBillUrl(data.signedUrl);
      window.open(data.signedUrl, '_blank');
    }
  };

  return (
    <div className="receipt-card p-4 flex items-start gap-3">
      <span className="avatar-circle text-base" aria-hidden>
        {expense.payer?.username?.charAt(0)?.toUpperCase() ?? '•'}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm font-medium truncate ${settled ? 'line-through text-ink-faint' : ''}`}>
            {expense.description}
          </span>
          <span
            className={`font-mono text-sm font-semibold tabular-nums shrink-0 ${
              settled ? 'line-through text-ink-faint' : ''
            }`}
          >
            {formatCurrency(expense.amount, currency)}
          </span>
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <p className="text-xs text-ink-faint">
            Added by <span className="text-ink-soft font-medium">@{expense.payer?.username}</span> ·{' '}
            {new Date(expense.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </p>
          <div className="flex items-center gap-3 shrink-0">
            {expense.attachment_path ? (
              <button onClick={viewBill} disabled={loadingBill} className="text-xs text-emerald hover:underline">
                {loadingBill ? 'Opening…' : 'View bill'}
              </button>
            ) : null}
            {canManage ? (
              <button onClick={() => onEdit(expense)} className="text-xs text-ink-faint hover:text-emerald">
                Edit
              </button>
            ) : null}
            {canManage ? (
              <button onClick={() => onDelete(expense.id)} className="text-xs text-ink-faint hover:text-brick">
                Delete
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
