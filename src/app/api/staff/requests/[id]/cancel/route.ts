import { requireUser } from '@/lib/authz';
import { ValidationError } from '@/lib/errors';
import { handle, readJson } from '@/lib/http';
import { cancelRequest } from '@/lib/pickup/service';

export const POST = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const b = await readJson(req);
    if (typeof b.reasonAr !== 'string' || !b.reasonAr.trim()) throw new ValidationError('سبب الإلغاء مطلوب');
    await cancelRequest(user, id, b.reasonAr);
    return Response.json({ ok: true });
  });
