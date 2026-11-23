import { requireRole, requireUser } from '@/lib/authz';
import { handle } from '@/lib/http';
import { pushEnabled } from '@/lib/notify/push';

export const dynamic = 'force-dynamic';

export const GET = (req: Request) =>
  handle(async () => {
    requireRole(await requireUser(req), 'GUARDIAN');
    return Response.json({ publicKey: pushEnabled() ? process.env.VAPID_PUBLIC_KEY ?? null : null });
  });
