import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { AddExpenseModal, ParticipantLike } from '@/components/AddExpenseModal';
import { ExpenseCard } from '@/components/ExpenseCard';
import { SettlementSummary } from '@/components/SettlementSummary';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { deriveTotals, simplifyDebts } from '@/utils/settlement';
import { formatCurrency } from '@/utils/currency';
import type { Expense, Session, Settlement } from '@/types';

// NOTE: individual sessions are no longer a user-facing concept - see
// GroupDashboard.tsx, which now owns the group's whole shared ledger
// (passkey included). This page is kept only so a legacy /sessions/:id
// link still resolves to something useful instead of a dead end.
export function SessionDetail() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [session, setSession] = useState<Session | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [participants, setParticipants] = useState<ParticipantLike[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [view, setView] = useState<'expenses' | 'settle'>('expenses');
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);

  const load = useCallback(async () => {
    if (!sessionId || !user) return;
    setLoading(true);

    const { data: s } = await supabase.from('sessions').select('*').eq('id', sessionId).single();
    if (!s) {
      setLoading(false);
      return;
    }
    setSession(s);
    setGroupId(s.group_id);

    const [{ data: membership }, { data: parts }, { data: exp }, { data: settl }] = await Promise.all([
      supabase.from('group_members').select('role').eq('group_id', s.group_id).eq('user_id', user.id).single(),
      supabase.from('session_participants').select('user_id, profile:profiles(*)').eq('session_id', sessionId),
      supabase
        .from('expenses')
        .select('*, payer:profiles!expenses_paid_by_fkey(*)')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false }),
      supabase
        .from('settlements')
        .select('*, from_profile:profiles!settlements_from_user_fkey(*), to_profile:profiles!settlements_to_user_fkey(*)')
        .eq('session_id', sessionId)
        .order('amount', { ascending: false })
    ]);

    setIsAdmin(membership?.role === 'admin');
    setParticipants((parts as unknown as ParticipantLike[]) ?? []);
    setExpenses((exp as unknown as Expense[]) ?? []);
    setSettlements((settl as unknown as Settlement[]) ?? []);
    setLoading(false);
  }, [sessionId, user]);

  useEffect(() => {
    load();
  }, [load]);

  // Live updates: anyone adding an expense during the outing shows up for everyone instantly.
  useEffect(() => {
    if (!sessionId) return;
    const channel = supabase
      .channel(`session-${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `session_id=eq.${sessionId}` }, () => {
        load();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements', filter: `session_id=eq.${sessionId}` }, () => {
        load();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, load]);

  const sessionTotal = expenses.reduce((sum, e) => sum + e.amount, 0);

  const handleDeleteExpense = async (id: string) => {
    await supabase.from('expenses').delete().eq('id', id);
    load();
  };

  const handleEditExpense = (expense: Expense) => {
    setEditingExpense(expense);
  };

  const closeExpenseModal = () => {
    setShowAdd(false);
    setEditingExpense(null);
  };

  const handleComputeSettlement = async () => {
    if (!sessionId) return;
    setComputing(true);

    const { data: allExpenses } = await supabase.from('expenses').select('paid_by, amount').eq('session_id', sessionId);
    const { data: allSplits } = await supabase
      .from('expense_splits')
      .select('user_id, share, expense_id, expenses!inner(session_id)')
      .eq('expenses.session_id', sessionId);

    const participantIds = participants.map((p) => p.user_id);
    const totals = deriveTotals(participantIds, allExpenses ?? [], (allSplits as any) ?? []);
    const transfers = simplifyDebts(totals);

    // Replace any existing (unpaid) computed settlement rows with the fresh calculation.
    await supabase.from('settlements').delete().eq('session_id', sessionId).eq('is_paid', false);

    if (transfers.length > 0) {
      await supabase.from('settlements').insert(
        transfers.map((t) => ({
          session_id: sessionId,
          from_user: t.from,
          to_user: t.to,
          amount: t.amount
        }))
      );
    }

    setComputing(false);
    setView('settle');
    load();
  };

  const toggleSettlementPaid = async (s: Settlement) => {
    await supabase.from('settlements').update({ is_paid: !s.is_paid }).eq('id', s.id);
    load();
  };

  if (loading) {
    return (
      <Layout back={groupId ? `/groups/${groupId}` : '/groups'}>
        <p className="label-eyebrow">Loading…</p>
      </Layout>
    );
  }

  if (!session) {
    return (
      <Layout back="/groups">
        <p className="text-ink-soft text-sm">Session not found, or you don't have access to it.</p>
      </Layout>
    );
  }

  return (
    <Layout back={`/groups/${groupId}`} onAskAi={groupId ? () => navigate(`/groups/${groupId}/insights`) : undefined}>
      <div className="mb-5">
        <div className="flex items-center justify-between">
          <h1 className="font-mono text-xl font-semibold">{session.title}</h1>
          <span className={`status-pill ${session.status === 'open' ? 'bg-emerald-light text-emerald-dark' : 'bg-ink/5 text-ink-faint'}`}>
            {session.status}
          </span>
        </div>
        <p className="text-ink-soft text-sm mt-1">
          {new Date(session.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="stat-card stat-card-active">
          <p className="stat-card-label">Total spend</p>
          <p className="stat-card-value text-lg">{formatCurrency(sessionTotal, session.currency)}</p>
        </div>
        <div className="stat-card">
          <p className="stat-card-label">Expenses</p>
          <p className="stat-card-value">{expenses.length}</p>
        </div>
        <div className="stat-card">
          <p className="stat-card-label">People</p>
          <p className="stat-card-value">{participants.length}</p>
        </div>
      </div>

      <p className="text-xs text-ink-faint mb-5">
        Manage this group's passkey, and delete/settle options, from the group page instead.
      </p>

      <div className="tab-bar">
        <button
          onClick={() => setView('expenses')}
          className={`tab-link ${view === 'expenses' ? 'tab-link-active' : ''}`}
        >
          Expenses
        </button>
        <button
          onClick={() => setView('settle')}
          className={`tab-link ${view === 'settle' ? 'tab-link-active' : ''}`}
        >
          Settle up
        </button>
      </div>

      {view === 'expenses' ? (
        <>
          {session.status === 'open' ? (
            <button className="btn-primary w-full mb-4" onClick={() => setShowAdd(true)}>
              + Add expense
            </button>
          ) : null}
          {expenses.length === 0 ? (
            <div className="receipt-card p-8 text-center">
              <p className="text-sm text-ink-soft">No expenses logged yet.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {expenses.map((e) => (
                <li key={e.id}>
                  <ExpenseCard
                    expense={e}
                    currency={session.currency}
                    canManage={session.status === 'open' && (isAdmin || e.created_by === user?.id)}
                    onEdit={handleEditExpense}
                    onDelete={handleDeleteExpense}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="space-y-4">
          {session.status === 'open' ? (
            <button onClick={handleComputeSettlement} disabled={computing} className="btn-primary w-full">
              {computing ? 'Calculating…' : settlements.length > 0 ? 'Recalculate settlement' : 'Calculate settlement'}
            </button>
          ) : null}

          <SettlementSummary
            settlements={settlements}
            currency={session.currency}
            canMarkPaid={(s) => s.from_user === user?.id || s.to_user === user?.id || isAdmin}
            onTogglePaid={toggleSettlementPaid}
          />

        </div>
      )}

      {(showAdd || editingExpense) && sessionId && groupId && user ? (
        <AddExpenseModal
          groupId={groupId}
          sessionId={sessionId}
          currency={session.currency}
          participants={participants}
          currentUserId={user.id}
          editingExpense={editingExpense ?? undefined}
          onClose={closeExpenseModal}
          onSaved={() => {
            closeExpenseModal();
            load();
          }}
        />
      ) : null}
    </Layout>
  );
}
