import { registerGuardian } from '@/lib/auth/accounts';
import { createSession, GUARDIAN_SESSION_MS } from '@/lib/auth/session';
import { HOME_BY_ROLE } from '@/lib/auth/home';
import { handle, readJson, setSessionCookie } from '@/lib/http';

export async function POST(req: Request) {
  return handle(async () => {
    const b = await readJson(req);
    const user = await registerGuardian({
      identifier: String(b.identifier ?? ''),
      code: String(b.code ?? ''),
      name: String(b.name ?? ''),
      password: String(b.password ?? ''),
    });
    await setSessionCookie(await createSession(user.id, user.role), GUARDIAN_SESSION_MS / 1000);
    return Response.json({ redirect: HOME_BY_ROLE[user.role] });
  });
}
