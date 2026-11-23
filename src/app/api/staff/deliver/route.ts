import { requireUser } from '@/lib/authz';
import { ValidationError } from '@/lib/errors';
import { handle, readJson } from '@/lib/http';
import { deliverItems } from '@/lib/pickup/service';

export const POST = (req: Request) =>
  handle(async () => {
    const user = await requireUser(req);
    const b = await readJson(req);
    if (typeof b.requestId !== 'string' || !Array.isArray(b.itemIds) || b.itemIds.some((x: unknown) => typeof x !== 'string'))
      throw new ValidationError('اختر عنصراً واحداً على الأقل');
    await deliverItems(user, b.requestId, b.itemIds);
    return Response.json({ ok: true });
  });
