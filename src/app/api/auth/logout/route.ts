import { logoutDevice } from '@/lib/auth/session';
import { clearSessionCookie, handle, readJson, readSessionToken } from '@/lib/http';

export async function POST(req: Request) {
  return handle(async () => {
    const token = await readSessionToken();
    const { endpoint } = await readJson(req);
    // Drops this device's push subscription before the session goes away.
    if (token) await logoutDevice(token, endpoint);
    await clearSessionCookie();
    return Response.json({ ok: true });
  });
}
