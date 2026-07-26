import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Admin-only queue of people who've entered the group passkey and are
 * waiting to be let in (see migration 0016).
 *
 * Renders nothing at all when there's nothing to decide, so it can be
 * mounted unconditionally on the group dashboard without adding an
 * empty box to the layout.
 *
 * Reads go through the list_join_requests RPC rather than a direct
 * select, because a requester isn't a member of anything yet and
 * profiles RLS would hide their username. Realtime is used only as a
 * "something changed, refetch" signal.
 */

type JoinRequest = {
  id: string;
  user_id: string;
  username: string;
  status: 'pending' | 'denied';
  requested_at: string;
  decided_at: string | null;
};

export function JoinRequestsPanel({ groupId, onApproved }: { groupId: string; onApproved?: () => void }) {
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDenied, setShowDenied] = useState(false);

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('list_join_requests', { p_group_id: groupId });
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setError(null);
    setRequests((data as JoinRequest[]) ?? []);
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  // Someone entering the passkey right now should show up without the
  // admin refreshing — they're likely standing next to each other.
  useEffect(() => {
    const channel = supabase
      .channel(`join-requests-${groupId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'join_requests', filter: `group_id=eq.${groupId}` },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId, load]);

  const decide = async (requestId: string, approve: boolean) => {
    setBusyId(requestId);
    setError(null);
    const { error: rpcError } = await supabase.rpc('decide_join_request', {
      p_request_id: requestId,
      p_approve: approve
    });
    setBusyId(null);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    await load();
    // The member list and every per-member total upstream is now stale.
    if (approve) onApproved?.();
  };

  const pending = requests.filter((r) => r.status === 'pending');
  const denied = requests.filter((r) => r.status === 'denied');

  if (pending.length === 0 && denied.length === 0) return null;

  return (
    <div className="receipt-card p-4 mb-5">
      <div className="flex items-center justify-between mb-3">
        <p className="label-eyebrow">
          {pending.length > 0
            ? `Waiting to join (${pending.length})`
            : 'Previously denied'}
        </p>
        {denied.length > 0 && pending.length > 0 ? (
          <button
            onClick={() => setShowDenied((v) => !v)}
            className="text-[11px] text-ink-faint hover:text-ink transition-colors"
          >
            {showDenied ? 'Hide denied' : `Denied (${denied.length})`}
          </button>
        ) : null}
      </div>

      {pending.length > 0 ? (
        <p className="text-[11px] text-ink-faint mb-3 -mt-1">
          They have the passkey but can't see any expenses until you approve them.
        </p>
      ) : null}

      {error ? <p className="text-brick text-xs mb-3">{error}</p> : null}

      <ul className="space-y-2">
        {pending.map((r) => (
          <li key={r.id} className="flex items-center gap-2.5">
            <span className="avatar-circle text-xs" aria-hidden>
              {r.username.charAt(0).toUpperCase()}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-ink truncate">@{r.username}</p>
              <p className="text-[11px] text-ink-faint">
                {new Date(r.requested_at).toLocaleString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  hour: 'numeric',
                  minute: '2-digit'
                })}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => decide(r.id, false)}
                disabled={busyId === r.id}
                className="btn-secondary text-xs px-2.5 py-1.5"
              >
                Deny
              </button>
              <button
                onClick={() => decide(r.id, true)}
                disabled={busyId === r.id}
                className="btn-primary text-xs px-2.5 py-1.5"
              >
                {busyId === r.id ? '…' : 'Approve'}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {(showDenied || pending.length === 0) && denied.length > 0 ? (
        <ul className={`space-y-2 ${pending.length > 0 ? 'mt-3 pt-3 border-t border-dashed border-rule' : ''}`}>
          {denied.map((r) => (
            <li key={r.id} className="flex items-center gap-2.5">
              <span className="avatar-circle text-xs opacity-50" aria-hidden>
                {r.username.charAt(0).toUpperCase()}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-ink-faint truncate line-through">@{r.username}</p>
                <p className="text-[11px] text-ink-faint">Denied — they can't ask again on their own</p>
              </div>
              <button
                onClick={() => decide(r.id, true)}
                disabled={busyId === r.id}
                className="btn-secondary text-xs px-2.5 py-1.5 shrink-0"
              >
                {busyId === r.id ? '…' : 'Let them in'}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
