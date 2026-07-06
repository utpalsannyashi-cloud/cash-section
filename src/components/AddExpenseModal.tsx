import { FormEvent, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Expense, Profile } from '@/types';
import { formatCurrency } from '@/utils/currency';

export interface ParticipantLike {
  user_id: string;
  profile?: Profile;
}

export interface EditingSplit {
  user_id: string;
  share: number;
}

interface Props {
  sessionId: string;
  currency: string;
  participants: ParticipantLike[]; // everyone the expense is split across (all current group members)
  currentUserId: string;
  onClose: () => void;
  onSaved: () => void;
  /** When provided, the modal edits this expense instead of creating a new one. */
  editingExpense?: Expense;
}

/**
 * Splits totalRupees evenly across count people, in integer paise,
 * distributing any leftover cent(s) to the first few people so the sum
 * always matches exactly (required by the DB's split-sum trigger).
 */
function splitEqually(totalRupees: number, ids: string[]): Record<string, number> {
  const totalCents = Math.round(totalRupees * 100);
  const base = Math.floor(totalCents / ids.length);
  let remainder = totalCents - base * ids.length;
  const result: Record<string, number> = {};
  for (const id of ids) {
    let cents = base;
    if (remainder > 0) {
      cents += 1;
      remainder -= 1;
    }
    result[id] = cents / 100;
  }
  return result;
}

/**
 * Kept intentionally minimal: just what it was for and how much. Every
 * expense is split evenly across the whole group automatically — no
 * category, payer picker, custom splits, or bill upload to fuss over
 * while everyone's still at the table. The full settle-up math still
 * runs later from the "Split up" button.
 */
export function AddExpenseModal({
  sessionId,
  currency,
  participants,
  currentUserId,
  onClose,
  onSaved,
  editingExpense
}: Props) {
  const isEditing = Boolean(editingExpense);

  const [amount, setAmount] = useState(() => (editingExpense ? String(editingExpense.amount) : ''));
  const [description, setDescription] = useState(() => editingExpense?.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const numericAmount = parseFloat(amount) || 0;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (numericAmount <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (participants.length === 0) {
      setError('This group has no members to split with yet.');
      return;
    }

    const shares = splitEqually(
      numericAmount,
      participants.map((p) => p.user_id)
    );

    setBusy(true);

    if (isEditing && editingExpense) {
      const { error: rpcError } = await supabase.rpc('update_expense', {
        p_expense_id: editingExpense.id,
        p_description: description,
        p_amount: numericAmount,
        p_category: editingExpense.category,
        p_paid_by: editingExpense.paid_by,
        p_split_type: 'equal',
        p_attachment_path: editingExpense.attachment_path,
        p_splits: Object.entries(shares).map(([userId, share]) => ({ user_id: userId, share }))
      });

      setBusy(false);
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      onSaved();
      return;
    }

    const { data: expense, error: expenseError } = await supabase
      .from('expenses')
      .insert({
        session_id: sessionId,
        paid_by: currentUserId,
        amount: numericAmount,
        description,
        category: 'Misc',
        split_type: 'equal',
        attachment_path: null,
        created_by: currentUserId
      })
      .select()
      .single();

    if (expenseError || !expense) {
      setBusy(false);
      setError(expenseError?.message ?? 'Could not save the expense.');
      return;
    }

    const { error: splitsError } = await supabase.from('expense_splits').insert(
      Object.entries(shares).map(([userId, share]) => ({
        expense_id: expense.id,
        user_id: userId,
        share
      }))
    );

    setBusy(false);

    if (splitsError) {
      setError(splitsError.message);
      return;
    }

    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-end sm:items-center justify-center z-20 p-0 sm:p-4">
      <div className="bg-paper w-full sm:max-w-md sm:rounded-lg rounded-t-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-rule flex items-center justify-between">
          <h2 className="font-mono font-semibold">{isEditing ? 'Edit expense' : 'Add expense'}</h2>
          <button onClick={onClose} className="text-ink-faint hover:text-ink text-xl leading-none">
            ×
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="label-eyebrow block mb-1.5">What was it for?</label>
            <input
              required
              autoFocus
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input-field"
              placeholder="Dinner at Toit"
            />
          </div>

          <div>
            <label className="label-eyebrow block mb-1.5">Amount</label>
            <input
              required
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="input-field font-mono"
              placeholder="0.00"
            />
          </div>

          <p className="text-xs text-ink-faint">
            Split evenly across all {participants.length} group member{participants.length === 1 ? '' : 's'}
            {numericAmount > 0 && participants.length > 0
              ? ` — ${formatCurrency(numericAmount / participants.length, currency)} each`
              : ''}
            .
          </p>

          {error ? <p className="text-brick text-sm">{error}</p> : null}

          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? 'Saving…' : isEditing ? 'Save changes' : 'Add expense'}
          </button>
        </form>
      </div>
    </div>
  );
}
