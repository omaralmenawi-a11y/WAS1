import { issueOtp, type OtpPurpose } from '@/lib/auth/otp';
import { ValidationError } from '@/lib/errors';
import { handle, readJson } from '@/lib/http';

const PURPOSES: OtpPurpose[] = ['REGISTER', 'RESET'];

export async function POST(req: Request) {
  return handle(async () => {
    const { identifier, purpose } = await readJson(req);
    if (typeof identifier !== 'string' || !PURPOSES.includes(purpose)) throw new ValidationError();
    await issueOtp(identifier, purpose);
    return Response.json({ ok: true });
  });
}
