import Link from 'next/link';
import { requirePageUser } from '@/lib/auth/guard';
import { listInbox } from '@/lib/notify/inbox';
import { NotificationList } from '@/components/NotificationList';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const user = await requirePageUser(['GUARDIAN']);
  const rows = await listInbox(user, { limit: 30 });
  const initial = rows.map((r) => ({ id: r.id, title: r.title, body: r.body, url: r.url, createdAt: r.createdAt.toISOString(), readAt: r.readAt?.toISOString() ?? null }));
  return (
    <>
      <NotificationList initial={initial} />
      <Link href="/parent" className="block text-center text-sm text-teal">الرئيسية</Link>
    </>
  );
}
