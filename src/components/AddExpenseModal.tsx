import { FormEvent, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { BillUpload } from './BillUpload';
import type { Category, Profile, SplitType } from '@/types';
import { formatCurrency } from '@/utils/currency';

const CATEGORIES: Category[] = ['Food', 'Travel', 'Stay', 'Shopping', 'Misc'];

export interface ParticipantLike {
  user_id: string;
  profile?: Profile;
}

interface Props {
  groupId: string;
  sessionId: string;
  currency: string;
  participants: ParticipantLike[]; // members who are part of this session
  currentUserId: string;
  onClose: () => void;
  onCreated: () => void;
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

export function AddExpenseModal({
  groupId,
  sessionId,
  currency,
  participants,
  currentUserId,
  onClose,
  onCreated
}: Props) {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<Category>('Food');
  const [paidBy, setPaidBy] = useState(currentUserId);
  const [splitType, setSplitType] = useState<SplitType>('equal');
  const [includedIds, setIncludedIds] = useState<Set<string>>(new Set(participants.map((p) => p.user_id)));
  const [customShares, setCustomShares] = useState<Record<string, string>>({});
  const [percentages, setPercentages] = useState<Record<string, string>>({});
  const [attachmentPath, setAttachmentPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const numericAmount = parseFloat(amount) || 0;
  const includedList = participants.filter((p) => includedIds.has(p.user_id));

  const toggleIncluded = (userId: string) => {
    setIncludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const customTotal = useMemo(
    () => includedList.reduce((sum, p) => sum + (parseFloat(customShares[p.user_id]) || 0), 0),
    [customShares, includedList]
  );
  const percentageTotal = useMemo(
    () => includedList.reduce((sum, p) => sum + (parseFloat(percentages[p.user_id]) || 0), 0),
    [percentages, includedList]
  );

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (numericAmount <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (includedList.length === 0) {
      setError('Select at least one person to split with.');
      return;
    }

    let shares: Record<string, number>;

    if (splitType === 'equal') {
      shares = splitEqually(numericAmount, includedList.map((p) => p.user_id));
    } else if (splitType === 'custom') {
      if (Math.abs(customTotal - numericAmount) > 0.01) {
        setError(`Custom shares (${formatCurrency(customTotal, currency)}) must add up to the total (${formatCurrency(numericAmount, currency)}).`);
        return;
      }
      shares = {};
      for (const p of includedList) shares[p.user_id] = parseFloat(customShares[p.user_id]) || 0;
    } else {
      if (Math.abs(percentageTotal - 100) > 0.01) {
        setError(`Percentages add up to ${percentageTotal.toFixed(1)}%, they need to total 100%.`);
        return;
      }
      // Convert percentages to cents with remainder distributed, so the sum
      // matches the amount exactly despite rounding.
      const totalCents = Math.round(numericAmount * 100);
      let assignedCents = 0;
      shares = {};
      includedList.forEach((p, idx) => {
        const pct = parseFloat(percentages[p.user_id]) || 0;
        let cents: number;
        if (idx === includedList.length - 1) {
          cents = totalCents - assignedCents; // last person absorbs rounding remainder
        } else {
          cents = Math.round((pct / 100) * totalCents);
          assignedCents += cents;
        }
        shares[p.user_id] = cents / 100;
      });
    }

    setBusy(true);
    const { data: expense, error: expenseError } = await supabase
      .from('expenses')
      .insert({
        session_id: sessionId,
        paid_by: paidBy,
        amount: numericAmount,
        description,
        category,
        split_type: splitType,
        attachment_path: attachmentPath,
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

    onCreated();
  };

  return (
    <div className="fixed inset-0 bg-ink/40 flex items-end sm:items-center justify-center z-20 p-0 sm:p-4">
      <div className="bg-paper w-full sm:max-w-md sm:rounded-lg rounded-t-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-rule flex items-center justify-between">
          <h2 className="font-mono font-semibold">Add expense</h2>
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

          <div className="grid grid-cols-2 gap-3">
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
            <div>
              <label className="label-eyebrow block mb-1.5">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value as Category)} className="input-field">
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label-eyebrow block mb-1.5">Paid by</label>
            <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)} className="input-field">
              {participants.map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  @{p.profile?.username}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label-eyebrow block mb-1.5">Split</label>
            <div className="flex gap-2 mb-3">
              {(['equal', 'custom', 'percentage'] as SplitType[]).map((t) => (
                <button
                  type="button"
                  key={t}
                  onClick={() => setSplitType(t)}
                  className={`flex-1 text-xs py-2 rounded border transition-colors capitalize ${
                    splitType === t ? 'bg-emerald text-paper border-emerald' : 'border-ink/20 text-ink-soft'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="space-y-2">
              {participants.map((p) => {
                const included = includedIds.has(p.user_id);
                return (
                  <div key={p.user_id} className="ledger-row">
                    <button
                      type="button"
                      onClick={() => toggleIncluded(p.user_id)}
                      className={`text-xs shrink-0 ${included ? 'text-ink' : 'text-ink-faint line-through'}`}
                    >
                      @{p.profile?.username}
                    </button>
                    <span className="ledger-fill" />
                    {splitType === 'equal' ? (
                      <span className="ledger-amount text-xs text-ink-soft">
                        {included && includedList.length > 0
                          ? formatCurrency(splitEqually(numericAmount, includedList.map((x) => x.user_id))[p.user_id] ?? 0, currency)
                          : '—'}
                      </span>
                    ) : splitType === 'custom' ? (
                      <input
                        type="number"
                        step="0.01"
                        disabled={!included}
                        value={customShares[p.user_id] ?? ''}
                        onChange={(e) => setCustomShares((s) => ({ ...s, [p.user_id]: e.target.value }))}
                        className="w-20 bg-transparent font-mono text-xs text-right border-b border-rule focus:border-emerald outline-none disabled:opacity-30"
                        placeholder="0.00"
                      />
                    ) : (
                      <input
                        type="number"
                        step="1"
                        disabled={!included}
                        value={percentages[p.user_id] ?? ''}
                        onChange={(e) => setPercentages((s) => ({ ...s, [p.user_id]: e.target.value }))}
                        className="w-16 bg-transparent font-mono text-xs text-right border-b border-rule focus:border-emerald outline-none disabled:opacity-30"
                        placeholder="0%"
                      />
                    )}
                  </div>
                );
              })}
            </div>
            {splitType === 'custom' ? (
              <p className="text-xs text-ink-faint mt-2">
                {formatCurrency(customTotal, currency)} of {formatCurrency(numericAmount, currency)} allocated
              </p>
            ) : null}
            {splitType === 'percentage' ? (
              <p className="text-xs text-ink-faint mt-2">{percentageTotal.toFixed(1)}% of 100% allocated</p>
            ) : null}
          </div>

          <BillUpload groupId={groupId} sessionId={sessionId} value={attachmentPath} onUploaded={setAttachmentPath} />

          {error ? <p className="text-brick text-sm">{error}</p> : null}

          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? 'Saving…' : 'Add expense'}
          </button>
        </form>
      </div>
    </div>
  );
}
