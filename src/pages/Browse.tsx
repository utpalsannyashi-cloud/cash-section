import { FormEvent, useState } from 'react';
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

export function Browse() {
  const navigate = useNavigate();
  const { user, profile, refreshProfile } = useAuth();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      if (rpcError || !data) {
        setError("That passkey doesn't match any group. Double-check with whoever shared it.");
        return;
      }
      navigate(`/groups/${data}`);
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="receipt-card p-7 text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-light border border-emerald/40 flex items-center justify-center mx-auto mb-4 text-2xl">
            🔒
          </div>
          <h1 className="font-mono text-xl font-semibold text-ink">
            Cash<span className="text-emerald">§</span>ection
          </h1>
          <p className="text-ink-soft text-sm mt-2 mb-6">
            Ask whoever's organizing the trip for their group's passkey to jump straight in — no account needed.
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
              {busy ? 'Unlocking…' : 'Unlock group'}
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
