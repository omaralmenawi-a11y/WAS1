import { requireUser } from '@/lib/authz';
import { ValidationError } from '@/lib/errors';
import { handle, readJson } from '@/lib/http';
import { advanceItem } from '@/lib/pickup/service';

export const PATCH = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const b = await readJson(req);
    if (b.action !== 'PREPARE' && b.action !== 'READY') throw new ValidationError('إجراء غير صالح');
    const item = await advanceItem(user, id, b.action);
    return Response.json({ id: item.id, status: item.status });
  });
