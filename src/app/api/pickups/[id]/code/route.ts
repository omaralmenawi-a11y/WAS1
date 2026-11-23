import { requireUser } from '@/lib/authz';
import { handle } from '@/lib/http';
import { getOwnPickupCode } from '@/lib/pickup/own';

export const GET = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    return Response.json(await getOwnPickupCode(user, id), { headers: { 'cache-control': 'no-store' } });
  });
