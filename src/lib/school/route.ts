import { requireUser } from '../authz';
import { handle, readJson } from '../http';
import type { User } from '@prisma/client';

type Ctx = { params: Promise<{ id?: string }> };
type Fn = (actor: User, body: Record<string, any>, id?: string) => Promise<unknown>;

/** Route handler factory: auth -> body -> domain fn -> JSON. */
export function mutation(fn: Fn, status = 200) {
  return (req: Request, ctx: Ctx) =>
    handle(async () => {
      const actor = await requireUser(req);
      const body = await readJson(req);
      const id = ctx ? (await ctx.params).id : undefined;
      return Response.json(await fn(actor, body, id), { status });
    });
}
