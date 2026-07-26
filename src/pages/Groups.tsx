import { FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency } from '@/utils/currency';
import type { Group } from '@/types';

type GroupWithRole = Group & { role: 'admin' | 'member'; member_count: number };
type Filter = 'all' | 'admin' | 'member';
type ExpenseOverview = { id: string; description: string; amount: number; group_id: string; group_name: string; created_at: string };

const CODE_PATTERN = /^[a-z0-9]{6,20}$/;

export function Groups() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<GroupWithRole[]>([]);
  const [expenseTotals, setExpenseTotals] = useState<{ count: number; spend: number }>({ count: 0, spend: 0 });
  const [expensesOverview, setExpensesOverview] = useState<ExpenseOverview[]>([]);
  const [expandedPanel, setExpandedPanel] = useState<'count' | 'spend' | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [customCode, setCustomCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Distinct from `error`: joining is now a request, so the happy path
  // ends in "waiting on the admin" rather than the group appearing.
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Long-press action sheet (admin-owned groups only): rename, change
  // passkey, or delete — without leaving the groups list.
  const [menuGroup, setMenuGroup] = useState<GroupWithRole | null>(null);
  const [menuMode, setMenuMode] = useState<'menu' | 'rename' | 'passkey' | 'delete'>('menu');
  const [renameValue, setRenameValue] = useState('');
  const [passkeyValue, setPasskeyValue] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const longPressTimer = useRef<number | null>(null);
  const longPressTriggered = useRef(false);

  // AI insights FAB, mirroring the one inside a single group's dashboard.
  // Here there's no single group in scope, so a lone group jumps straight
  // to its insights chat; with more than one, a quick picker asks which
  // group to ask about.
  const [showInsightsPicker, setShowInsightsPicker] = useState(false);
  const handleAskAi = () => {
    if (groups.length === 0) return;
    if (groups.length === 1) {
      navigate(`/groups/${groups[0].id}/insights`);
      return;
    }
    setShowInsightsPicker(true);
  };

  const loadGroups = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('groups')
      .select('*, group_members!inner(user_id, role)')
      .eq('group_members.user_id', user?.id)
      .order('created_at', { ascending: false });

    const rows = ((data as any[]) ?? []).map((g) => ({
      ...g,
      role: g.group_members?.[0]?.role ?? 'member'
    })) as GroupWithRole[];

    // Member counts, one lightweight query per group's roster size.
    const withCounts = await Promise.all(
      rows.map(async (g) => {
        const { count } = await supabase
          .from('group_members')
          .select('*', { count: 'exact', head: true })
          .eq('group_id', g.id);
        return { ...g, member_count: count ?? 0 };
      })
    );
    setGroups(withCounts);

    if (withCounts.length > 0) {
      // Expenses hang off a session row internally, but that's no longer a
      // user-facing concept — so pull every session under these groups just
      // to map expenses back to a group id/name for the overview below.
      const { data: sessions } = await supabase
        .from('sessions')
        .select('id, group_id')
        .in('group_id', withCounts.map((g) => g.id));
      const sessionIds = (sessions ?? []).map((s) => s.id);
      const groupIdForSession = new Map((sessions ?? []).map((s) => [s.id, s.group_id]));

      if (sessionIds.length > 0) {
        const { data: exp } = await supabase
          .from('expenses')
          .select('id, description, amount, created_at, session_id')
          .in('session_id', sessionIds)
          .order('created_at', { ascending: false });

        const withGroupName = (exp ?? []).map((e) => {
          const gid = groupIdForSession.get(e.session_id) ?? '';
          return {
            id: e.id,
            description: e.description,
            amount: Number(e.amount),
            created_at: e.created_at,
            group_id: gid,
            group_name: withCounts.find((g) => g.id === gid)?.name ?? ''
          };
        }) as ExpenseOverview[];

        setExpensesOverview(withGroupName);
        setExpenseTotals({
          count: withGroupName.length,
          spend: withGroupName.reduce((sum, e) => sum + e.amount, 0)
        });
      } else {
        setExpensesOverview([]);
        setExpenseTotals({ count: 0, spend: 0 });
      }
    } else {
      setExpensesOverview([]);
      setExpenseTotals({ count: 0, spend: 0 });
    }

    setLoading(false);
  };

  useEffect(() => {
    if (user) loadGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const adminCount = groups.filter((g) => g.role === 'admin').length;
  const memberCount = groups.filter((g) => g.role === 'member').length;

  const visibleGroups = useMemo(() => {
    return groups.filter((g) => {
      if (filter === 'admin' && g.role !== 'admin') return false;
      if (filter === 'member' && g.role !== 'member') return false;
      if (search.trim() && !g.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
  }, [groups, filter, search]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError(null);
    setCodeError(null);

    const code = customCode.trim().toLowerCase();
    if (code && !CODE_PATTERN.test(code)) {
      setCodeError('Use 6–20 lowercase letters/numbers, e.g. goa2026.');
      return;
    }

    setBusy(true);
    const { error: rpcError } = await supabase.rpc('create_group', {
      p_name: newGroupName,
      p_access_code: code || null
    });
    setBusy(false);
    if (rpcError) {
      if (rpcError.message.includes('duplicate') || rpcError.message.includes('already taken')) {
        setCodeError('That passkey is already taken — pick another.');
      } else if (rpcError.message.includes('6–20') || rpcError.message.includes('passkey')) {
        setCodeError(rpcError.message);
      } else {
        setError(rpcError.message);
      }
      return;
    }
    setNewGroupName('');
    setCustomCode('');
    setShowCreate(false);
    loadGroups();
  };

  const handleJoin = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    // unlock_group_by_code verifies the group's passkey and — as of
    // migration 0016 — raises a join request instead of adding the
    // caller straight into group_members. Approval is the admin's call,
    // so the same wait applies to account holders as to passkey guests.
    const { data, error: rpcError } = await supabase.rpc('unlock_group_by_code', {
      code: joinCode.trim().toLowerCase()
    });
    setBusy(false);

    if (rpcError) {
      setError(
        /Too many incorrect passkeys/i.test(rpcError.message) ? rpcError.message : 'Invalid passkey.'
      );
      return;
    }

    const result = data as { status: string; group_id: string; group_name: string };
    setJoinCode('');
    setShowJoin(false);

    if (result.status === 'member') {
      loadGroups();
      return;
    }
    if (result.status === 'denied') {
      setError(`${result.group_name}'s admin didn't approve your request to join.`);
      return;
    }
    setNotice(
      `Asked ${result.group_name}'s admin to let you in. The group shows up here once they approve.`
    );
  };

  const openMenu = (g: GroupWithRole) => {
    setMenuGroup(g);
    setMenuMode('menu');
    setRenameValue(g.name);
    setPasskeyValue('');
    setActionError(null);
  };

  const closeMenu = () => {
    setMenuGroup(null);
    setMenuMode('menu');
    setActionError(null);
  };

  // Pointer-based long-press: works for touch and mouse alike. A short
  // tap still navigates into the group as normal; holding for ~550ms
  // opens the action sheet instead and swallows the click that follows.
  const handlePointerDown = (g: GroupWithRole) => {
    if (g.role !== 'admin') return;
    longPressTriggered.current = false;
    longPressTimer.current = window.setTimeout(() => {
      longPressTriggered.current = true;
      openMenu(g);
    }, 550);
  };

  const clearLongPress = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleRowClick = (e: MouseEvent) => {
    if (longPressTriggered.current) {
      e.preventDefault();
      longPressTriggered.current = false;
    }
  };

  const handleRename = async (e: FormEvent) => {
    e.preventDefault();
    if (!menuGroup) return;
    const trimmed = renameValue.trim();
    if (!trimmed) return;
    setActionBusy(true);
    setActionError(null);
    const { error: updateError } = await supabase.from('groups').update({ name: trimmed }).eq('id', menuGroup.id);
    setActionBusy(false);
    if (updateError) {
      setActionError(updateError.message);
      return;
    }
    closeMenu();
    loadGroups();
  };

  const handleChangePasskey = async (e: FormEvent) => {
    e.preventDefault();
    if (!menuGroup) return;
    const code = passkeyValue.trim().toLowerCase();
    if (!CODE_PATTERN.test(code)) {
      setActionError('Use 6–20 lowercase letters/numbers, e.g. goa2026.');
      return;
    }
    setActionBusy(true);
    setActionError(null);
    const { error: updateError } = await supabase.from('groups').update({ access_code: code }).eq('id', menuGroup.id);
    setActionBusy(false);
    if (updateError) {
      setActionError(
        updateError.message.includes('duplicate') ? 'That passkey is already taken — pick another.' : updateError.message
      );
      return;
    }
    closeMenu();
    loadGroups();
  };

  const handleRandomPasskey = async () => {
    if (!menuGroup) return;
    setActionBusy(true);
    setActionError(null);
    const newCode = Math.random().toString(36).slice(2, 8);
    const { error: updateError } = await supabase.from('groups').update({ access_code: newCode }).eq('id', menuGroup.id);
    setActionBusy(false);
    if (updateError) {
      setActionError(updateError.message);
      return;
    }
    closeMenu();
    loadGroups();
  };

  const handleDeleteGroup = async () => {
    if (!menuGroup) return;
    setActionBusy(true);
    setActionError(null);
    const { error: deleteError } = await supabase.from('groups').delete().eq('id', menuGroup.id);
    setActionBusy(false);
    if (deleteError) {
      setActionError(deleteError.message);
      return;
    }
    closeMenu();
    loadGroups();
  };

  return (
    <Layout>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="font-mono text-xl font-semibold">Your groups</h1>
          <p className="text-ink-soft text-sm mt-0.5">Where every outing starts.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`stat-card stat-card-accent-emerald w-full text-left hover:bg-ink/5 ${filter === 'all' ? 'bg-ink/5' : ''}`}
        >
          <p className="stat-card-label">Total groups</p>
          <p className="stat-card-value">{groups.length}</p>
          <p className="stat-card-sub">{adminCount} as admin</p>
        </button>
        <button
          type="button"
          onClick={() => setFilter('admin')}
          className={`stat-card stat-card-accent-violet w-full text-left hover:bg-ink/5 ${filter === 'admin' ? 'bg-ink/5' : ''}`}
        >
          <p className="stat-card-label">You administer</p>
          <p className="stat-card-value">{adminCount}</p>
          <p className="stat-card-sub">{memberCount} as member</p>
        </button>
        <button
          type="button"
          onClick={() => setExpandedPanel((v) => (v === 'count' ? null : 'count'))}
          className={`stat-card stat-card-accent-amber w-full text-left hover:bg-ink/5 ${expandedPanel === 'count' ? 'bg-ink/5' : ''}`}
        >
          <p className="stat-card-label">Total expenses</p>
          <p className="stat-card-value">{expenseTotals.count}</p>
          <p className="stat-card-sub">across all groups</p>
        </button>
        <button
          type="button"
          onClick={() => setExpandedPanel((v) => (v === 'spend' ? null : 'spend'))}
          className={`stat-card stat-card-accent-neutral w-full text-left hover:bg-ink/5 ${expandedPanel === 'spend' ? 'bg-ink/5' : ''}`}
        >
          <p className="stat-card-label">Total spend</p>
          <p className="stat-card-value text-lg">{formatCurrency(expenseTotals.spend, 'INR')}</p>
          <p className="stat-card-sub">logged so far</p>
        </button>
      </div>

      {expandedPanel ? (
        <div className="receipt-card p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="label-eyebrow">Recent expenses</p>
            <button onClick={() => setExpandedPanel(null)} className="text-xs text-ink-faint hover:text-ink transition-colors">
              Close
            </button>
          </div>
          {expensesOverview.length === 0 ? (
            <p className="text-sm text-ink-soft">No expenses logged yet.</p>
          ) : (
            <ul className="space-y-1">
              {expensesOverview.slice(0, 10).map((e) => (
                <li key={e.id}>
                  <Link
                    to={`/groups/${e.group_id}`}
                    className="flex items-center justify-between gap-2 py-2 px-1 -mx-1 rounded hover:bg-ink/5 transition-colors"
                  >
                    <span className="text-sm font-medium truncate">{e.description}</span>
                    <span className="text-xs text-ink-faint shrink-0">
                      {formatCurrency(e.amount, 'INR')} · {e.group_name}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="flex gap-2 mb-4">
        <button className="btn-primary flex-1" onClick={() => setShowCreate((v) => !v)}>
          + New group
        </button>
        <button className="btn-secondary flex-1" onClick={() => setShowJoin((v) => !v)}>
          Join with code
        </button>
      </div>

      {showCreate ? (
        <form onSubmit={handleCreate} className="receipt-card p-4 mb-4 space-y-3">
          <div>
            <label className="label-eyebrow block mb-1.5">Group name</label>
            <input
              required
              autoFocus
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              className="input-field"
              placeholder="Goa Trippers"
            />
          </div>
          <div>
            <label className="label-eyebrow block mb-1.5">Passkey (optional)</label>
            <input
              value={customCode}
              onChange={(e) => setCustomCode(e.target.value)}
              className="input-field font-mono"
              placeholder="Leave blank to auto-generate, e.g. goa2026"
            />
            <p className="text-xs text-ink-faint mt-1">
              Guests use this to unlock the whole group without an account. 6–20 lowercase letters/numbers.
            </p>
            {codeError ? <p className="text-brick text-xs mt-1">{codeError}</p> : null}
          </div>
          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? 'Creating…' : 'Create group'}
          </button>
        </form>
      ) : null}

      {showJoin ? (
        <form onSubmit={handleJoin} className="receipt-card p-4 mb-4 space-y-3">
          <label className="label-eyebrow block">Group passkey</label>
          <input
            required
            autoFocus
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            className="input-field font-mono"
            placeholder="e.g. goa2026"
          />
          <p className="text-xs text-ink-faint">
            The group's admin approves each request before you can see any expenses.
          </p>
          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? 'Asking…' : 'Ask to join'}
          </button>
        </form>
      ) : null}

      {notice ? (
        <div className="receipt-card p-3 mb-4 border-l-4 border-l-accent-sky">
          <p className="text-sm text-ink-soft">{notice}</p>
        </div>
      ) : null}

      {error ? <p className="text-brick text-sm mb-4">{error}</p> : null}

      {groups.length > 0 ? (
        <>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field mb-3"
            placeholder="Search groups…"
          />
          <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
            <button className={`chip ${filter === 'all' ? 'chip-active' : ''}`} onClick={() => setFilter('all')}>
              All ({groups.length})
            </button>
            <button className={`chip ${filter === 'admin' ? 'chip-active' : ''}`} onClick={() => setFilter('admin')}>
              You admin ({adminCount})
            </button>
            <button className={`chip ${filter === 'member' ? 'chip-active' : ''}`} onClick={() => setFilter('member')}>
              You're a member ({memberCount})
            </button>
          </div>
        </>
      ) : null}

      {loading ? (
        <p className="label-eyebrow">Loading…</p>
      ) : groups.length === 0 ? (
        <div className="receipt-card p-8 text-center">
          <p className="text-ink-soft text-sm">
            No groups yet. Create one for your next outing, or join with a code someone shared.
          </p>
        </div>
      ) : visibleGroups.length === 0 ? (
        <div className="receipt-card p-8 text-center">
          <p className="text-ink-soft text-sm">No groups match that filter.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visibleGroups.map((g) => (
            <li key={g.id}>
              <Link
                to={`/groups/${g.id}`}
                className={`list-row ${g.role === 'admin' ? 'select-none' : ''}`}
                onClick={handleRowClick}
                onPointerDown={() => handlePointerDown(g)}
                onPointerUp={clearLongPress}
                onPointerLeave={clearLongPress}
                onPointerCancel={clearLongPress}
                onContextMenu={(e) => {
                  // Right-click is the desktop/laptop equivalent of a
                  // long-press — same action sheet, no need to click and
                  // hold with a mouse.
                  if (g.role === 'admin') {
                    e.preventDefault();
                    openMenu(g);
                  }
                }}
              >
                <span className="avatar-circle">{g.name.charAt(0)}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{g.name}</p>
                  <p className="text-xs text-ink-faint mt-0.5">
                    {g.member_count} member{g.member_count === 1 ? '' : 's'}
                  </p>
                </div>
                <span
                  className={`status-pill ${
                    g.role === 'admin' ? 'bg-violet-light text-violet' : 'bg-ink/5 text-ink-faint'
                  }`}
                >
                  {g.role}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {menuGroup ? (
        <div className="fixed inset-0 bg-ink/40 flex items-end sm:items-center justify-center z-20 p-0 sm:p-4">
          <div className="bg-paper w-full sm:max-w-sm sm:rounded-lg rounded-t-2xl overflow-y-auto">
            <div className="p-5 border-b border-rule flex items-center justify-between">
              <h2 className="font-mono font-semibold truncate">{menuGroup.name}</h2>
              <button onClick={closeMenu} className="text-ink-faint hover:text-ink text-xl leading-none shrink-0">
                ×
              </button>
            </div>

            {menuMode === 'menu' ? (
              <div className="p-2">
                <button
                  onClick={() => setMenuMode('rename')}
                  className="w-full text-left px-3 py-3 rounded-md hover:bg-ink/5 transition-colors text-sm"
                >
                  Edit name
                </button>
                <button
                  onClick={() => setMenuMode('passkey')}
                  className="w-full text-left px-3 py-3 rounded-md hover:bg-ink/5 transition-colors text-sm"
                >
                  Change passkey
                </button>
                <button
                  onClick={() => setMenuMode('delete')}
                  className="w-full text-left px-3 py-3 rounded-md hover:bg-brick/10 transition-colors text-sm text-brick"
                >
                  Delete group
                </button>
              </div>
            ) : null}

            {menuMode === 'rename' ? (
              <form onSubmit={handleRename} className="p-5 space-y-3">
                <label className="label-eyebrow block">Group name</label>
                <input
                  required
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="input-field"
                  maxLength={60}
                />
                {actionError ? <p className="text-brick text-xs">{actionError}</p> : null}
                <div className="flex gap-2">
                  <button type="button" onClick={() => setMenuMode('menu')} className="btn-secondary flex-1">
                    Back
                  </button>
                  <button type="submit" disabled={actionBusy} className="btn-primary flex-1">
                    {actionBusy ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </form>
            ) : null}

            {menuMode === 'passkey' ? (
              <form onSubmit={handleChangePasskey} className="p-5 space-y-3">
                <label className="label-eyebrow block">New passkey</label>
                <input
                  required
                  autoFocus
                  value={passkeyValue}
                  onChange={(e) => setPasskeyValue(e.target.value)}
                  className="input-field font-mono"
                  placeholder="e.g. goa2026"
                />
                <p className="text-xs text-ink-faint">6–20 lowercase letters/numbers.</p>
                {actionError ? <p className="text-brick text-xs">{actionError}</p> : null}
                <div className="flex gap-2">
                  <button type="button" onClick={() => setMenuMode('menu')} className="btn-secondary flex-1">
                    Back
                  </button>
                  <button type="submit" disabled={actionBusy} className="btn-primary flex-1">
                    {actionBusy ? 'Saving…' : 'Set'}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleRandomPasskey}
                  disabled={actionBusy}
                  className="text-xs text-ink-faint hover:text-ink transition-colors"
                >
                  Or generate one randomly
                </button>
              </form>
            ) : null}

            {menuMode === 'delete' ? (
              <div className="p-5 space-y-4">
                <p className="text-sm text-ink-soft">
                  Delete <span className="text-ink font-medium">"{menuGroup.name}"</span>? This permanently removes
                  every expense, member, and settlement in it — this can't be undone.
                </p>
                {actionError ? <p className="text-brick text-sm">{actionError}</p> : null}
                <div className="flex gap-2">
                  <button onClick={() => setMenuMode('menu')} className="btn-secondary flex-1">
                    Cancel
                  </button>
                  <button onClick={handleDeleteGroup} disabled={actionBusy} className="btn-danger flex-1">
                    {actionBusy ? 'Deleting…' : 'Delete group'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {showInsightsPicker ? (
        <div className="fixed inset-0 bg-ink/40 flex items-end sm:items-center justify-center z-20 p-0 sm:p-4">
          <div className="bg-paper w-full sm:max-w-sm sm:rounded-lg rounded-t-2xl overflow-y-auto max-h-[70vh]">
            <div className="p-5 border-b border-rule flex items-center justify-between">
              <h2 className="font-mono font-semibold">Ask about which group?</h2>
              <button
                onClick={() => setShowInsightsPicker(false)}
                className="text-ink-faint hover:text-ink text-xl leading-none shrink-0"
              >
                ×
              </button>
            </div>
            <div className="p-2">
              {groups.map((g) => (
                <button
                  key={g.id}
                  onClick={() => navigate(`/groups/${g.id}/insights`)}
                  className="w-full text-left px-3 py-3 rounded-md hover:bg-ink/5 transition-colors text-sm"
                >
                  {g.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {groups.length > 0 ? (
        <button
          type="button"
          onClick={handleAskAi}
          aria-label="Ask the AI about spending patterns"
          title="Ask the AI about spending patterns"
          className="fab"
        >
          ✦
        </button>
      ) : null}
    </Layout>
  );
}
