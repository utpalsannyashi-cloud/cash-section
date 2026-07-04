import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

export function Browse() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUnlock = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('unlock_session_by_code', {
      code: code.trim()
    });
    setBusy(false);
    if (rpcError || !data) {
      setError("That passkey doesn't match any session. Double-check with whoever shared it.");
      return;
    }
    navigate(`/sessions/${data}`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="receipt-card p-7 text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-light border border-emerald/40 flex items-center justify-center mx-auto mb-4 text-2xl">
            🔒
          </div>
          <h1 className="font-mono text-xl font-semibold text-ink">
            Cash<span className="text-emerald">§</span>ection
          </h1>
          <p className="text-ink-soft text-sm mt-2 mb-6">
            Ask whoever's organizing the trip for their session's passkey to jump straight in — no account needed.
          </p>
          <form onSubmit={handleUnlock} className="space-y-3 text-left">
            <label className="label-eyebrow block">Session passkey</label>
            <input
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="input-field font-mono text-center tracking-widest"
              placeholder="e.g. goa2026"
            />
            {error ? <p className="text-brick text-sm">{error}</p> : null}
            <button type="submit" disabled={busy} className="btn-primary w-full">
              {busy ? 'Unlocking…' : 'Unlock session'}
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
