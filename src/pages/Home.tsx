import { Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Browse } from '@/pages/Browse';

// Smart landing route: guests (no real account) land on the browsable
// session list + passkey unlock; anyone with a real account goes straight
// to their groups.
export function Home() {
  const { loading, isGuest } = useAuth();

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <p className="label-eyebrow">Loading…</p>
      </div>
    );
  }

  if (isGuest) return <Browse />;

  return <Navigate to="/groups" replace />;
}
