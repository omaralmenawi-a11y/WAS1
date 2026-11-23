import { requireUser } from '@/lib/authz';
import { handle } from '@/lib/http';
import { ValidationError } from '@/lib/errors';
import { listBranchAudit } from '@/lib/school/dashboard';

export const GET = (req: Request) =>
  handle(async () => {
    const user = await requireUser(req);
    const p = new URL(req.url).searchParams;
    const branchId = p.get('branchId');
    if (!branchId) throw new ValidationError('حدد الفرع');
    const limit = Number(p.get('limit') ?? 20);
    return Response.json(await listBranchAudit(user, branchId, Number.isFinite(limit) ? limit : 20));
  });
