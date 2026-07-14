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
    creditors.sort((a, b) => b.amount - a.amount);
    debtors.sort((a, b) => b.amount - a.amount);

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
 * Convenience helper: derive PersonTotals from raw expense + split rows,
 * as they'd come back from Supabase.
 *
 * Expense/split rows can reference someone who is no longer a group
 * member (an admin removed them after expenses were already logged —
 * see handleRemoveMember in GroupDashboard.tsx, which deliberately
 * leaves past expense_splits untouched). Rather than silently dropping
 * what a departed member still owed — which would understate what the
 * payer is actually owed back — their net deficit (owed minus whatever
 * they themselves paid) is folded evenly across the current
 * participantIds, the same way a fresh expense would be split.
 */
export function deriveTotals(
  participantIds: string[],
  expenses: { paid_by: string; amount: number }[],
  splits: { user_id: string; share: number; expense_id: string }[]
): PersonTotals[] {
  const paidMap = new Map<string, number>();
  const owedMap = new Map<string, number>();

  for (const id of participantIds) {
    paidMap.set(id, 0);
    owedMap.set(id, 0);
  }

  for (const e of expenses) {
    paidMap.set(e.paid_by, (paidMap.get(e.paid_by) ?? 0) + e.amount);
  }

  for (const s of splits) {
    owedMap.set(s.user_id, (owedMap.get(s.user_id) ?? 0) + s.share);
  }

  const participantSet = new Set(participantIds);
  const allUserIds = new Set([...paidMap.keys(), ...owedMap.keys()]);

  let orphanedDeficitCents = 0;
  for (const userId of allUserIds) {
    if (participantSet.has(userId)) continue;
    const paid = paidMap.get(userId) ?? 0;
    const owed = owedMap.get(userId) ?? 0;
    if (owed > paid) orphanedDeficitCents += toCents(owed) - toCents(paid);
  }

  if (orphanedDeficitCents > 0 && participantIds.length > 0) {
    const base = Math.floor(orphanedDeficitCents / participantIds.length);
    let remainder = orphanedDeficitCents - base * participantIds.length;
    for (const id of participantIds) {
      let cents = base;
      if (remainder > 0) {
        cents += 1;
        remainder -= 1;
      }
      owedMap.set(id, (owedMap.get(id) ?? 0) + toRupees(cents));
    }
  }

  return participantIds.map((userId) => ({
    userId,
    paid: paidMap.get(userId) ?? 0,
    owed: owedMap.get(userId) ?? 0
  }));
}
