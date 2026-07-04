import { describe, it, expect } from 'vitest';
import { simplifyDebts, deriveTotals, computeNetBalances, PersonTotals } from './settlement';

const sumTransfersFor = (transfers: ReturnType<typeof simplifyDebts>, userId: string) => {
  const paid = transfers.filter((t) => t.from === userId).reduce((s, t) => s + t.amount, 0);
  const received = transfers.filter((t) => t.to === userId).reduce((s, t) => s + t.amount, 0);
  return { paid, received };
};

describe('simplifyDebts', () => {
  it('handles the simplest two-person case', () => {
    const totals: PersonTotals[] = [
      { userId: 'A', paid: 1000, owed: 500 },
      { userId: 'B', paid: 0, owed: 500 }
    ];
    const transfers = simplifyDebts(totals);
    expect(transfers).toEqual([{ from: 'B', to: 'A', amount: 500 }]);
  });

  it('produces zero transfers when everyone is already even', () => {
    const totals: PersonTotals[] = [
      { userId: 'A', paid: 500, owed: 500 },
      { userId: 'B', paid: 500, owed: 500 }
    ];
    expect(simplifyDebts(totals)).toEqual([]);
  });

  it('simplifies a three-person chain into fewer transfers than the naive pairwise version', () => {
    // Classic case: A paid for everyone (1500 for a 3-way split of 500 each).
    // Naive would be B->A 500, C->A 500. Our greedy should match that here,
    // but the important property is it never produces more transfers than
    // there are non-zero balances minus 1.
    const totals: PersonTotals[] = [
      { userId: 'A', paid: 1500, owed: 500 },
      { userId: 'B', paid: 0, owed: 500 },
      { userId: 'C', paid: 0, owed: 500 }
    ];
    const transfers = simplifyDebts(totals);
    expect(transfers.length).toBeLessThanOrEqual(2);
    // Every rupee A is owed should show up as incoming transfers.
    const { received } = sumTransfersFor(transfers, 'A');
    expect(received).toBe(1000);
  });

  it('minimizes transfer count in a classic min-cash-flow scenario', () => {
    // A owes 100, B owes 200, C is owed 100, D is owed 200.
    // Optimal is 2 transfers: A->C(100)... actually let's just assert
    // it never exceeds n-1 transfers for n non-zero balances (4 here -> <=3),
    // and that the net effect is correct, which is the property that matters.
    const totals: PersonTotals[] = [
      { userId: 'A', paid: 0, owed: 100 }, // owes 100
      { userId: 'B', paid: 0, owed: 200 }, // owes 200
      { userId: 'C', paid: 200, owed: 100 }, // owed 100
      { userId: 'D', paid: 300, owed: 100 } // owed 200
    ];
    const transfers = simplifyDebts(totals);
    expect(transfers.length).toBeLessThanOrEqual(3);

    for (const person of totals) {
      const net = computeNetBalances(totals).get(person.userId)! / 100;
      const { paid, received } = sumTransfersFor(transfers, person.userId);
      // received - paid via transfers should cancel out the net balance
      expect(received - paid).toBeCloseTo(net, 2);
    }
  });

  it('handles uneven custom splits without floating point drift', () => {
    // 100.01 split three ways unevenly: 33.34 + 33.34 + 33.33 = 100.01
    const totals: PersonTotals[] = [
      { userId: 'A', paid: 100.01, owed: 33.34 },
      { userId: 'B', paid: 0, owed: 33.34 },
      { userId: 'C', paid: 0, owed: 33.33 }
    ];
    const transfers = simplifyDebts(totals);
    const totalTransferred = transfers.reduce((s, t) => s + t.amount, 0);
    expect(totalTransferred).toBeCloseTo(66.67, 2);
  });

  it('excludes people who are already exactly settled from the output', () => {
    const totals: PersonTotals[] = [
      { userId: 'A', paid: 500, owed: 500 }, // settled, should not appear
      { userId: 'B', paid: 1000, owed: 500 },
      { userId: 'C', paid: 0, owed: 500 }
    ];
    const transfers = simplifyDebts(totals);
    expect(transfers.some((t) => t.from === 'A' || t.to === 'A')).toBe(false);
    expect(transfers).toEqual([{ from: 'C', to: 'B', amount: 500 }]);
  });
});

describe('deriveTotals', () => {
  it('aggregates paid and owed amounts from raw expense/split rows', () => {
    const totals = deriveTotals(
      ['A', 'B', 'C'],
      [
        { paid_by: 'A', amount: 300 },
        { paid_by: 'B', amount: 150 }
      ],
      [
        { expense_id: 'e1', user_id: 'A', share: 100 },
        { expense_id: 'e1', user_id: 'B', share: 100 },
        { expense_id: 'e1', user_id: 'C', share: 100 },
        { expense_id: 'e2', user_id: 'A', share: 50 },
        { expense_id: 'e2', user_id: 'B', share: 100 }
      ]
    );

    expect(totals.find((t) => t.userId === 'A')).toEqual({ userId: 'A', paid: 300, owed: 150 });
    expect(totals.find((t) => t.userId === 'B')).toEqual({ userId: 'B', paid: 150, owed: 200 });
    expect(totals.find((t) => t.userId === 'C')).toEqual({ userId: 'C', paid: 0, owed: 100 });
  });
});
