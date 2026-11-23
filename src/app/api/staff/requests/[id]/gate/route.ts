import { requireUser } from '@/lib/authz';
import { ValidationError } from '@/lib/errors';
import { handle, readJson } from '@/lib/http';
import { changeGate } from '@/lib/pickup/service';

export const POST = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const b = await readJson(req);
    if (typeof b.gateId !== 'string' || !b.gateId) throw new ValidationError('اختر البوابة');
    await changeGate(user, id, b.gateId);
    return Response.json({ ok: true });
  });
