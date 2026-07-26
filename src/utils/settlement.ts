/**
 * Settlement engine for a session.
 *
 * Given how much each person paid and how much each person owed (their
 * split total), this computes the minimum set of transfers needed to
 * zero everyone out, using a greedy "largest debtor pays largest
 * creditor" strategy. This does not always find the mathematically
 * optimal minimum (that's NP-hard in general), but it's a well-known,
 * easy-to-audit approximation that in practice produces very few
 * transfers for typical group sizes (5-15 people).
 *
 * Amounts are handled in integer paise/cents internally to avoid
 * floating point drift, then converted back to rupees (2dp) at the end.
 */

export interface PersonTotals {
  userId: string;
  paid: number; // total amount this person paid across all expenses
  owed: number; // total amount this person's splits add up to (what they consumed)
}

export interface Transfer {
  from: string; // user id who owes money
  to: string; // user id who should receive money
  amount: number; // in rupees, 2dp
}

const toCents = (rupees: number) => Math.round(rupees * 100);
const toRupees = (cents: number) => Math.round(cents) / 100;

/**
 * Computes net balance per person: positive = should receive money,
 * negative = owes money.
 */
export function computeNetBalances(totals: PersonTotals[]): Map<string, number> {
  const balances = new Map<string, number>();
  for (const t of totals) {
    const netCents = toCents(t.paid) - toCents(t.owed);
    balances.set(t.userId, netCents);
  }
  return balances;
}

/**
 * Greedy min-cash-flow: repeatedly match the largest creditor with the
 * largest debtor, settle the smaller of the two amounts, and repeat
 * until everyone is at zero (within rounding).
 */
export function simplifyDebts(totals: PersonTotals[]): Transfer[] {
  const balances = computeNetBalances(totals);

  // Split into creditors (owed money, positive) and debtors (owe money, negative).
  type Entry = { userId: string; amount: number }; // amount always positive here
  const creditors: Entry[] = [];
  const debtors: Entry[] = [];

  for (const [userId, cents] of balances.entries()) {
    if (cents > 0) creditors.push({ userId, amount: cents });
    else if (cents < 0) debtors.push({ userId, amount: -cents });
    // cents === 0 -> already settled, excluded entirely
  }

  const transfers: Transfer[] = [];

  // Use max-heaps via sort-on-each-iteration (group sizes are small,
  // so O(n^2 log n) is more than fast enough and keeps this readable).
  while (creditors.length > 0 && debtors.length > 0) {
    creditors.sort((a, b) => b.amount - a.amount || a.userId.localeCompare(b.userId));
    debtors.sort((a, b) => b.amount - a.amount || a.userId.localeCompare(b.userId));

    const topCreditor = creditors[0];
    const topDebtor = debtors[0];

    const settleAmount = Math.min(topCreditor.amount, topDebtor.amount);

    if (settleAmount > 0) {
      transfers.push({
        from: topDebtor.userId,
        to: topCreditor.userId,
        amount: toRupees(settleAmount)
      });
    }

    topCreditor.amount -= settleAmount;
    topDebtor.amount -= settleAmount;

    if (topCreditor.amount <= 0) creditors.shift();
    if (topDebtor.amount <= 0) debtors.shift();
  }

  return transfers;
}

/**
 * Splits `cents` as evenly as possible across `ids`, handing the leftover
 * cent(s) to the first few so the parts always sum back to the whole.
 */
function shareOut(cents: number, ids: string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const base = Math.floor(cents / ids.length);
  let remainder = cents - base * ids.length;
  for (const id of ids) {
    let c = base;
    if (remainder > 0) {
      c += 1;
      remainder -= 1;
    }
    out.set(id, c);
  }
  return out;
}

export interface DepartedBalance {
  userId: string;
  /** Rupees, 2dp. Always positive: what the group still owes them. */
  amount: number;
}

/**
 * Tallies everything in integer cents, converting back to rupees only at
 * the boundary. The previous version rounded through rupees midway, which
 * undermined the whole point of working in cents.
 */
