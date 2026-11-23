import { login } from '@/lib/auth/accounts';
import { createSession, GUARDIAN_SESSION_MS, STAFF_SESSION_MS } from '@/lib/auth/session';
import { HOME_BY_ROLE } from '@/lib/auth/home';
import { handle, readJson, setSessionCookie } from '@/lib/http';

export async function POST(req: Request) {
  return handle(async () => {
    const b = await readJson(req);
    const user = await login({ identifier: String(b.identifier ?? ''), password: String(b.password ?? '') });
    const long = user.role === 'GUARDIAN' || user.role === 'DELEGATE';
    await setSessionCookie(await createSession(user.id, user.role), (long ? GUARDIAN_SESSION_MS : STAFF_SESSION_MS) / 1000);
    return Response.json({ redirect: user.mustChangePassword ? '/account/password' : HOME_BY_ROLE[user.role] });
  });
}
