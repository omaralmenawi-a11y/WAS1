import { requireUser } from '@/lib/authz';
import { handle, readJson } from '@/lib/http';
import { listOwnRequests } from '@/lib/pickup/own';
import { createRequest } from '@/lib/pickup/service';
import { ValidationError } from '@/lib/errors';

export const POST = (req: Request) =>
  handle(async () => {
    const user = await requireUser(req);
    const b = await readJson(req);
    if (!Array.isArray(b.studentIds) || b.studentIds.some((x: unknown) => typeof x !== 'string')) throw new ValidationError('اختر طالباً واحداً على الأقل');
    const r = await createRequest(user, b.studentIds);
    return Response.json({ id: r.id, number: r.number }, { status: 201 });
  });

export const GET = (req: Request) =>
  handle(async () => {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const open = url.searchParams.get('open');
    const limit = Number(url.searchParams.get('limit')) || 30;
    return Response.json(await listOwnRequests(user, { open: open === null ? undefined : open === 'true', limit }));
  });
