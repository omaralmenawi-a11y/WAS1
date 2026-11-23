import { requireUser } from '@/lib/authz';
import { handle } from '@/lib/http';
import { listStaffRequests } from '@/lib/pickup/staff';

export const GET = (req: Request) =>
  handle(async () => {
    const user = await requireUser(req);
    const p = new URL(req.url).searchParams;
    return Response.json(await listStaffRequests(user, { q: p.get('q') ?? undefined, branchId: p.get('branchId') ?? undefined }));
  });
