import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';

// The DB assigns every fresh anonymous user this exact shape as a
// placeholder username (see 0001_schema.sql) — matching it is how we tell
// "hasn't picked a name yet" apart from "already named themselves".
const DEFAULT_USERNAME_PATTERN = /^user_[0-9a-f]{8}$/i;

function slugifyName(raw: string): string {
  const base = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 18);
  return base.length >= 3 ? base : (base || 'guest').padEnd(3, '0');
}

// unlock_group_by_code no longer returns a bare group id — a correct
// passkey now only puts you in the waiting room (see migration 0016).
type UnlockResult = {
  status: 'member' | 'pending' | 'denied' | 'none';
  group_id: string;
  group_name: string;
  request_id?: string;
};

export function Browse() {
  const navigate = useNavigate();
  const { user, profile, refreshProfile } = useAuth();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once the passkey is accepted but the admin hasn't decided yet.
  // Kept in component state only: on a hard refresh the guest lands back
  // on the passkey form, and re-entering the same passkey returns their
  // existing request rather than creating a second one.
  const [waiting, setWaiting] = useState<UnlockResult | null>(null);

  const needsName = Boolean(profile && DEFAULT_USERNAME_PATTERN.test(profile.username));

  // Usernames are unique app-wide, but a guest typing their first name
  // shouldn't ever see a "taken" error — silently fall back to a short
  // suffixed variant instead of blocking them.
  const claimName = async (rawName: string) => {
    if (!user) return;
    const base = slugifyName(rawName);
    let candidate = base;
    for (let attempt = 0; attempt < 4; attempt++) {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ username: candidate })
        .eq('id', user.id);
      if (!updateError) return;
      const isUniqueViolation = updateError.code === '23505' || /duplicate|unique/i.test(updateError.message);
      if (!isUniqueViolation) throw updateError;
      candidate = `${base}_${Math.random().toString(36).slice(2, 6)}`;
    }
  };

  const handleUnlock = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    if (needsName && !name.trim()) return;
    setBusy(true);
    setError(null);

    try {
      if (needsName && name.trim()) {
        await claimName(name.trim());
        await refreshProfile();
      }

      const { data, error: rpcError } = await supabase.rpc('unlock_group_by_code', {
        code: code.trim()
      });

      if (rpcError) {
        // The RPC raises for two distinct reasons and the difference
        // matters to the person reading it: a wrong passkey is worth
        // retrying immediately, a lockout is not.
        if (/Too many incorrect passkeys/i.test(rpcError.message)) {
          setError(rpcError.message);
        } else {
          setError("That passkey doesn't match any group. Double-check with whoever shared it.");
        }
        return;
      }

      const result = data as UnlockResult;

      if (result.status === 'member') {
        navigate(`/groups/${result.group_id}`);
        return;
      }

      setWaiting(result);
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  // While waiting: listen for the admin's decision, with a slow poll as
  // a backstop in case the Realtime socket drops on a flaky connection.
  useEffect(() => {
    if (!waiting || !user || waiting.status !== 'pending') return;

    const check = async () => {
      const { data } = await supabase.rpc('get_join_request_status', { p_group_id: waiting.group_id });
      const next = data as UnlockResult | null;
      if (!next) return;
      if (next.status === 'member') {
        navigate(`/groups/${waiting.group_id}`);
      } else if (next.status === 'denied') {
        setWaiting({ ...waiting, status: 'denied' });
      }
    };

    const channel = supabase
      .channel(`my-join-request-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'join_requests', filter: `user_id=eq.${user.id}` },
        () => check()
      )
      .subscribe();

    const poll = window.setInterval(check, 10000);

    return () => {
      supabase.removeChannel(channel);
      window.clearInterval(poll);
    };
  }, [waiting, user, navigate]);

  const startOver = () => {
    setWaiting(null);
    setCode('');
    setError(null);
  };

  if (waiting && waiting.status === 'pending') {
    return (
      <div className="min-h-dvh flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="receipt-card p-7 text-center">
            <div
              className="w-14 h-14 rounded-full bg-emerald-light border border-emerald/40 flex items-center justify-center mx-auto mb-4 text-2xl"
              aria-hidden
            >
              ⏳
            </div>
            <h1 className="font-mono text-xl font-semibold text-ink">Waiting for approval</h1>
            <p className="text-ink-soft text-sm mt-2">
              The passkey was right. <span className="text-ink font-medium">{waiting.group_name}</span>'s admin
              has been asked to let you in — this page will move on by itself once they do.
            </p>
            <p className="text-[11px] text-ink-faint mt-4">
              Standing next to them? Nudge them to open the group and tap Approve.
            </p>
            <button onClick={startOver} className="btn-secondary w-full mt-5">
              Use a different passkey
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (waiting && waiting.status === 'denied') {
    return (
      <div className="min-h-dvh flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="receipt-card p-7 text-center">
            <div
              className="w-14 h-14 rounded-full bg-brick-light border border-brick/40 flex items-center justify-center mx-auto mb-4 text-2xl"
              aria-hidden
            >
              🚫
            </div>
            <h1 className="font-mono text-xl font-semibold text-ink">Not approved</h1>
            <p className="text-ink-soft text-sm mt-2">
              <span className="text-ink font-medium">{waiting.group_name}</span>'s admin didn't approve this
              request. Entering the passkey again won't ask a second time — you'll need them to let you in.
            </p>
            <button onClick={startOver} className="btn-secondary w-full mt-5">
              Use a different passkey
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="receipt-card p-7 text-center">
          <div
            className="w-14 h-14 rounded-full bg-emerald-light border border-emerald/40 flex items-center justify-center mx-auto mb-4 text-2xl"
            aria-hidden
          >
            🔒
          </div>
          <h1 className="font-mono text-xl font-semibold text-ink">
            Cash<span className="text-emerald">§</span>ection
          </h1>
          <p className="text-ink-soft text-sm mt-2 mb-6">
            Ask whoever's organizing the trip for their group's passkey. They'll get a prompt to approve you —
            no account needed.
          </p>
          <form onSubmit={handleUnlock} className="space-y-3 text-left">
            {needsName ? (
              <div>
                <label className="label-eyebrow block mb-1.5">What's your name?</label>
                <input
                  required
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input-field"
                  placeholder="e.g. Priya"
                  maxLength={24}
                />
                <p className="text-xs text-ink-faint mt-1">
                  This is what the admin sees when deciding whether to let you in.
                </p>
              </div>
            ) : null}
            <div>
              <label className="label-eyebrow block mb-1.5">Group passkey</label>
              <input
                required
                autoFocus={!needsName}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="input-field font-mono text-center tracking-widest"
                placeholder="e.g. goa2026"
              />
            </div>
            {error ? <p className="text-brick text-sm">{error}</p> : null}
            <button type="submit" disabled={busy} className="btn-primary w-full">
              {busy ? 'Checking…' : 'Ask to join'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-ink-soft mt-5">
          Organizing trips yourself?{' '}
          <Link to="/login" className="text-emerald font-medium">
            Sign in as admin
          </Link>{' '}
          or{' '}
          <Link to="/signup" className="text-emerald font-medium">
            create an account
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
