import { requireUser } from '@/lib/authz';
import { handle } from '@/lib/http';
import { ValidationError } from '@/lib/errors';
import { getDashboard } from '@/lib/school/dashboard';

export const GET = (req: Request) =>
  handle(async () => {
    const user = await requireUser(req);
    const branchId = new URL(req.url).searchParams.get('branchId');
    if (!branchId) throw new ValidationError('حدد الفرع');
    return Response.json(await getDashboard(user, branchId));
  });
