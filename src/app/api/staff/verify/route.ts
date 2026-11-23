import { requireUser } from '@/lib/authz';
import { ValidationError } from '@/lib/errors';
import { handle, readJson } from '@/lib/http';
import { verifyRecipient } from '@/lib/pickup/service';

export const POST = (req: Request) =>
  handle(async () => {
    const user = await requireUser(req);
    const b = await readJson(req);
    if (typeof b.qr === 'string' && b.qr) return Response.json(await verifyRecipient(user, { qr: b.qr }));
    const number = typeof b.requestNumber === 'number' ? b.requestNumber : typeof b.requestNumber === 'string' && /^\d{1,10}$/.test(b.requestNumber.trim()) ? Number(b.requestNumber.trim()) : NaN;
    if (!Number.isInteger(number) || number < 1) throw new ValidationError('أدخل رقم الطلب');
    if (typeof b.code !== 'string' || !b.code.trim()) throw new ValidationError('أدخل الرمز');
    const branchId = typeof b.branchId === 'string' && b.branchId ? b.branchId : undefined;
    return Response.json(await verifyRecipient(user, { requestNumber: number, code: b.code.trim(), branchId }));
  });