function tallyCents(
  participantIds: string[],
  expenses: { paid_by: string; amount: number }[],
  splits: { user_id: string; share: number }[]
) {
  const paid = new Map<string, number>();
  const owed = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

  for (const id of participantIds) {
    paid.set(id, 0);
    owed.set(id, 0);
  }
  for (const e of expenses) bump(paid, e.paid_by, toCents(e.amount));
  for (const s of splits) bump(owed, s.user_id, toCents(s.share));

  const participantSet = new Set(participantIds);
  const orphanCredits = new Map<string, number>();
  let orphanDeficitCents = 0;

  for (const userId of new Set([...paid.keys(), ...owed.keys()])) {
    if (participantSet.has(userId)) continue;
    const net = (paid.get(userId) ?? 0) - (owed.get(userId) ?? 0);
    if (net > 0) orphanCredits.set(userId, net);
    else if (net < 0) orphanDeficitCents += -net;
  }

  return { paid, owed, orphanCredits, orphanDeficitCents };
}

/**
 * People who appear in the expense or split rows but are no longer in
 * `participantIds` — an admin removed them after the fact — and who are
 * net creditors: they paid out more than they consumed.
 *
 * Exposed separately so the group dashboard can tell the admin who's owed
 * what, and let them choose how to handle it, before any settlement runs.
 */
export function findDepartedCredits(
  participantIds: string[],
  expenses: { paid_by: string; amount: number }[],
  splits: { user_id: string; share: number }[]
): DepartedBalance[] {
  const { orphanCredits } = tallyCents(participantIds, expenses, splits);
  return [...orphanCredits.entries()]
    .map(([userId, cents]) => ({ userId, amount: toRupees(cents) }))
    .sort((a, b) => b.amount - a.amount || a.userId.localeCompare(b.userId));
}

export interface DeriveOptions {
  /**
   * What to do about money the group owes a removed member.
   *
   * 'repay' (the default) keeps them in the settlement as a creditor, so
   * the transfers actually pay them back. Their profile row still exists,
   * so a transfer can name them even though they've left the group.
   *
   * 'absorb' spreads their credit across the current participants
   * instead, reducing what each of them owes. Nobody pays the departed
   * member. Only ever chosen deliberately by an admin.
   */
  departedCredits?: 'repay' | 'absorb';
}

/**
 * Derive PersonTotals from raw expense + split rows, as they'd come back
 * from Supabase.
 *
 * Expense and split rows can reference someone who is no longer a group
 * member, because removing a member deliberately leaves their history
 * intact (see handleRemoveMember in GroupDashboard.tsx). Both directions
 * have to be handled or the balances stop summing to zero:
 *
 *   - They consumed more than they paid. That shortfall can't be
 *     collected from someone who has left, so it's spread across whoever
 *     is still here, the same way a fresh expense would be.
 *
 *   - They paid more than they consumed. The group owes them. This case
 *     used to be skipped entirely, so the money simply vanished: debtors
 *     outnumbered creditors and simplifyDebts dropped the difference on
 *     the floor. They're now repaid by default.
 */
export function deriveTotals(
  participantIds: string[],
  expenses: { paid_by: string; amount: number }[],
  splits: { user_id: string; share: number; expense_id?: string }[],
  options: DeriveOptions = {}
): PersonTotals[] {
  const mode = options.departedCredits ?? 'repay';
  const { paid, owed, orphanCredits, orphanDeficitCents } = tallyCents(participantIds, expenses, splits);

  if (orphanDeficitCents > 0) {
    for (const [id, cents] of shareOut(orphanDeficitCents, participantIds)) {
      owed.set(id, (owed.get(id) ?? 0) + cents);
    }
  }

  const totals: PersonTotals[] = participantIds.map((userId) => ({
    userId,
    paid: toRupees(paid.get(userId) ?? 0),
    owed: toRupees(owed.get(userId) ?? 0)
  }));

  if (orphanCredits.size === 0) return totals;

  if (mode === 'absorb') {
    let totalCredit = 0;
    for (const c of orphanCredits.values()) totalCredit += c;
    for (const [id, cents] of shareOut(totalCredit, participantIds)) {
      const t = totals.find((x) => x.userId === id);
      if (t) t.owed = toRupees(toCents(t.owed) - cents);
    }
    return totals;
  }

  for (const [userId, cents] of orphanCredits) {
    totals.push({ userId, paid: toRupees(cents), owed: 0 });
  }
  return totals;
}
