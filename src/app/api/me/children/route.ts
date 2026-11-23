import { requireUser } from '@/lib/authz';
import { listChildrenForUser } from '@/lib/guardian/children';
import { handle } from '@/lib/http';

export const GET = (req: Request) =>
  handle(async () => Response.json(await listChildrenForUser(await requireUser(req))));
