import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type { Group } from '@/types';

export function Groups() {
  const { user } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
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
      .select('*, group_members!inner(user_id)')
      .eq('group_members.user_id', user?.id)
      .order('created_at', { ascending: false });
    setGroups((data as unknown as Group[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (user) loadGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-mono text-xl font-semibold">Your groups</h1>
          <p className="text-ink-soft text-sm mt-0.5">Where every outing starts.</p>
        </div>
      </div>

      <div className="flex gap-2 mb-6">
        <button className="btn-primary flex-1" onClick={() => setShowCreate((v) => !v)}>
          + New group
        </button>
        <button className="btn-secondary flex-1" onClick={() => setShowJoin((v) => !v)}>
          Join with code
        </button>
      </div>

      {showCreate ? (
        <form onSubmit={handleCreate} className="receipt-card p-4 mb-6 space-y-3">
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
        <form onSubmit={handleJoin} className="receipt-card p-4 mb-6 space-y-3">
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

      {loading ? (
        <p className="label-eyebrow">Loading…</p>
      ) : groups.length === 0 ? (
        <div className="receipt-card p-8 text-center">
          <p className="text-ink-soft text-sm">
            No groups yet. Create one for your next outing, or join with a code someone shared.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {groups.map((g) => (
            <li key={g.id}>
              <Link
                to={`/groups/${g.id}`}
                className="receipt-card p-4 flex items-center justify-between hover:border-emerald transition-colors block"
              >
                <span className="font-medium">{g.name}</span>
                <span className="font-mono text-xs text-ink-faint">#{g.invite_code}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Layout>
  );
}
