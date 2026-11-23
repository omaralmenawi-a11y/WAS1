import { requireUser } from '@/lib/authz';
import { handle } from '@/lib/http';
import { listInbox, unreadCount } from '@/lib/notify/inbox';

export const dynamic = 'force-dynamic';

export const GET = (req: Request) =>
  handle(async () => {
    const user = await requireUser(req);
    const before = new URL(req.url).searchParams.get('before') ?? undefined;
    const [items, unread] = await Promise.all([listInbox(user, { before }), unreadCount(user)]);
    return Response.json({ items, unread });
  });
