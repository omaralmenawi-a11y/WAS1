import { requireUser } from '@/lib/authz';
import { ValidationError } from '@/lib/errors';
import { handle, readJson } from '@/lib/http';
import { verifyRecipient } from '@/lib/pickup/service';

export const POST = (req: Request) =>
  handle(async () => {
    const user = await requireUser(req);
    const b = await readJson(req);
    if (typeof b.qr === 'string' && b.qr) return Response.json(await verifyRecipient(user, { qr: b.qr }));
    if (typeof b.code !== 'string' || !b.code.trim()) throw new ValidationError('أدخل الرمز');
    const requestId = typeof b.requestId === 'string' && b.requestId ? b.requestId : undefined;
    return Response.json(await verifyRecipient(user, { requestId, code: b.code.trim() }));
  });
