import { requireUser } from '@/lib/authz';
import { ValidationError } from '@/lib/errors';
import { handle, readJson } from '@/lib/http';
import { markRead } from '@/lib/notify/inbox';

export const POST = (req: Request) =>
  handle(async () => {
    const user = await requireUser(req);
    const b = await readJson(req);
    if (b.ids !== 'all' && !Array.isArray(b.ids)) throw new ValidationError();
    await markRead(user, b.ids);
    return Response.json({ ok: true });
  });
