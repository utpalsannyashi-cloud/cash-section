import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

type StatusFilter = 'all' | 'open' | 'settled';

interface SessionRow {
  id: string;
  title: string;
  status: 'open' | 'settled';
  created_at: string;
  group_id: string;
  group_name: string;
  admin_username: string;
}

interface AdminSummary {
  username: string;
  groupCount: number;
  lastActivity: string;
}

export function MasterAdmin() {
  const { isMasterAdmin, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [groupsCount, setGroupsCount] = useState(0);
  const [adminsCount, setAdminsCount] = useState(0);
  const [adminSummaries, setAdminSummaries] = useState<AdminSummary[]>([]);
  const [sessionsByGroup, setSessionsByGroup] = useState<{ group_name: string; count: number }[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  // Which stat card's detail panel is open (only one at a time) — same
  // click-to-expand pattern used by the Groups and GroupDashboard cards.
  const [expandedPanel, setExpandedPanel] = useState<'groups' | 'sessions' | null>(null);
  // Sort order for the admin cards inside the 'groups' panel, and which
  // admin (if any) the group list below is currently scoped to.
  const [adminSort, setAdminSort] = useState<'alpha' | 'recent'>('alpha');
  const [selectedAdmin, setSelectedAdmin] = useState<string | null>(null);

  useEffect(() => {
    if (!isMasterAdmin) return;
    (async () => {
      setLoading(true);
      const [{ data: groups }, { data: admins }, { data: sess }] = await Promise.all([
        supabase.from('groups').select('id, name, created_by, creator:profiles!groups_created_by_fkey(username)'),
        supabase.from('group_members').select('user_id').eq('role', 'admin'),
        supabase
          .from('sessions')
          .select(
            'id, title, status, created_at, group_id, group:groups(name, created_by, creator:profiles!groups_created_by_fkey(username))'
          )
          .order('created_at', { ascending: false })
      ]);

      setGroupsCount(groups?.length ?? 0);
      setAdminsCount(new Set((admins ?? []).map((a: any) => a.user_id)).size);

      const adminGroupCounts = new Map<string, number>();
      for (const g of (groups as any[]) ?? []) {
        const uname = g.creator?.username ?? 'unknown';
        adminGroupCounts.set(uname, (adminGroupCounts.get(uname) ?? 0) + 1);
      }

      const rows: SessionRow[] = ((sess as any[]) ?? []).map((s) => ({
        id: s.id,
        title: s.title,
        status: s.status,
        created_at: s.created_at,
        group_id: s.group_id,
        group_name: s.group?.name ?? '—',
        admin_username: s.group?.creator?.username ?? '—'
      }));
      setSessions(rows);

      // "Recent" activity per admin — the latest session timestamp among
      // any of their groups. sess is already ordered newest-first, so the
      // first row seen per admin is their most recent one.
      const adminActivity = new Map<string, string>();
      for (const r of rows) {
        if (!adminActivity.has(r.admin_username)) {
          adminActivity.set(r.admin_username, r.created_at);
        }
      }
      setAdminSummaries(
        Array.from(adminGroupCounts.entries()).map(([username, groupCount]) => ({
          username,
          groupCount,
          lastActivity: adminActivity.get(username) ?? ''
        }))
      );

      const groupSessionMap = new Map<string, number>();
      for (const r of rows) {
        groupSessionMap.set(r.group_name, (groupSessionMap.get(r.group_name) ?? 0) + 1);
      }
      setSessionsByGroup(
        Array.from(groupSessionMap.entries())
          .map(([group_name, count]) => ({ group_name, count }))
          .sort((a, b) => b.count - a.count)
      );

      setLoading(false);
    })();
  }, [isMasterAdmin]);

  const openCount = sessions.filter((s) => s.status === 'open').length;
  const settledCount = sessions.filter((s) => s.status === 'settled').length;

  const sortedAdmins = useMemo(() => {
    const copy = [...adminSummaries];
    if (adminSort === 'alpha') {
      copy.sort((a, b) => a.username.localeCompare(b.username));
    } else {
      copy.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
    }
    return copy;
  }, [adminSummaries, adminSort]);

  const visible = useMemo(() => {
    return sessions.filter((s) => {
      if (selectedAdmin && s.admin_username !== selectedAdmin) return false;
      if (filter !== 'all' && s.status !== filter) return false;
      const q = search.trim().toLowerCase();
      if (q && !s.group_name.toLowerCase().includes(q) && !s.admin_username.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [sessions, filter, search, selectedAdmin]);

  if (authLoading) return null;
  if (!isMasterAdmin) return <Navigate to="/" replace />;

  return (
    <Layout back="/groups">
      <div className="mb-5">
        <h1 className="font-mono text-xl font-semibold flex items-center gap-2">
          Master admin <span className="status-pill bg-violet-light text-violet">oversight</span>
        </h1>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <button
          type="button"
          onClick={() => setExpandedPanel((v) => (v === 'groups' ? null : 'groups'))}
          className={`stat-card stat-card-accent-emerald text-left ${expandedPanel === 'groups' ? 'bg-ink/5' : ''}`}
        >
          <p className="stat-card-label">Total groups</p>
          <p className="stat-card-value">{groupsCount}</p>
          <p className="stat-card-sub">{adminsCount} admins</p>
        </button>
        <button
          type="button"
          onClick={() => setExpandedPanel((v) => (v === 'sessions' ? null : 'sessions'))}
          className={`stat-card stat-card-accent-violet text-left ${expandedPanel === 'sessions' ? 'bg-ink/5' : ''}`}
        >
          <p className="stat-card-label">Total sessions</p>
          <p className="stat-card-value">{sessions.length}</p>
        </button>
        <button
          type="button"
          onClick={() => setFilter((v) => (v === 'open' ? 'all' : 'open'))}
          className={`stat-card stat-card-accent-amber text-left ${filter === 'open' ? 'bg-ink/5' : ''}`}
        >
          <p className="stat-card-label">Open</p>
          <p className="stat-card-value">{openCount}</p>
        </button>
        <button
          type="button"
          onClick={() => setFilter((v) => (v === 'settled' ? 'all' : 'settled'))}
          className={`stat-card stat-card-accent-neutral text-left ${filter === 'settled' ? 'bg-ink/5' : ''}`}
        >
          <p className="stat-card-label">Settled</p>
          <p className="stat-card-value">{settledCount}</p>
        </button>
      </div>

      {expandedPanel === 'groups' ? (
        <div className="receipt-card p-4 mb-5">
          <div className="flex items-center justify-between mb-3">
            <p className="label-eyebrow">Admins</p>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setAdminSort('alpha')}
                className={`text-[11px] px-2 py-1 rounded transition-colors ${
                  adminSort === 'alpha' ? 'bg-emerald/10 text-emerald' : 'text-ink-faint hover:text-ink'
                }`}
              >
                A–Z
              </button>
              <button
                type="button"
                onClick={() => setAdminSort('recent')}
                className={`text-[11px] px-2 py-1 rounded transition-colors ${
                  adminSort === 'recent' ? 'bg-emerald/10 text-emerald' : 'text-ink-faint hover:text-ink'
                }`}
              >
                Recent
              </button>
            </div>
          </div>
          {sortedAdmins.length === 0 ? (
            <p className="text-sm text-ink-soft">No admins yet.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {sortedAdmins.map((a) => (
                <button
                  key={a.username}
                  type="button"
                  onClick={() => setSelectedAdmin((v) => (v === a.username ? null : a.username))}
                  className={`stat-card stat-card-accent-emerald text-left ${
                    selectedAdmin === a.username ? 'bg-ink/5 border-emerald' : ''
                  }`}
                >
                  <p className="stat-card-label truncate">@{a.username}</p>
                  <p className="stat-card-value text-lg">{a.groupCount}</p>
                  <p className="stat-card-sub">group{a.groupCount === 1 ? '' : 's'}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {expandedPanel === 'sessions' ? (
        <div className="receipt-card p-4 mb-5">
          <p className="label-eyebrow mb-3">Sessions by group</p>
          {sessionsByGroup.length === 0 ? (
            <p className="text-sm text-ink-soft">No sessions yet.</p>
          ) : (
            <ul className="space-y-2">
              {sessionsByGroup.map((g) => (
                <li key={g.group_name} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-ink-soft truncate">{g.group_name}</span>
                  <span className="font-mono text-sm shrink-0">
                    {g.count} session{g.count === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {selectedAdmin ? (
        <div className="flex items-center justify-between gap-2 mb-3 px-3 py-2 rounded-md bg-emerald/10 border border-emerald/30">
          <p className="text-xs text-emerald truncate">Showing @{selectedAdmin}'s groups</p>
          <button
            type="button"
            onClick={() => setSelectedAdmin(null)}
            className="text-[11px] text-ink-faint hover:text-ink transition-colors shrink-0"
          >
            Clear
          </button>
        </div>
      ) : null}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="input-field mb-3"
        placeholder="Search by group or admin…"
      />
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        <button className={`chip ${filter === 'all' ? 'chip-active' : ''}`} onClick={() => setFilter('all')}>
          All ({sessions.length})
        </button>
        <button className={`chip ${filter === 'open' ? 'chip-active' : ''}`} onClick={() => setFilter('open')}>
          Open ({openCount})
        </button>
        <button className={`chip ${filter === 'settled' ? 'chip-active' : ''}`} onClick={() => setFilter('settled')}>
          Settled ({settledCount})
        </button>
      </div>

      {loading ? (
        <p className="label-eyebrow">Loading…</p>
      ) : !selectedAdmin ? (
        <div className="receipt-card p-8 text-center">
          <p className="text-ink-soft text-sm">
            Pick an admin from the "Total groups" card above to see their groups.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="receipt-card p-8 text-center">
          <p className="text-ink-soft text-sm">No sessions match.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((s) => (
            <li key={s.id}>
              <Link to={`/groups/${s.group_id}`} className="list-row">
                <span className="avatar-circle">{s.group_name.charAt(0)}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{s.group_name}</p>
                  <p className="text-xs text-ink-faint mt-0.5">
                    admin @{s.admin_username} ·{' '}
                    {new Date(s.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <span className={`status-pill ${s.status === 'open' ? 'bg-emerald-light text-emerald-dark' : 'bg-ink/5 text-ink-faint'}`}>
                  {s.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Layout>
  );
}
