import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  /** True when the current session is an anonymous guest (no email/password set). */
  isGuest: boolean;
  /** True for the single designated Master Admin account, who can see every
   *  group/session across every admin, not just their own. */
  isMasterAdmin: boolean;
  signUp: (email: string, password: string, username: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// After a full day with no activity anywhere in the app, the current
// session — real account or anonymous guest alike — is dropped and a fresh
// anonymous session takes its place. Protects a shared/borrowed device from
// staying signed in indefinitely; the tradeoff is that a guest who's been
// away for over a day needs to re-enter their group's passkey.
const LAST_ACTIVITY_KEY = 'cash-section:last-activity-at';
const INACTIVITY_LIMIT_MS = 24 * 60 * 60 * 1000;

function isAnonymousUser(user: User | null | undefined): boolean {
  return Boolean((user as any)?.is_anonymous);
}

function touchActivity() {
  localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
}

function idleDurationMs(): number {
  const raw = localStorage.getItem(LAST_ACTIVITY_KEY);
  return raw ? Date.now() - parseInt(raw, 10) : 0;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (userId: string) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
    setProfile(data ?? null);
  };

  useEffect(() => {
    let cancelled = false;

    // On first load, either resume a real/guest session, or silently start a
    // new anonymous one — so guests can browse sessions and unlock one with
    // a passkey without ever hitting a login wall. Admins/members who sign
    // in for real simply replace this anonymous session afterwards. Any
    // session that's been idle for over a day gets signed out right here,
    // before it's ever handed to the rest of the app.
    const bootstrap = async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;

      const staleSession = data.session && idleDurationMs() > INACTIVITY_LIMIT_MS;

      if (staleSession) {
        await supabase.auth.signOut();
        const { data: anon } = await supabase.auth.signInAnonymously();
        if (!cancelled && anon.session) {
          setSession(anon.session);
          if (anon.session.user) await loadProfile(anon.session.user.id);
        }
      } else if (data.session) {
        setSession(data.session);
        if (data.session.user) await loadProfile(data.session.user.id);
      } else {
        const { data: anon, error } = await supabase.auth.signInAnonymously();
        if (!error && anon.session && !cancelled) {
          setSession(anon.session);
          if (anon.session.user) await loadProfile(anon.session.user.id);
        }
      }

      touchActivity();
      if (!cancelled) setLoading(false);
    };

    bootstrap();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        loadProfile(newSession.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  const isGuest = isAnonymousUser(session?.user);
  const isMasterAdmin = Boolean(profile?.is_master_admin);

  const signUp = async (email: string, password: string, username: string) => {
    // If they're currently an anonymous guest (e.g. they already unlocked a
    // session with a passkey), upgrade that same account in place so their
    // existing session access carries over, instead of creating a new user.
    if (isGuest && session?.user) {
      const { error } = await supabase.auth.updateUser({ email, password, data: { username } });
      if (error) throw error;
      await supabase.from('profiles').update({ username }).eq('id', session.user.id);
      return;
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username } }
    });
    if (error) throw error;
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    touchActivity();
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    // Drop straight back into a fresh anonymous/guest session rather than
    // leaving the app in a signed-out dead end.
    await supabase.auth.signInAnonymously();
    touchActivity();
  };

  const refreshProfile = async () => {
    if (session?.user) await loadProfile(session.user.id);
  };

  // While the tab is actually in use, keep nudging the activity clock
  // forward on any interaction. A periodic check (plus one on tab refocus)
  // catches a long-lived tab that's crossed the inactivity threshold
  // without ever being reloaded.
  useEffect(() => {
    const events = ['click', 'keydown', 'scroll', 'touchstart'];
    events.forEach((evt) => document.addEventListener(evt, touchActivity, { passive: true }));

    const checkIdle = () => {
      if (session && idleDurationMs() > INACTIVITY_LIMIT_MS) {
        signOut();
      }
    };
    document.addEventListener('visibilitychange', checkIdle);
    const interval = setInterval(checkIdle, 60 * 1000);

    return () => {
      events.forEach((evt) => document.removeEventListener(evt, touchActivity));
      document.removeEventListener('visibilitychange', checkIdle);
      clearInterval(interval);
    };
  }, [session]);

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        loading,
        isGuest,
        isMasterAdmin,
        signUp,
        signIn,
        signOut,
        refreshProfile
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
