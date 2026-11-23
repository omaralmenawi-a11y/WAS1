import { requireRole, requireUser } from '@/lib/authz';
import { handle, readJson } from '@/lib/http';
import { subscribe, unsubscribe } from '@/lib/notify/subscriptions';

export const POST = (req: Request) =>
  handle(async () => {
    const user = await requireUser(req);
    requireRole(user, 'GUARDIAN');
    const b = await readJson(req);
    await subscribe(user, { endpoint: b.endpoint, keys: b.keys, userAgent: req.headers.get('user-agent') ?? undefined });
    return Response.json({ ok: true });
  });

export const DELETE = (req: Request) =>
  handle(async () => {
    const user = await requireUser(req);
    requireRole(user, 'GUARDIAN');
    const b = await readJson(req);
    await unsubscribe(user, b.endpoint);
    return Response.json({ ok: true });
  });
