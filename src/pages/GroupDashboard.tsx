import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency } from '@/utils/currency';
import type { Group, GroupMember, Session } from '@/types';

type StatusFilter = 'all' | 'open' | 'settled';

export function GroupDashboard() {
  const { groupId } = useParams();
  const { user } = useAuth();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [totalSpend, setTotalSpend] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showNewSession, setShowNewSession] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('');
  const [selectedParticipants, setSelectedParticipants] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

  const isAdmin = members.find((m) => m.user_id === user?.id)?.role === 'admin';

  const load = async () => {
    if (!groupId) return;
    setLoading(true);
    const [{ data: g }, { data: m }, { data: s }] = await Promise.all([
      supabase.from('groups').select('*').eq('id', groupId).single(),
      supabase.from('group_members').select('*, profile:profiles(*)').eq('group_id', groupId),
      supabase.from('sessions').select('*').eq('group_id', groupId).order('created_at', { ascending: false })
    ]);
    setGroup(g);
    setMembers((m as unknown as GroupMember[]) ?? []);
    setSessions(s ?? []);
    setSelectedParticipants(new Set((m ?? []).map((x: any) => x.user_id)));

    const sessionIds = (s ?? []).map((x) => x.id);
    if (sessionIds.length > 0) {
      const { data: exp } = await supabase.from('expenses').select('amount').in('session_id', sessionIds);
      setTotalSpend((exp ?? []).reduce((sum, e) => sum + Number(e.amount), 0));
    } else {
      setTotalSpend(0);
    }

    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const toggleParticipant = (userId: string) => {
    setSelectedParticipants((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleCreateSession = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !groupId || selectedParticipants.size === 0) return;
    setBusy(true);
    const { data: session, error } = await supabase
      .from('sessions')
      .insert({ group_id: groupId, title: sessionTitle, created_by: user.id })
      .select()
      .single();

    if (error || !session) {
      setBusy(false);
      return;
    }

    await supabase.from('session_participants').insert(
      Array.from(selectedParticipants).map((userId) => ({ session_id: session.id, user_id: userId }))
    );

    setBusy(false);
    setSessionTitle('');
    setShowNewSession(false);
    load();
  };

  const copyInvite = async () => {
    if (!group) return;
    await navigator.clipboard.writeText(group.invite_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const openCount = sessions.filter((s) => s.status === 'open').length;
  const settledCount = sessions.filter((s) => s.status === 'settled').length;

  const visibleSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (filter !== 'all' && s.status !== filter) return false;
      if (search.trim() && !s.title.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
  }, [sessions, filter, search]);

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
            {copied ? 'Copied!' : `Invite code: ${group.invite_code}`}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="stat-card stat-card-active">
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
        <div className="stat-card">
          <p className="stat-card-label">Total spend</p>
          <p className="stat-card-value text-lg">{formatCurrency(totalSpend, sessions[0]?.currency ?? 'INR')}</p>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="label-eyebrow">Sessions</h2>
        <button className="text-sm text-emerald font-medium" onClick={() => setShowNewSession((v) => !v)}>
          + New session
        </button>
      </div>

      {showNewSession ? (
        <form onSubmit={handleCreateSession} className="receipt-card p-4 mb-4 space-y-3">
          <div>
            <label className="label-eyebrow block mb-1.5">Title</label>
            <input
              required
              autoFocus
              value={sessionTitle}
              onChange={(e) => setSessionTitle(e.target.value)}
              className="input-field"
              placeholder="Friday Dinner"
            />
          </div>
          <div>
            <label className="label-eyebrow block mb-1.5">Who's in?</label>
            <div className="flex flex-wrap gap-2">
              {members.map((m) => (
                <button
                  type="button"
                  key={m.user_id}
                  onClick={() => toggleParticipant(m.user_id)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    selectedParticipants.has(m.user_id)
                      ? 'bg-emerald text-paper border-emerald'
                      : 'border-ink/20 text-ink-soft'
                  }`}
                >
                  @{m.profile?.username}
                </button>
              ))}
            </div>
          </div>
          <button type="submit" disabled={busy || selectedParticipants.size === 0} className="btn-primary w-full">
            {busy ? 'Creating…' : 'Start session'}
          </button>
        </form>
      ) : null}

      {sessions.length > 0 ? (
        <>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field mb-3"
            placeholder="Search sessions…"
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
        </>
      ) : null}

      {sessions.length === 0 ? (
        <div className="receipt-card p-8 text-center">
          <p className="text-ink-soft text-sm">No sessions yet. Start one for your next outing.</p>
        </div>
      ) : visibleSessions.length === 0 ? (
        <div className="receipt-card p-8 text-center">
          <p className="text-ink-soft text-sm">No sessions match that filter.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visibleSessions.map((s) => (
            <li key={s.id}>
              <Link to={`/sessions/${s.id}`} className="list-row">
                <span className="avatar-circle">{s.title.charAt(0)}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{s.title}</p>
                  <p className="text-xs text-ink-faint mt-0.5">
                    {new Date(s.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <span
                  className={`status-pill ${
                    s.status === 'open' ? 'bg-emerald-light text-emerald-dark' : 'bg-ink/5 text-ink-faint'
                  }`}
                >
                  {s.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

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
