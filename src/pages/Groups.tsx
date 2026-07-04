import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type { Group } from '@/types';

type GroupWithRole = Group & { role: 'admin' | 'member'; member_count: number };
type Filter = 'all' | 'admin' | 'member';

export function Groups() {
  const { user } = useAuth();
  const [groups, setGroups] = useState<GroupWithRole[]>([]);
  const [sessionCounts, setSessionCounts] = useState<{ open: number; settled: number }>({ open: 0, settled: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      const { data: sessions } = await supabase
        .from('sessions')
        .select('status')
        .in('group_id', withCounts.map((g) => g.id));
      const open = (sessions ?? []).filter((s) => s.status === 'open').length;
      const settled = (sessions ?? []).filter((s) => s.status === 'settled').length;
      setSessionCounts({ open, settled });
    } else {
      setSessionCounts({ open: 0, settled: 0 });
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
    setBusy(true);
    setError(null);
    const { error: insertError } = await supabase
      .from('groups')
      .insert({ name: newGroupName, created_by: user.id });
    setBusy(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setNewGroupName('');
    setShowCreate(false);
    loadGroups();
  };

  const handleJoin = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('join_group_by_code', {
      code: joinCode.trim().toLowerCase()
    });
    setBusy(false);
    if (rpcError) {
      setError('Invalid invite code.');
      return;
    }
    setJoinCode('');
    setShowJoin(false);
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
        <div className="stat-card stat-card-active">
          <p className="stat-card-label">Total groups</p>
          <p className="stat-card-value">{groups.length}</p>
          <p className="stat-card-sub">{adminCount} as admin</p>
        </div>
        <div className="stat-card">
          <p className="stat-card-label">You administer</p>
          <p className="stat-card-value">{adminCount}</p>
          <p className="stat-card-sub">{memberCount} as member</p>
        </div>
        <div className="stat-card">
          <p className="stat-card-label">Open sessions</p>
          <p className="stat-card-value">{sessionCounts.open}</p>
          <p className="stat-card-sub">across all groups</p>
        </div>
        <div className="stat-card">
          <p className="stat-card-label">Settled sessions</p>
          <p className="stat-card-value">{sessionCounts.settled}</p>
          <p className="stat-card-sub">fully wrapped up</p>
        </div>
      </div>

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
          <label className="label-eyebrow block">Group name</label>
          <input
            required
            autoFocus
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            className="input-field"
            placeholder="Goa Trippers"
          />
          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? 'Creating…' : 'Create group'}
          </button>
        </form>
      ) : null}

      {showJoin ? (
        <form onSubmit={handleJoin} className="receipt-card p-4 mb-4 space-y-3">
          <label className="label-eyebrow block">Invite code</label>
          <input
            required
            autoFocus
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            className="input-field font-mono"
            placeholder="e.g. a1b2c3d4"
          />
          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? 'Joining…' : 'Join group'}
          </button>
        </form>
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
              <Link to={`/groups/${g.id}`} className="list-row">
                <span className="avatar-circle">{g.name.charAt(0)}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{g.name}</p>
                  <p className="text-xs text-ink-faint mt-0.5">
                    {g.member_count} member{g.member_count === 1 ? '' : 's'} · #{g.invite_code}
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
    </Layout>
  );
}
