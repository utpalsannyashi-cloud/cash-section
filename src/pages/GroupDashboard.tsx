import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { AddExpenseModal, ParticipantLike } from '@/components/AddExpenseModal';
import { ExpenseCard } from '@/components/ExpenseCard';
import { SettlementSummary } from '@/components/SettlementSummary';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { deriveTotals, simplifyDebts } from '@/utils/settlement';
import { formatCurrency } from '@/utils/currency';
import type { Expense, Group, GroupMember, Settlement } from '@/types';

const CODE_PATTERN = /^[a-z0-9]{4,20}$/;

/**
 * A group is now just one continuous shared ledger - there's no more
 * user-facing concept of "sessions". Under the hood, expenses still
 * hang off a session row (schema left as-is to avoid a risky data
 * migration), but this page transparently aggregates every session
 * that belongs to the group into a single view, and always writes new
 * expenses to the earliest ("primary") one. Nobody sees a session list,
 * a "+ New session" button, or a per-session passkey anymore - the
 * passkey now lives on the group itself (see Browse.tsx).
 */
export function GroupDashboard() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const [primarySessionId, setPrimarySessionId] = useState<string | null>(null);
  const [currency, setCurrency] = useState('INR');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);

  const [view, setView] = useState<'expenses' | 'settle'>('expenses');
  const [showAdd, setShowAdd] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [computing, setComputing] = useState(false);

  const [copiedInvite, setCopiedInvite] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [customCode, setCustomCode] = useState('');
  const [savingCode, setSavingCode] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [deletingGroup, setDeletingGroup] = useState(false);

  const isAdmin = members.find((m) => m.user_id === user?.id)?.role === 'admin';

  const load = useCallback(async () => {
    if (!groupId || !user) return;
    setLoading(true);

    const [{ data: g }, { data: m }] = await Promise.all([
      supabase.from('groups').select('*').eq('id', groupId).single(),
      supabase.from('group_members').select('*, profile:profiles(*)').eq('group_id', groupId)
    ]);
    setGroup(g);
    setMembers((m as unknown as GroupMember[]) ?? []);

    let { data: sessions } = await supabase
      .from('sessions')
      .select('id, currency')
      .eq('group_id', groupId)
      .order('created_at', { ascending: true });

    // Safety net: every group is normally auto-seeded with a "General"
    // session by the handle_new_group() trigger, but if one somehow
    // doesn't exist yet, create it transparently so expenses have
    // somewhere to attach.
    if (!sessions || sessions.length === 0) {
      const { data: created } = await supabase
        .from('sessions')
        .insert({ group_id: groupId, title: 'General', created_by: user.id })
        .select('id, currency')
        .single();
      sessions = created ? [created] : [];
    }

    const ids = (sessions ?? []).map((s) => s.id);
    setSessionIds(ids);
    setPrimarySessionId(ids[0] ?? null);
    setCurrency(sessions?.[0]?.currency ?? 'INR');

    if (ids.length > 0) {
      const [{ data: exp }, { data: settl }] = await Promise.all([
        supabase
          .from('expenses')
          .select('*, payer:profiles!expenses_paid_by_fkey(*)')
          .in('session_id', ids)
          .order('created_at', { ascending: false }),
        supabase
          .from('settlements')
          .select('*, from_profile:profiles!settlements_from_user_fkey(*), to_profile:profiles!settlements_to_user_fkey(*)')
          .in('session_id', ids)
          .order('amount', { ascending: false })
      ]);
      setExpenses((exp as unknown as Expense[]) ?? []);
      setSettlements((settl as unknown as Settlement[]) ?? []);
    } else {
      setExpenses([]);
      setSettlements([]);
    }

    setLoading(false);
  }, [groupId, user]);

  useEffect(() => {
    load();
  }, [load]);

  // Live updates: anyone adding an expense shows up for everyone instantly.
  useEffect(() => {
    if (sessionIds.length === 0) return;
    const channels = sessionIds.map((sid) =>
      supabase
        .channel(`group-session-${sid}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `session_id=eq.${sid}` }, () => load())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements', filter: `session_id=eq.${sid}` }, () => load())
        .subscribe()
    );

    return () => {
      channels.forEach((c) => supabase.removeChannel(c));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIds.join(',')]);

  const totalSpend = expenses.reduce((sum, e) => sum + e.amount, 0);
  const participants: ParticipantLike[] = members.map((m) => ({ user_id: m.user_id, profile: m.profile }));

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
    if (sessionIds.length === 0) return;
    setComputing(true);

    const { data: allExpenses } = await supabase.from('expenses').select('paid_by, amount').in('session_id', sessionIds);
    const { data: allSplits } = await supabase
      .from('expense_splits')
      .select('user_id, share, expense_id, expenses!inner(session_id)')
      .in('expenses.session_id', sessionIds);

    const participantIds = members.map((m) => m.user_id);
    const totals = deriveTotals(participantIds, allExpenses ?? [], (allSplits as any) ?? []);
    const transfers = simplifyDebts(totals);

    // Replace any existing (unpaid) computed settlement rows with the fresh calculation.
    await supabase.from('settlements').delete().in('session_id', sessionIds).eq('is_paid', false);

    if (transfers.length > 0 && primarySessionId) {
      await supabase.from('settlements').insert(
        transfers.map((t) => ({
          session_id: primarySessionId,
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

  const copyInvite = async () => {
    if (!group) return;
    await navigator.clipboard.writeText(group.invite_code);
    setCopiedInvite(true);
    setTimeout(() => setCopiedInvite(false), 1500);
  };

  const copyAccessCode = async () => {
    if (!group) return;
    await navigator.clipboard.writeText(group.access_code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 1500);
  };

  const regenerateAccessCode = async () => {
    if (!groupId) return;
    setRegenerating(true);
    setCodeError(null);
    const newCode = Math.random().toString(36).slice(2, 8);
    await supabase.from('groups').update({ access_code: newCode }).eq('id', groupId);
    setRegenerating(false);
    load();
  };

  const handleSetCustomCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!groupId) return;
    const code = customCode.trim().toLowerCase();
    if (!CODE_PATTERN.test(code)) {
      setCodeError('Use 4–20 lowercase letters/numbers, e.g. goa2026.');
      return;
    }
    setSavingCode(true);
    setCodeError(null);
    const { error } = await supabase.from('groups').update({ access_code: code }).eq('id', groupId);
    setSavingCode(false);
    if (error) {
      setCodeError(error.message.includes('duplicate') ? 'That passkey is already taken — pick another.' : error.message);
      return;
    }
    setCustomCode('');
    load();
  };

  const handleDeleteGroup = async () => {
    if (!groupId || !group) return;
    if (
      !window.confirm(
        `Delete "${group.name}"? This permanently removes every expense, member, and settlement in this group. This can't be undone.`
      )
    ) {
      return;
    }
    setDeletingGroup(true);
    const { error } = await supabase.from('groups').delete().eq('id', groupId);
    setDeletingGroup(false);
    if (error) {
      window.alert(error.message);
      return;
    }
    navigate('/groups', { replace: true });
  };

  if (loading) {
    return (
      <Layout back="/groups">
        <p className="label-eyebrow">Loading…</p>
      </Layout>
    );
  }

  if (!group) {
    return (
      <Layout back="/groups">
        <p className="text-ink-soft text-sm">Group not found, or you don't have access to it.</p>
      </Layout>
    );
  }

  return (
    <Layout back="/groups">
      <div className="mb-5">
        <h1 className="font-mono text-xl font-semibold">{group.name}</h1>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="text-ink-soft text-sm">{members.length} members</span>
          <span className="text-ink-faint">·</span>
          <span className="text-ink-soft text-sm">
            Created {new Date(group.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
          <span className="text-ink-faint">·</span>
          <button onClick={copyInvite} className="font-mono text-xs text-emerald hover:underline">
            {copiedInvite ? 'Copied!' : `Invite code: ${group.invite_code}`}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="stat-card stat-card-active">
          <p className="stat-card-label">Total spend</p>
          <p className="stat-card-value text-lg">{formatCurrency(totalSpend, currency)}</p>
        </div>
        <div className="stat-card">
          <p className="stat-card-label">Expenses</p>
          <p className="stat-card-value">{expenses.length}</p>
        </div>
        <div className="stat-card">
          <p className="stat-card-label">Members</p>
          <p className="stat-card-value">{members.length}</p>
        </div>
      </div>

      {isAdmin ? (
        <div className="receipt-card p-4 mb-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="label-eyebrow mb-1">Group passkey</p>
              <button onClick={copyAccessCode} className="font-mono text-sm text-emerald hover:underline">
                {copiedCode ? 'Copied!' : group.access_code}
              </button>
              <p className="text-xs text-ink-faint mt-1">Share this so guests can jump straight into this group without an account.</p>
            </div>
            <button
              onClick={regenerateAccessCode}
              disabled={regenerating}
              className="text-xs text-ink-faint hover:text-brick transition-colors shrink-0"
            >
              {regenerating ? 'Regenerating…' : 'Random'}
            </button>
          </div>
          <form onSubmit={handleSetCustomCode} className="flex items-center gap-2 pt-2 border-t border-dashed border-rule">
            <input
              value={customCode}
              onChange={(e) => setCustomCode(e.target.value)}
              className="input-field font-mono flex-1"
              placeholder="Set your own, e.g. goa2026"
            />
            <button type="submit" disabled={savingCode || !customCode.trim()} className="btn-secondary shrink-0">
              {savingCode ? 'Saving…' : 'Set'}
            </button>
          </form>
          {codeError ? <p className="text-brick text-xs">{codeError}</p> : null}
          <div className="flex items-center justify-between gap-3 pt-2 border-t border-dashed border-rule">
            <div>
              <p className="label-eyebrow mb-1">Danger zone</p>
              <p className="text-xs text-ink-faint">Deletes this group and every expense/settlement in it. Can't be undone.</p>
            </div>
            <button
              onClick={handleDeleteGroup}
              disabled={deletingGroup}
              className="text-xs px-2.5 py-1.5 rounded-md border border-brick/40 text-brick hover:bg-brick/10 transition-colors shrink-0"
            >
              {deletingGroup ? 'Deleting…' : 'Delete group'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="tab-bar">
        <button onClick={() => setView('expenses')} className={`tab-link ${view === 'expenses' ? 'tab-link-active' : ''}`}>
          Expenses
        </button>
        <button onClick={() => setView('settle')} className={`tab-link ${view === 'settle' ? 'tab-link-active' : ''}`}>
          Settle up
        </button>
      </div>

      {view === 'expenses' ? (
        <>
          <button className="btn-primary w-full mb-4" onClick={() => setShowAdd(true)}>
            + Add expense
          </button>
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
                    currency={currency}
                    canManage={isAdmin || e.created_by === user?.id}
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
          <button onClick={handleComputeSettlement} disabled={computing} className="btn-primary w-full">
            {computing ? 'Splitting…' : settlements.length > 0 ? 'Re-split' : 'Split up'}
          </button>

          <SettlementSummary
            settlements={settlements}
            currency={currency}
            canMarkPaid={(s) => s.from_user === user?.id || s.to_user === user?.id || isAdmin}
            onTogglePaid={toggleSettlementPaid}
          />
        </div>
      )}

      {(showAdd || editingExpense) && primarySessionId && user ? (
        <AddExpenseModal
          sessionId={primarySessionId}
          currency={currency}
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

      <Link
        to={`/groups/${groupId}/insights`}
        aria-label="Ask the AI about spending patterns"
        title="Ask the AI about spending patterns"
        className="fab"
      >
        ✦
      </Link>
    </Layout>
  );
}
