import { requireUser } from '@/lib/authz';
import { ValidationError } from '@/lib/errors';
import { linkPhone, requestPhoneLinkOtp } from '@/lib/guardian/phone';
import { handle, readJson } from '@/lib/http';

/** POST {phone} sends the OTP; POST {phone, code} verifies it and links the phone. */
export const POST = (req: Request) =>
  handle(async () => {
    const user = await requireUser(req);
    const b = await readJson(req);
    if (typeof b.phone !== 'string') throw new ValidationError('رقم الجوال غير صالح');
    if (b.code === undefined) {
      await requestPhoneLinkOtp(user, b.phone);
      return Response.json({ ok: true });
    }
    const u = await linkPhone(user, b.phone, String(b.code));
    return Response.json({ ok: true, phone: u.phone });
  });
