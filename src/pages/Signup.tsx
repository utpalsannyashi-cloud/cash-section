import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';

export function Signup() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = searchParams.get('next');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
      setError('Username must be 3-24 characters: letters, numbers, underscores only.');
      return;
    }

    setLoading(true);
    try {
      const { data: available, error: rpcError } = await supabase.rpc('is_username_available', {
        check_username: username
      });
      if (rpcError) throw rpcError;
      if (!available) {
        setError('That username is taken. Try another.');
        setLoading(false);
        return;
      }

      await signUp(email, password, username);
      navigate(next || '/groups');
    } catch (err: any) {
      // The DB also enforces uniqueness as a backstop against race conditions,
      // so surface that error nicely too if it slips through.
      const message: string = err.message ?? '';
      if (message.toLowerCase().includes('username')) {
        setError('That username is taken. Try another.');
      } else {
        setError(message || 'Could not create your account.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="font-mono text-2xl font-semibold text-ink">
            Cash<span className="text-emerald">§</span>ection
          </h1>
          <p className="label-eyebrow mt-2">Create your account</p>
        </div>
        <form onSubmit={handleSubmit} className="receipt-card p-6 space-y-4">
          <div>
            <label className="label-eyebrow block mb-1.5">Username</label>
            <input
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input-field"
              placeholder="rahul_k"
            />
          </div>
          <div>
            <label className="label-eyebrow block mb-1.5">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="label-eyebrow block mb-1.5">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
              placeholder="At least 6 characters"
            />
          </div>
          {error ? <p className="text-brick text-sm">{error}</p> : null}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        <p className="text-center text-sm text-ink-soft mt-4">
          Already have an account?{' '}
          <Link to={next ? '/login?next=' + encodeURIComponent(next) : '/login'} className="text-emerald font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
