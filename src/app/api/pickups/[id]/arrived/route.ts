import { requireUser } from '@/lib/authz';
import { handle } from '@/lib/http';
import { markArrived } from '@/lib/pickup/service';

export const POST = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    await markArrived(user, id);
    return Response.json({ ok: true });
  });
