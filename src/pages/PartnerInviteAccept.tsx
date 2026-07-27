import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';

type OwnerInfo = { owner_id: string; owner_username: string };
type AcceptResult = { status: 'accepted' | 'already_partners'; owner_username: string };

export function PartnerInviteAccept() {
  const { token } = useParams<{ token: string }>();
  const { user, isGuest, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [owner, setOwner] = useState<OwnerInfo | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState(true);

  const [accepting, setAccepting] = useState(false);
  const [result, setResult] = useState<AcceptResult | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!token) return;
      setLookupLoading(true);
      setLookupError(null);
      const { data, error } = await supabase.rpc('get_partner_invite_owner', { p_token: token });
      if (cancelled) return;
      if (error) {
        setLookupError(error.message ?? 'This invite link is no longer valid.');
      } else {
        setOwner(data as OwnerInfo);
      }
      setLookupLoading(false);
    };
    run();
    return () => { cancelled = true; };
  }, [token]);

  const handleAccept = async () => {
    if (!token) return;
    setAccepting(true);
    setAcceptError(null);
    try {
      const { data, error } = await supabase.rpc('accept_partner_invite_link', { p_token: token });
      if (error) throw error;
      setResult(data as AcceptResult);
    } catch (err: any) {
      setAcceptError(err.message ?? 'Could not accept this invite.');
    } finally {
      setAccepting(false);
    }
  };

  const needsRealAccount = !authLoading && (!user || isGuest);
  const nextPath = '/partner-invite/' + (token ?? '');

  return (
    <div className="min-h-dvh flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="font-mono text-2xl font-semibold text-ink">
            Cash<span className="text-emerald">§</span>ection
          </h1>
          <p className="label-eyebrow mt-2">Admin partner invite</p>
        </div>

        <div className="receipt-card p-6 space-y-4">
          {lookupLoading || authLoading ? (
            <p className="text-sm text-ink-soft text-center">Loading invite…</p>
          ) : lookupError ? (
            <p className="text-brick text-sm text-center">{lookupError}</p>
          ) : result ? (
            <div className="text-center space-y-3">
              <p className="text-sm text-ink">
                {result.status === 'already_partners'
                  ? 'You are already partners with @' + result.owner_username + '.'
                  : 'You are now an admin partner with @' + result.owner_username + '.'}
              </p>
              <button type="button" onClick={() => navigate('/groups')} className="btn-primary w-full">
                Go to your groups
              </button>
            </div>
          ) : needsRealAccount ? (
            <div className="space-y-3">
              <p className="text-sm text-ink text-center">
                <span className="font-medium">@{owner?.owner_username}</span> invited you to become an admin partner.
              </p>
              <p className="text-sm text-ink-soft text-center">Create an account or sign in to accept.</p>
              <Link to={'/signup?next=' + encodeURIComponent(nextPath)} className="btn-primary w-full block text-center">
                Create an account
              </Link>
              <Link
                to={'/login?next=' + encodeURIComponent(nextPath)}
                className="block text-center text-sm text-emerald font-medium"
              >
                I already have an account — sign in
              </Link>
            </div>
          ) : (
            <div className="space-y-3 text-center">
              <p className="text-sm text-ink">
                <span className="font-medium">@{owner?.owner_username}</span> invited you to become an admin partner.
              </p>
              {acceptError ? <p className="text-brick text-sm">{acceptError}</p> : null}
              <button type="button" onClick={handleAccept} disabled={accepting} className="btn-primary w-full">
                {accepting ? 'Accepting…' : 'Accept invite'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
