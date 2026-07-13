import { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

export function Layout({ children, back }: { children: ReactNode; back?: string }) {
  const { profile, signOut, isGuest, isMasterAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isMasterActive = location.pathname.startsWith('/master');

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-10 bg-paper/90 backdrop-blur border-b border-rule">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {back ? (
              <button
                onClick={() => navigate(back)}
                aria-label="Back"
                className="text-ink-soft hover:text-ink transition-colors"
              >
                ←
              </button>
            ) : null}
            <Link to="/" className="font-mono font-semibold tracking-tight text-ink">
              Cash<span className="text-emerald">§</span>ection
            </Link>
          </div>
          {profile && !isGuest ? (
            <div className="flex items-center gap-2 sm:gap-3">
              {isMasterAdmin ? (
                <Link
                  to="/master"
                  className={`text-[11px] font-mono uppercase tracking-wide px-2.5 py-1.5 rounded-md border transition-colors whitespace-nowrap ${
                    isMasterActive
                      ? 'bg-brick/20 text-brick border-brick shadow-glowBrick'
                      : 'bg-violet/10 text-violet border-violet/40 hover:bg-violet/20'
                  }`}
                >
                  Master admin
                </Link>
              ) : null}
              <span className="label-eyebrow hidden sm:inline-flex items-center px-2.5 py-1.5 rounded-md bg-ink/5 border border-rule whitespace-nowrap">
                @{profile.username}
              </span>
              <button
                onClick={async () => {
                  // signOut() immediately drops the user into a fresh
                  // anonymous/guest session. The intended landing spot after
                  // sign-out is the guest "what's your name? / group passkey"
                  // screen (Home -> Browse), not the admin login form — but
                  // if sign-out happened on a requireFull route (e.g. /groups)
                  // ProtectedRoute would otherwise bounce the fresh guest
                  // session straight to /login before Home ever got a look.
                  // Navigating to / explicitly routes through Home's
                  // isGuest check every time, landing on Browse as expected.
                  await signOut();
                  navigate('/');
                }}
                className="text-xs px-2.5 py-1.5 rounded-md border border-rule text-ink-faint hover:text-brick hover:border-brick/40 transition-colors whitespace-nowrap"
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link to="/login" className="text-xs text-ink-faint hover:text-emerald transition-colors">
              Admin sign in
            </Link>
          )}
        </div>
      </header>
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
