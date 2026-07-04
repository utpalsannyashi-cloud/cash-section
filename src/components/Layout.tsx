import { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

export function Layout({ children, back }: { children: ReactNode; back?: string }) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col">
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
            <Link to="/groups" className="font-mono font-semibold tracking-tight text-ink">
              Cash<span className="text-emerald">§</span>ection
            </Link>
          </div>
          {profile ? (
            <div className="flex items-center gap-3">
              <span className="label-eyebrow hidden sm:inline">@{profile.username}</span>
              <button onClick={() => signOut()} className="text-xs text-ink-faint hover:text-brick transition-colors">
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </header>
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
