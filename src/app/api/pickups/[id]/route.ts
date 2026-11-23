import { requireUser } from '@/lib/authz';
import { NotFound } from '@/lib/errors';
import { handle } from '@/lib/http';
import { loadRequestForViews, toOwnerView } from '@/lib/pickup/views';
import { cancelRequest } from '@/lib/pickup/service';

type Ctx = { params: Promise<{ id: string }> };

export const GET = (req: Request, ctx: Ctx) =>
  handle(async () => {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const r = await loadRequestForViews(id);
    if (!r || r.requesterId !== user.id) throw new NotFound();
    const times = r.items.map((i) => i.deliveredAt?.getTime() ?? 0);
    const deliveredMs = Math.max(0, ...times);
    return Response.json({
      ...toOwnerView(r),
      arrivedAt: r.arrivedAt?.toISOString() ?? null,
      deliveredAt: deliveredMs ? new Date(deliveredMs).toISOString() : null,
    });
  });

export const DELETE = (req: Request, ctx: Ctx) =>
  handle(async () => {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    await cancelRequest(user, id);
    return Response.json({ ok: true });
  });
