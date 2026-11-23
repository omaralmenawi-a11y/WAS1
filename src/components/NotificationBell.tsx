'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useLive, useOnReconnect } from './live';

export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const refresh = useCallback(() => {
    fetch('/api/notifications')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setUnread(d.unread))
      .catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);
  useOnReconnect(refresh);
  useLive('notification:new', () => setUnread((n) => n + 1));
  return (
    <Link href="/parent/notifications" aria-label={unread ? `الإشعارات، ${unread} غير مقروء` : 'الإشعارات'} className="relative inline-flex h-8 w-8 items-center justify-center">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
      {unread > 0 && (
        <span data-testid="bell-count" className="absolute -end-1 -top-1 min-w-4 rounded-full bg-teal px-1 text-center text-[10px] leading-4 text-white">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  );
}
