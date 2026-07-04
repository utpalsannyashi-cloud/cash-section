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

export function MasterAdmin() {
  const { isMasterAdmin, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [groupsCount, setGroupsCount] = useState(0);
  const [adminsCount, setAdminsCount] = useState(0);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

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
      setLoading(false);
    })();
  }, [isMasterAdmin]);

  const openCount = sessions.filter((s) => s.status === 'open').length;
  const settledCount = sessions.filter((s) => s.status === 'settled').length;

  const visible = useMemo(() => {
    return sessions.filter((s) => {
      if (filter !== 'all' && s.status !== filter) return false;
      const q = search.trim().toLowerCase();
      if (q && !s.title.toLowerCase().includes(q) && !s.group_name.toLowerCase().includes(q) && !s.admin_username.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [sessions, filter, search]);

  if (authLoading) return null;
  if (!isMasterAdmin) return <Navigate to="/" replace />;

  return (
    <Layout back="/groups">
      <div className="mb-5">
        <h1 className="font-mono text-xl font-semibold flex items-center gap-2">
          Master admin <span className="status-pill bg-violet-light text-violet">oversight</span>
        </h1>
        <p className="text-ink-soft text-sm mt-0.5">Every group and session, across every admin — read-only.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="stat-card stat-card-active">
          <p className="stat-card-label">Total groups</p>
          <p className="stat-card-value">{groupsCount}</p>
          <p className="stat-card-sub">{adminsCount} admins</p>
        </div>
        <div className="stat-card">
          <p className="stat-card-label">Total sessions</p>
          <p className="stat-card-value">{sessions.length}</p>
        </div>
        <div className="stat-card">
          <p className="stat-card-label">Open</p>
          <p className="stat-card-value">{openCount}</p>
        </div>
        <div className="stat-card">
          <p className="stat-card-label">Settled</p>
          <p className="stat-card-value">{settledCount}</p>
        </div>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="input-field mb-3"
        placeholder="Search by session, group, or admin…"
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
      ) : visible.length === 0 ? (
        <div className="receipt-card p-8 text-center">
          <p className="text-ink-soft text-sm">No sessions match.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((s) => (
            <li key={s.id}>
              <Link to={`/sessions/${s.id}`} className="list-row">
                <span className="avatar-circle">{s.title.charAt(0)}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{s.title}</p>
                  <p className="text-xs text-ink-faint mt-0.5">
                    {s.group_name} · admin @{s.admin_username} ·{' '}
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
