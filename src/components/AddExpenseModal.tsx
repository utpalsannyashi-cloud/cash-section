import { FormEvent, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Expense, Profile } from '@/types';
import { formatCurrency } from '@/utils/currency';
import { BillUpload } from '@/components/BillUpload';

export interface ParticipantLike {
  user_id: string;
  profile?: Profile;
}

export interface EditingSplit {
  user_id: string;
  share: number;
}

// A short, curated list rather than every ISO code — keeps the picker to a
// single tap for the currencies this app's groups actually use.
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD', 'AED', 'JPY'];

/**
 * Local-timezone YYYY-MM-DD for a <input type="date">.
 *
 * Deliberately not toISOString().slice(0, 10), which gives the UTC date
 * and so offers "yesterday" as the default to anyone east of UTC in the
 * early hours.
 */
function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Midday local time on the chosen day. Anchoring away from midnight means
 * the stored timestamp can't render as the neighbouring day for someone
 * reading it in another timezone.
 */
function dateInputToTimestamp(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00`).toISOString();
}

interface Props {
  groupId: string;
  sessionId: string;
  currency: string;
  /** Called when the picked currency differs from `currency` — the parent
   *  applies it to the whole group (there's no per-expense currency). */
  onCurrencyChange?: (currency: string) => void | Promise<void>;
  participants: ParticipantLike[]; // everyone the expense is split across (all current group members)
  currentUserId: string;
  /** Admins get a "Paid by" picker so they can log an expense on someone
   *  else's behalf (e.g. entering a bill from a printed receipt, or
   *  backfilling something a member forgot to add themselves). Everyone
   *  else always pays as themselves, same as before. */
  isAdmin?: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** When provided, the modal edits this expense instead of creating a new one. */
  editingExpense?: Expense;
}

/**
 * Splits `totalRupees` evenly across `count` people, in integer paise,
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
 * Kept intentionally minimal: just what it was for, how much, and an
 * optional photo/PDF of the bill. Every expense is split evenly across the
 * whole group automatically — no category, payer picker, or custom splits
 * to fuss over while everyone's still at the table. The full settle-up math
 * still runs later from the "Split up" button.
 */
export function AddExpenseModal({
  groupId,
  sessionId,
  currency,
  onCurrencyChange,
  participants,
  currentUserId,
  isAdmin,
  onClose,
  onSaved,
  editingExpense
}: Props) {
  const isEditing = Boolean(editingExpense);

  const [amount, setAmount] = useState(() => (editingExpense ? String(editingExpense.amount) : ''));
  const [description, setDescription] = useState(() => editingExpense?.description ?? '');
  const [selectedCurrency, setSelectedCurrency] = useState(currency || 'INR');
  const [attachmentPath, setAttachmentPath] = useState<string | null>(editingExpense?.attachment_path ?? null);
  const [paidBy, setPaidBy] = useState(() => editingExpense?.paid_by ?? currentUserId);
  // The expense date. Stored in expenses.created_at (see migration
  // 0017), which is what ExpenseCard shows and the dashboard sorts by.
  // Defaults to today; future dates are allowed so a prepaid booking can
  // be logged against the day it's actually for.
  const [spentOn, setSpentOn] = useState(() =>
    toDateInput(editingExpense ? new Date(editingExpense.created_at) : new Date())
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const numericAmount = parseFloat(amount) || 0;

  // Whoever's currently splitting the expense, plus (when editing) whoever
  // already paid it even if they're no longer an active participant — so
  // an admin never loses track of who a past expense was actually paid by.
  const payerOptions: { userId: string; label: string }[] = (() => {
    const seen = new Map<string, string>();
    for (const p of participants) {
      seen.set(p.user_id, p.user_id === currentUserId ? 'You' : `@${p.profile?.username ?? 'member'}`);
    }
    if (editingExpense && !seen.has(editingExpense.paid_by)) {
      seen.set(
        editingExpense.paid_by,
        editingExpense.paid_by === currentUserId ? 'You' : `@${editingExpense.payer?.username ?? 'former member'}`
      );
    }
    return Array.from(seen.entries()).map(([userId, label]) => ({ userId, label }));
  })();

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

    if (selectedCurrency !== currency && onCurrencyChange) {
      await onCurrencyChange(selectedCurrency);
    }

    if (isEditing && editingExpense) {
      const { error: rpcError } = await supabase.rpc('update_expense', {
        p_expense_id: editingExpense.id,
        p_description: description,
        p_amount: numericAmount,
        p_category: editingExpense.category,
        p_paid_by: paidBy,
        p_split_type: 'equal',
        p_attachment_path: attachmentPath,
        p_splits: Object.entries(shares).map(([userId, share]) => ({ user_id: userId, share })),
        // Left exactly as it was when the date wasn't touched, so editing
        // an amount doesn't quietly move the expense to midday.
        p_created_at:
          spentOn === toDateInput(new Date(editingExpense.created_at))
            ? editingExpense.created_at
            : dateInputToTimestamp(spentOn)
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
        paid_by: paidBy,
        amount: numericAmount,
        description,
        category: 'Misc',
        split_type: 'equal',
        attachment_path: attachmentPath,
        created_by: currentUserId,
        // Only send a date when it isn't today: a same-day expense keeps
        // the real insert time and so stays correctly ordered against the
        // others added at the table.
        ...(spentOn === toDateInput(new Date())
          ? {}
          : { created_at: dateInputToTimestamp(spentOn) })
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
            <div className="flex gap-2">
              <select
                value={selectedCurrency}
                onChange={(e) => setSelectedCurrency(e.target.value)}
                title="Applies to the whole group, not just this expense"
                className="input-field font-mono w-[4.75rem] shrink-0 px-2"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                required
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="input-field font-mono flex-1"
                placeholder="0.00"
              />
            </div>
          </div>

          <div>
            <label className="label-eyebrow block mb-1.5">Date</label>
            <input
              required
              type="date"
              value={spentOn}
              onChange={(e) => setSpentOn(e.target.value)}
              className="input-field font-mono"
            />
            <p className="text-xs text-ink-faint mt-1">
              Defaults to today. Change it if you're entering something from another day.
            </p>
          </div>

          {isAdmin ? (
            <div>
              <label className="label-eyebrow block mb-1.5">Paid by</label>
              <select
                value={paidBy}
                onChange={(e) => setPaidBy(e.target.value)}
                className="input-field"
              >
                {payerOptions.map((o) => (
                  <option key={o.userId} value={o.userId}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <p className="text-xs text-ink-faint">
            Split evenly across all {participants.length} group member{participants.length === 1 ? '' : 's'}
            {numericAmount > 0 && participants.length > 0
              ? ` — ${formatCurrency(numericAmount / participants.length, selectedCurrency)} each`
              : ''}
            .
            {selectedCurrency !== currency ? ` This'll switch the group to ${selectedCurrency}.` : ''}
          </p>

          <div>
            <BillUpload groupId={groupId} sessionId={sessionId} value={attachmentPath} onUploaded={setAttachmentPath} />
            {attachmentPath ? (
              <button
                type="button"
                onClick={() => setAttachmentPath(null)}
                className="text-xs text-ink-faint hover:text-brick mt-1"
              >
                Remove attachment
              </button>
            ) : null}
          </div>

          {error ? <p className="text-brick text-sm">{error}</p> : null}

          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? 'Saving…' : isEditing ? 'Save changes' : 'Add expense'}
          </button>
        </form>
      </div>
    </div>
  );
}
