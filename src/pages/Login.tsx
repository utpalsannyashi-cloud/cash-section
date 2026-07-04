import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

export function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
      navigate('/groups');
    } catch (err: any) {
      setError(err.message ?? 'Could not sign in. Check your details and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="font-mono text-2xl font-semibold text-ink">
            Cash<span className="text-emerald">§</span>ection
          </h1>
          <p className="label-eyebrow mt-2">Split it. Settle it. Move on.</p>
        </div>
        <form onSubmit={handleSubmit} className="receipt-card p-6 space-y-4">
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
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
              placeholder="••••••••"
            />
          </div>
          {error ? <p className="text-brick text-sm">{error}</p> : null}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="text-center text-sm text-ink-soft mt-4">
          New here?{' '}
          <Link to="/signup" className="text-emerald font-medium">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
