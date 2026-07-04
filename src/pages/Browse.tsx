import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { supabase } from '@/lib/supabase';

interface BrowsableSession {
  id: string;
  title: string;
  status: 'open' | 'settled';
  currency: string;
  created_at: string;
  group_name: string;
}

export function Browse() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<BrowsableSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc('list_browsable_sessions');
      setSessions((data as BrowsableSession[]) ?? []);
      setLoading(false);
    })();
  }, []);

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
    <Layout>
      <div className="mb-6">
        <h1 className="font-mono text-xl font-semibold">Got a passkey?</h1>
        <p className="text-ink-soft text-sm mt-1">
          Ask whoever's organizing the trip for their session's passkey to jump straight in — no account needed.
        </p>
      </div>

      <form onSubmit={handleUnlock} className="receipt-card p-4 mb-8 space-y-3">
        <label className="label-eyebrow block">Session passkey</label>
        <input
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="input-field font-mono"
          placeholder="e.g. 3f9a2c"
        />
        {error ? <p className="text-brick text-sm">{error}</p> : null}
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? 'Unlocking…' : 'Unlock session'}
        </button>
      </form>

      <h2 className="label-eyebrow mb-3">All sessions</h2>

      {loading ? (
        <p className="label-eyebrow">Loading…</p>
      ) : sessions.length === 0 ? (
        <div className="receipt-card p-8 text-center">
          <p className="text-ink-soft text-sm">No sessions yet.</p>
        </div>
      ) : (
        <ul className="space-y-2 mb-8">
          {sessions.map((s) => (
            <li key={s.id} className="receipt-card p-4 flex items-center justify-between">
              <div>
                <p className="font-medium">{s.title}</p>
                <p className="text-xs text-ink-faint mt-0.5">
                  {s.group_name} ·{' '}
                  {new Date(s.created_at).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric'
                  })}
                </p>
              </div>
              <span
                className={`text-[11px] font-mono uppercase tracking-wide px-2 py-1 rounded ${
                  s.status === 'open' ? 'bg-emerald-light text-emerald-dark' : 'bg-ink/5 text-ink-faint'
                }`}
              >
                {s.status}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-center text-sm text-ink-soft">
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
    </Layout>
  );
}
