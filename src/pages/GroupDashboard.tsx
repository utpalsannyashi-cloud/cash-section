import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { AddExpenseModal, ParticipantLike } from '@/components/AddExpenseModal';
import { ExpenseCard } from '@/components/ExpenseCard';
import { SettlementSummary } from '@/components/SettlementSummary';
import { JoinRequestsPanel } from '@/components/JoinRequestsPanel';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { deriveTotals, findDepartedCredits, simplifyDebts } from '@/utils/settlement';
import { formatCurrency } from '@/utils/currency';
import type { ContributionSource, Expense, Group, GroupMember, Settlement } from '@/types';

const CODE_PATTERN = /^[a-z0-9]{6,20}$/;

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

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
  // Loaded up front rather than only at settle-up time, so the group can
  // be told about money owed to a removed member before anyone presses
  // Split up.
  const [splits, setSplits] = useState<{ user_id: string; share: number; expense_id: string }[]>([]);
  // Admin's call on what to do with that money. 'repay' keeps the
  // departed member in the settlement as a creditor; 'absorb' spreads
  // their credit across everyone still here instead.
  const [departedCreditMode, setDepartedCreditMode] = useState<'repay' | 'absorb'>('repay');
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

  // Admin-only: remove a member from the group. RLS already permits this
  // (group_members_delete_admin_or_self), so this is purely a UI addition —
  // their past expenses stay in the ledger since expenses reference the
  // profile, not the membership row.
  const [removeMemberTarget, setRemoveMemberTarget] = useState<GroupMember | null>(null);
  const [removingMember, setRemovingMember] = useState(false);
  const [removeMemberError, setRemoveMemberError] = useState<string | null>(null);

  // Admin-only: change when a member's cost-sharing "clock" starts (see
  // migration 0014). Affects only future equal-split expenses — never
  // rewrites expense_splits that already exist.
  const [contributionEditTarget, setContributionEditTarget] = useState<GroupMember | null>(null);
  const [contributionCustomDate, setContributionCustomDate] = useState('');
  const [savingContribution, setSavingContribution] = useState(false);
  const [contributionError, setContributionError] = useState<string | null>(null);
  // Toggles the "From a specific expense" sub-list inside the contribution
  // modal (see migration 0015) — kept separate from the other three presets
  // since it needs to show a scrollable pick-list rather than a single tap.
  const [showExpensePicker, setShowExpensePicker] = useState(false);

  // Admin-only: the settlement checkpoint (see handleStartFreshRound /
  // handleResetSettlementCheckpoint below, and settled_through on Group).
  // Surfaced so a failed update() is never silently swallowed.
  const [checkpointError, setCheckpointError] = useState<string | null>(null);

  // Bundles a checkpoint into the "set contribution start" flow below.
  // Setting a member's contribution_start_date only ever changes who's
  // folded into NEW equal-split expenses — it was never meant to (and
  // doesn't) retroactively exclude older expenses from the next re-split.
  // That's what settled_through does, but it's a separate, easy-to-miss
  // action — this lets an admin opt into both from one place instead of
  // needing to discover "Start a fresh round" on their own afterwards.
  const [alsoStartFreshRound, setAlsoStartFreshRound] = useState(false);

  // Toggles the "start fresh round from a specific expense" pick-list —
  // same shape as showExpensePicker above, but writes settled_through on
  // the group directly instead of a member's contribution_start_expense_id.
  const [showFreshRoundPicker, setShowFreshRoundPicker] = useState(false);

  // Surfaced next to the expense list / settle-up list respectively, so a
  // failed delete() is never silently swallowed — matches checkpointError
  // above and the same bug class that made settled_through updates
  // disappear without a trace.
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const [settlementError, setSettlementError] = useState<string | null>(null);

  // Replaces window.confirm() for every destructive/one-way action on this
  // page (delete expense, delete settlement, start/reset a fresh round) —
  // the native dialog can't be styled, so it looked jarringly out of place
  // next to the rest of the themed UI. One slot is enough since only one
  // confirmation is ever open at a time; each call site fills in its own
  // copy and the action to run if the admin confirms.
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    tone?: 'danger' | 'primary';
    onConfirm: () => void;
  } | null>(null);

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
          .order('created_at', { ascending: false })
      ]);
      setExpenses((exp as unknown as Expense[]) ?? []);
      setSettlements((settl as unknown as Settlement[]) ?? []);

      // Needed to work out whether anyone who's been removed is still
      // owed money. Cheap enough to load with everything else.
      const { data: spl } = await supabase
        .from('expense_splits')
        .select('user_id, share, expense_id, expenses!inner(session_id)')
        .in('expenses.session_id', ids);
      setSplits(((spl as unknown as { user_id: string; share: number; expense_id: string }[]) ?? []).map((r) => ({
        user_id: r.user_id,
        share: Number(r.share),
        expense_id: r.expense_id
      })));
    } else {
      setExpenses([]);
      setSettlements([]);
      setSplits([]);
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

    // Membership changes (a partner added mid-session, someone leaving, a
    // contribution-start edit) also need to refresh the page live -- without
    // this, a tab left open across such a change can keep computing
    // settlements against a stale member list, silently mis-splitting new
    // expenses until the page is reloaded.
    useEffect(() => {
          if (!groupId) return;
          const channel = supabase
            .channel(`group-members-${groupId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members', filter: `group_id=eq.${groupId}` }, () => load())
            .subscribe();

          return () => {
                  supabase.removeChannel(channel);
          };
    }, [groupId, load]);

  const totalSpend = expenses.reduce((sum, e) => sum + e.amount, 0);
  // A member only counts toward NEW equal-split expenses once today's date
  // reaches their contribution_start_date — lets an admin backdate liability
  // to the group's founding, or delay it to a custom date, without touching
  // any expense_splits rows already saved.
  const todayStr = new Date().toISOString().slice(0, 10);
  const activeMembers = members.filter((m) => m.contribution_start_date <= todayStr);
  const participants: ParticipantLike[] = activeMembers.map((m) => ({ user_id: m.user_id, profile: m.profile }));

  // Detail-panel data — computed from state already in memory, no extra queries.
  const paidByMember = [...members]
    .map((m) => ({
      member: m,
      total: expenses.filter((e) => e.paid_by === m.user_id).reduce((sum, e) => sum + e.amount, 0)
    }))
    .sort((a, b) => b.total - a.total);
  const recentExpenses = expenses.slice(0, 5);

  // Someone an admin removed who had paid out more than they consumed.
  // The group still owes them, and until this was handled the money
  // quietly disappeared from the settlement.
  const settleableExpenses = group?.settled_through
    ? expenses.filter((e) => new Date(e.created_at) > new Date(group.settled_through as string))
    : expenses;
  const settleableExpenseIds = new Set(settleableExpenses.map((e) => e.id));
  const settleableSplits = group?.settled_through
    ? splits.filter((s) => settleableExpenseIds.has(s.expense_id))
    : splits;

  const departedCredits = findDepartedCredits(
    activeMembers.map((m) => m.user_id),
    settleableExpenses.map((e) => ({ paid_by: e.paid_by, amount: Number(e.amount) })),
    settleableSplits
  );
  const departedTotal = departedCredits.reduce((sum, d) => sum + d.amount, 0);
  // They're gone from group_members, so their name has to come from an
  // expense they paid for.
  const departedName = (userId: string) =>
    expenses.find((e) => e.paid_by === userId)?.payer?.username ?? 'a former member';

  // Looks up the description of the expense a member's contribution is
  // pinned to (contribution_start_source === 'expense'), so the Members
  // panel can show something more specific than just a date. Falls back to
  // undefined if the expense isn't in the currently loaded list (e.g. it
  // was since deleted — contribution_start_expense_id would already be
  // null in that case, since the column is ON DELETE SET NULL).
  const contributionStartExpenseLabel = (m: GroupMember): string | undefined =>
    expenses.find((e) => e.id === m.contribution_start_expense_id)?.description;

  const handleDeleteExpense = (id: string) => {
    const expense = expenses.find((e) => e.id === id);
    setConfirmDialog({
      title: 'Delete expense?',
      message: `Delete "${expense?.description ?? 'this expense'}"? This can't be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
      onConfirm: async () => {
        setConfirmDialog(null);
        setExpenseError(null);
        const { error } = await supabase.from('expenses').delete().eq('id', id);
        if (error) {
          setExpenseError(error.message);
          return;
        }
        load();
      }
    });
  };

  // Purely cosmetic strike-through, independent of the settled_through
  // checkpoint below — see migration 0025. No confirm dialog: it's
  // reversible with one more click, same as toggleSettlementPaid.
  const handleToggleExpenseSettled = async (expense: Expense) => {
    setExpenseError(null);
    const next = !expense.marked_settled;
    const { error } = await supabase
      .from('expenses')
      .update({ marked_settled: next, settled_at: next ? new Date().toISOString() : null })
      .eq('id', expense.id);
    if (error) {
      setExpenseError(error.message);
      return;
    }
    load();
  };

  const handleEditExpense = (expense: Expense) => {
    setEditingExpense(expense);
  };

  const closeExpenseModal = () => {
    setShowAdd(false);
    setEditingExpense(null);
  };

  const handleStartFreshRound = () => {
    if (!groupId) return;
    setConfirmDialog({
      title: 'Start a fresh round?',
      message: "Expenses added so far will be marked settled and won't be included the next time you split up.",
      confirmLabel: 'Start fresh round',
      tone: 'primary',
      onConfirm: async () => {
        setConfirmDialog(null);
        setCheckpointError(null);
        const newCheckpoint = new Date().toISOString();
        const { error } = await supabase
          .from('groups')
          .update({ settled_through: newCheckpoint })
          .eq('id', groupId);
        if (error) {
          setCheckpointError(error.message);
          return;
        }
        await load();
        // Auto-recompute so the new cutoff takes effect immediately
        await handleComputeSettlement(newCheckpoint);
      }
    });
  };

  // Same idea as handleStartFreshRound above, but lets the admin pick the
  // boundary explicitly instead of always using "now". The clicked expense
  // ITSELF should count in the next split (not be excluded) — only the
  // expenses strictly before it are marked settled. `expenses` is ordered
  // newest-first, so the array entry right after the clicked one is the
  // next-older expense; its created_at becomes the new (exclusive)
  // settled_through checkpoint. handleComputeSettlement's
  // `.gt('created_at', settled_through)` does the rest. If the clicked
  // expense is the oldest one, there's nothing to exclude, so the
  // checkpoint is cleared entirely (null) and every expense counts.
  const handleStartFreshRoundFromExpense = (expenseId: string) => {
    if (!groupId) return;
    const index = expenses.findIndex((e) => e.id === expenseId);
    if (index === -1) return;
    const expense = expenses[index];
    const previousExpense = expenses[index + 1];
    const newCheckpoint = previousExpense ? previousExpense.created_at : null;
    setConfirmDialog({
      title: 'Start a fresh round?',
      message: `Start a fresh round from "${expense.description}"? Everything before it will be marked settled, and "${expense.description}" onward will count in the next split up.`,
      confirmLabel: 'Start fresh round',
      tone: 'primary',
      onConfirm: async () => {
        setConfirmDialog(null);
        setCheckpointError(null);
        const { error } = await supabase
          .from('groups')
          .update({ settled_through: newCheckpoint })
          .eq('id', groupId);
        if (error) {
          setCheckpointError(error.message);
          return;
        }
        setShowFreshRoundPicker(false);
        await load();
        // Auto-recompute so the new cutoff takes effect immediately
        await handleComputeSettlement(newCheckpoint);
      }
    });
  };

  const handleResetSettlementCheckpoint = () => {
    if (!groupId) return;
    setConfirmDialog({
      title: 'Reset checkpoint?',
      message: 'Include every expense in the next split again?',
      confirmLabel: 'Reset',
      tone: 'primary',
      onConfirm: async () => {
        setConfirmDialog(null);
        setCheckpointError(null);
        const { error } = await supabase.from('groups').update({ settled_through: null }).eq('id', groupId);
        if (error) {
          setCheckpointError(error.message);
          return;
        }
        await load();
      }
    });
  };

  const handleComputeSettlement = async (overrideCutoff?: string | null) => {
    if (sessionIds.length === 0) return;
    setComputing(true);

    const cutoff = overrideCutoff !== undefined ? overrideCutoff : group?.settled_through;
    let expensesQuery = supabase.from('expenses').select('id, paid_by, amount').in('session_id', sessionIds);
    if (cutoff) {
      expensesQuery = expensesQuery.gt('created_at', cutoff);
    }
    const { data: allExpenses } = await expensesQuery;
    const settleableIds = (allExpenses ?? []).map((e: any) => e.id);
    const { data: allSplits } =
      settleableIds.length === 0
        ? { data: [] as any[] }
        : await supabase.from('expense_splits').select('user_id, share, expense_id').in('expense_id', settleableIds);

    const participantIds = activeMembers.map((m) => m.user_id);
    const totals = deriveTotals(participantIds, allExpenses ?? [], (allSplits as any) ?? [], {
      departedCredits: departedCreditMode
    });
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

  // ... rest of the file continues with the corrected picker text and other unchanged code
}