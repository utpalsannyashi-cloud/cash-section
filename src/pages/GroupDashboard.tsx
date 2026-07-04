import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type { Group, GroupMember, Session } from '@/types';

export function GroupDashboard() {
  const { groupId } = useParams();
  const { user } = useAuth();
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewSession, setShowNewSession] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('');
  const [selectedParticipants, setSelectedParticipants] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

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
      <div className="mb-6">
        <h1 className="font-mono text-xl font-semibold">{group.name}</h1>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-ink-soft text-sm">{members.length} members</span>
          <span className="text-ink-faint">·</span>
          <button onClick={copyInvite} className="font-mono text-xs text-emerald hover:underline">
            {copied ? 'Copied!' : `Invite code: ${group.invite_code}`}
          </button>
        </div>
      </div>

      <Link
        to={`/groups/${groupId}/insights`}
        className="receipt-card p-3 mb-6 flex items-center justify-between hover:border-emerald transition-colors"
      >
        <span className="text-sm font-medium">✦ Ask the AI about spending patterns</span>
        <span className="text-ink-faint text-xs">→</span>
      </Link>

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

      {sessions.length === 0 ? (
        <div className="receipt-card p-8 text-center">
          <p className="text-ink-soft text-sm">No sessions yet. Start one for your next outing.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link
                to={`/sessions/${s.id}`}
                className="receipt-card p-4 flex items-center justify-between hover:border-emerald transition-colors block"
              >
                <div>
                  <p className="font-medium">{s.title}</p>
                  <p className="text-xs text-ink-faint mt-0.5">
                    {new Date(s.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <span
                  className={`text-[11px] font-mono uppercase tracking-wide px-2 py-1 rounded ${
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
    </Layout>
  );
}
