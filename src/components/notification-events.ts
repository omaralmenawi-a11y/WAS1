'use client';
export const NOTIFICATIONS_READ_EVENT = 'wasl:notifications-read';

/** Tell the bell that read state changed so it refetches the unread count. */
export function announceNotificationsRead(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(NOTIFICATIONS_READ_EVENT));
}
