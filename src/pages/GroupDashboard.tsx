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
 * A group is now just one continuous shared ledger — there's no more
 * user-facing concept of "sessions". Under the hood, expenses still
 * hang off a session row (schema left as-is to avoid a risky data
 * migration), but this page transparently aggregates every session
 * that belongs to the group into a single view, and always writes new
 * expenses to the earliest ("primary") one. Nobody sees a session list,
 * a "+ New session" button, or a per-session passkey anymore — the
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

  const [copiedCode, setCopiedCode] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [showCustomCode, setShowCustomCode] = useState(false);
  const [customCode, setCustomCode] = useState('');
  const [savingCode, setSavingCode] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Which stat card's detail panel is open (only one at a time), rendered
  // just below the card row. 'passkey' is the admin-only management panel
  // that used to be its own always-visible box — it's now a same-sized
  // tile alongside the other three, expanding on click instead of eating
  // vertical space by default.
  const [expandedPanel, setExpandedPanel] = useState<'spend' | 'expenses' | 'members' | 'passkey' | null>(null);
  // Which member row (inside the Members panel) has its contribution total
  // revealed. Only one at a time, mirroring the stat-card expand pattern.
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);

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

  // Detail-panel data — computed from state already in memory, no extra queries.
  const paidByMember = [...members]
    .map((m) => ({
      member: m,
      total: expenses.filter((e) => e.paid_by === m.user_id).reduce((sum, e) => sum + e.amount, 0)
    }))
    .sort((a, b) => b.total - a.total);
  const recentExpenses = expenses.slice(0, 5);

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

  // Currency lives on the sessions, not per-expense — picking a new one on
  // the add-expense form just relabels the whole group going forward.
  const handleCurrencyChange = async (newCurrency: string) => {
    if (sessionIds.length === 0) return;
    await supabase.from('sessions').update({ currency: newCurrency }).in('id', sessionIds);
    setCurrency(newCurrency);
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
    setDeletingGroup(true);
    const { error } = await supabase.from('groups').delete().eq('id', groupId);
    setDeletingGroup(false);
    if (error) {
      setDeleteError(error.message);
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
        </div>
      </div>

      <div className={`grid grid-cols-2 ${isAdmin ? 'sm:grid-cols-4' : 'sm:grid-cols-3'} gap-3 mb-3`}>
        <button
          type="button"
          onClick={() => setExpandedPanel((v) => (v === 'spend' ? null : 'spend'))}
          className={`stat-card stat-card-accent-emerald text-left ${expandedPanel === 'spend' ? 'bg-ink/5' : ''}`}
        >
          <p className="stat-card-label">Total spend</p>
          <p className="stat-card-value text-lg">{formatCurrency(totalSpend, currency)}</p>
        </button>
        <button
          type="button"
          onClick={() => setExpandedPanel((v) => (v === 'expenses' ? null : 'expenses'))}
          className={`stat-card stat-card-accent-violet text-left ${expandedPanel === 'expenses' ? 'bg-ink/5' : ''}`}
        >
          <p className="stat-card-label">Expenses</p>
          <p className="stat-card-value">{expenses.length}</p>
        </button>
        <button
          type="button"
          onClick={() => setExpandedPanel((v) => (v === 'members' ? null : 'members'))}
          className={`stat-card stat-card-accent-amber text-left ${expandedPanel === 'members' ? 'bg-ink/5' : ''}`}
        >
          <p className="stat-card-label">Members</p>
          <p className="stat-card-value">{members.length}</p>
        </button>
        {isAdmin ? (
          <button
            type="button"
            onClick={() => setExpandedPanel((v) => (v === 'passkey' ? null : 'passkey'))}
            className={`stat-card stat-card-accent-neutral text-left ${expandedPanel === 'passkey' ? 'bg-ink/5' : ''}`}
          >
            <p className="stat-card-label">Passkey</p>
            <p className="stat-card-value text-lg font-mono truncate">{group.access_code}</p>
          </button>
        ) : null}
      </div>

      {expandedPanel === 'spend' ? (
        <div className="receipt-card p-4 mb-5">
          <p className="label-eyebrow mb-3">Who's paid what</p>
          {paidByMember.every((p) => p.total === 0) ? (
            <p className="text-sm text-ink-soft">No expenses yet.</p>
          ) : (
            <ul className="space-y-2">
              {paidByMember.map(({ member, total }) => (
                <li key={member.user_id} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-ink-soft truncate">
                    {member.user_id === user?.id ? 'You' : `@${member.profile?.username ?? 'member'}`}
                  </span>
                  <span className="font-mono text-sm shrink-0">{formatCurrency(total, currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {expandedPanel === 'expenses' ? (
        <div className="receipt-card p-4 mb-5">
          <p className="label-eyebrow mb-3">Recent expenses</p>
          {recentExpenses.length === 0 ? (
            <p className="text-sm text-ink-soft">No expenses logged yet.</p>
          ) : (
            <ul className="space-y-2">
              {recentExpenses.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-ink-soft truncate">{e.description}</span>
                  <span className="font-mono text-sm shrink-0">{formatCurrency(e.amount, currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {expandedPanel === 'members' ? (
        <div className="receipt-card p-4 mb-5">
          <p className="label-eyebrow mb-3">Group members</p>
          <p className="text-[11px] text-ink-faint mb-2 -mt-1">Tap a member to see what they've contributed.</p>
          <ul className="space-y-1">
            {members.map((m) => {
              const contributed = expenses
                .filter((e) => e.paid_by === m.user_id)
                .reduce((sum, e) => sum + e.amount, 0);
              const isOpen = expandedMemberId === m.user_id;
              return (
                <li key={m.user_id}>
                  <button
                    type="button"
                    onClick={() => setExpandedMemberId((v) => (v === m.user_id ? null : m.user_id))}
                    className={`w-full flex items-center gap-2.5 text-left rounded px-1.5 py-1.5 -mx-1.5 transition-colors ${isOpen ? 'bg-ink/5' : ''}`}
                  >
                    <span className="avatar-circle text-xs" aria-hidden>
                      {m.profile?.username?.charAt(0)?.toUpperCase() ?? '•'}
                    </span>
                    <span className="text-sm text-ink-soft truncate flex-1">
                      {m.user_id === user?.id ? 'You' : `@${m.profile?.username ?? 'member'}`}
                    </span>
                    {m.role === 'admin' ? <span className="status-pill bg-emerald-light text-emerald-dark">Admin</span> : null}
                    {isOpen ? (
                      <span className="font-mono text-sm shrink-0 text-emerald">{formatCurrency(contributed, currency)}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {expandedPanel === 'passkey' && isAdmin ? (
        <div className="receipt-card px-3 py-2 mb-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <p className="label-eyebrow shrink-0">Key</p>
              <button
                onClick={copyAccessCode}
                title="Share this so guests can jump straight into this group without an account."
                className="font-mono text-xs text-emerald hover:underline truncate"
              >
                {copiedCode ? 'Copied!' : group.access_code}
              </button>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={regenerateAccessCode}
                disabled={regenerating}
                className="text-[11px] text-ink-faint hover:text-ink transition-colors"
              >
                {regenerating ? '…' : 'Random'}
              </button>
              <button
                onClick={() => setShowCustomCode((v) => !v)}
                className="text-[11px] text-ink-faint hover:text-ink transition-colors"
              >
                Custom
              </button>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                title="Delete this group"
                className="text-[11px] text-brick/70 hover:text-brick transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
          {showCustomCode ? (
            <form onSubmit={handleSetCustomCode} className="flex items-center gap-2 mt-2 pt-2 border-t border-dashed border-rule">
              <input
                autoFocus
                value={customCode}
                onChange={(e) => setCustomCode(e.target.value)}
                className="input-field font-mono flex-1 text-xs py-1"
                placeholder="Custom, e.g. goa2026"
              />
              <button
                type="submit"
                disabled={savingCode || !customCode.trim()}
                className="btn-secondary shrink-0 text-[11px] px-2 py-1"
              >
                {savingCode ? '…' : 'Set'}
              </button>
            </form>
          ) : null}
          {codeError ? <p className="text-brick text-[11px] mt-1">{codeError}</p> : null}
        </div>
      ) : null}

      {showDeleteConfirm ? (
        <div className="fixed inset-0 bg-ink/40 flex items-end sm:items-center justify-center z-20 p-0 sm:p-4">
          <div className="bg-paper w-full sm:max-w-sm sm:rounded-lg rounded-t-2xl overflow-y-auto">
            <div className="p-5 border-b border-rule flex items-center justify-between">
              <h2 className="font-mono font-semibold">Delete group</h2>
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteError(null);
                }}
                className="text-ink-faint hover:text-ink text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-ink-soft">
                Delete <span className="text-ink font-medium">"{group.name}"</span>? This permanently removes every
                expense, member, and settlement in it — this can't be undone.
              </p>
              {deleteError ? <p className="text-brick text-sm">{deleteError}</p> : null}
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteError(null);
                  }}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button onClick={handleDeleteGroup} disabled={deletingGroup} className="btn-danger flex-1">
                  {deletingGroup ? 'Deleting…' : 'Delete group'}
                </button>
              </div>
            </div>
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

      {(showAdd || editingExpense) && primarySessionId && groupId && user ? (
        <AddExpenseModal
          groupId={groupId}
          sessionId={primarySessionId}
          currency={currency}
          onCurrencyChange={handleCurrencyChange}
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
