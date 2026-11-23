import { destroySession } from '@/lib/auth/session';
import { clearSessionCookie, handle, readSessionToken } from '@/lib/http';

export async function POST() {
  return handle(async () => {
    const token = await readSessionToken();
    if (token) await destroySession(token);
    await clearSessionCookie();
    return Response.json({ ok: true });
  });
}
