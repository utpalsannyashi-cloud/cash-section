import { Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import type { ReactNode } from 'react';

/**
 * requireFull: when set, guests (anonymous passkey sessions) are bounced to
 * /login instead of being let through. Used for routes that need a real
 * account (groups, group dashboard, admin insights). Session-scoped routes
 * like /sessions/:id stay open to any authenticated session, guest or not.
 */
export function ProtectedRoute({ children, requireFull }: { children: ReactNode; requireFull?: boolean }) {
  const { session, loading, isGuest } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="label-eyebrow">Loading…</p>
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;
  if (requireFull && isGuest) return <Navigate to="/login" replace />;

  return <>{children}</>;
}
