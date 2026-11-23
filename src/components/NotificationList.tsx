'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useLive } from './live';
import { announceNotificationsRead } from './notification-events';

type Item = { id: string; title: string; body: string; url: string; createdAt: string; readAt: string | null };

const fmt = new Intl.DateTimeFormat('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' });

export function NotificationList({ initial }: { initial: Item[] }) {
  const [items, setItems] = useState(initial);
  const [more, setMore] = useState(initial.length >= 30);
  useLive<{ id: string; title: string; body: string; url: string; createdAt: string }>('notification:new', (n) =>
    setItems((cur) => (cur.some((i) => i.id === n.id) ? cur : [{ ...n, readAt: null }, ...cur])),
  );

  async function markAll() {
    const res = await fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: 'all' }) });
    if (res.ok) {
      setItems((cur) => cur.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })));
      announceNotificationsRead();
    }
  }
  async function loadMore() {
    const last = items[items.length - 1];
    const res = await fetch(`/api/notifications?before=${encodeURIComponent(last.createdAt)}`);
    if (!res.ok) return;
    const d = await res.json();
    setItems((cur) => [...cur, ...d.items]);
    setMore(d.items.length >= 30);
  }
  async function open(i: Item) {
    if (!i.readAt) {
      fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [i.id] }) })
        .then(() => announceNotificationsRead())
        .catch(() => {});
      setItems((cur) => cur.map((x) => (x.id === i.id ? { ...x, readAt: new Date().toISOString() } : x)));
    }
  }

  const hasUnread = items.some((i) => !i.readAt);
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-lg">الإشعارات</h1>
        <button type="button" onClick={markAll} disabled={!hasUnread} className="text-sm text-teal disabled:opacity-40">
          تحديد الكل كمقروء
        </button>
      </div>
      {items.length === 0 && <p className="rounded-xl bg-white p-6 text-center text-navy/70 shadow-sm ring-1 ring-navy/10">لا توجد إشعارات</p>}
      <ul className="space-y-2">
        {items.map((i) => (
          <li key={i.id}>
            <Link
              href={i.url.startsWith('/') && !i.url.startsWith('//') ? i.url : '/parent'}
              onClick={() => open(i)}
              className={`block rounded-xl bg-white p-4 shadow-sm ring-1 ring-navy/10 ${i.readAt ? '' : 'border-s-4 border-teal'}`}
            >
              <p className={i.readAt ? 'font-medium' : 'font-bold'}>{i.title}</p>
              <p className="mt-1 text-sm text-navy/70">{i.body}</p>
              <p className="mt-1 text-xs text-navy/50">{fmt.format(new Date(i.createdAt))}</p>
            </Link>
          </li>
        ))}
      </ul>
      {more && (
        <button type="button" onClick={loadMore} className="w-full rounded-lg border border-navy/20 py-2 text-sm">
          عرض المزيد
        </button>
      )}
    </>
  );
}
