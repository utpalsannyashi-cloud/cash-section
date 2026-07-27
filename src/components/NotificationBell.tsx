import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { Icon } from '@/components/Icon';
import type { AppNotification } from '@/types';

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours + 'h ago';
  const days = Math.round(hours / 24);
  return days + 'd ago';
}

/**
 * Bell icon in the header for real (non-guest) accounts. Covers three
 * kinds of activity server-populated into the notifications table
 * (see migration 0022): admin-partner invites/decisions, join requests
 * to groups you admin (plus their outcome), and new expenses logged in
 * groups you belong to. Realtime-subscribed so the badge updates live,
 * same pattern as JoinRequestsPanel and AdminPartnersPanel.
 */
export function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30);
    setItems((data as AppNotification[]) ?? []);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime: new notifications land live, and mark-read from another
  // tab/device stays in sync -- same pattern as JoinRequestsPanel.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('notifications-' + user.id)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + user.id },
        (payload) => {
          setItems((prev) => [payload.new as AppNotification, ...prev].slice(0, 30));
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + user.id },
        (payload) => {
          const updated = payload.new as AppNotification;
          setItems((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Close the dropdown on an outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const unreadCount = items.filter((n) => !n.read).length;

  const markRead = async (n: AppNotification) => {
    if (n.read) return;
    setItems((prev) => prev.map((row) => (row.id === n.id ? { ...row, read: true } : row)));
    await supabase.from('notifications').update({ read: true }).eq('id', n.id);
  };

  const markAllRead = async () => {
    if (!user) return;
    const unreadIds = items.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    setItems((prev) => prev.map((row) => ({ ...row, read: true })));
    await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false);
  };

  const handleItemClick = (n: AppNotification) => {
    markRead(n);
    setOpen(false);
    if (n.group_id) navigate('/groups/' + n.group_id);
    else navigate('/groups');
  };

  if (!user) return null;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unreadCount > 0 ? 'Notifications, ' + unreadCount + ' unread' : 'Notifications'}
        title="Notifications"
        className="relative w-8 h-8 flex items-center justify-center rounded-md border border-rule text-ink-faint hover:text-ink hover:border-ink/30 transition-colors shrink-0"
      >
        <Icon name="bell" size={16} />
        {unreadCount > 0 ? (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-brick text-white text-[10px] font-mono leading-4 text-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 mt-2 w-80 max-w-[90vw] bg-paper border border-rule rounded-lg shadow-lg z-30 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-rule">
            <p className="label-eyebrow">Notifications</p>
            {unreadCount > 0 ? (
              <button type="button" onClick={markAllRead} className="text-xs text-emerald hover:underline">
                Mark all read
              </button>
            ) : null}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="text-sm text-ink-soft p-4 text-center">Nothing yet.</p>
            ) : (
              <ul>
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleItemClick(n)}
                      className={
                        'w-full text-left px-3 py-2.5 border-b border-rule last:border-b-0 hover:bg-ink/5 transition-colors ' +
                        (n.read ? '' : 'bg-emerald-light/30')
                      }
                    >
                      <p className={'text-sm ' + (n.read ? 'text-ink-soft' : 'text-ink font-medium')}>{n.title}</p>
                      {n.body ? <p className="text-xs text-ink-faint mt-0.5 truncate">{n.body}</p> : null}
                      <p className="text-[10px] text-ink-faint mt-1">{timeAgo(n.created_at)}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
