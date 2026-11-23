import { requireUser } from '@/lib/authz';
import { handle, readJson } from '@/lib/http';
import { updateLocation } from '@/lib/pickup/service';

export const POST = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const b = await readJson(req);
    return Response.json(await updateLocation(user, id, { lat: b.lat, lng: b.lng, accuracy: b.accuracy }));
  });
