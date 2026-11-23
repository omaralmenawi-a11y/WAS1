import { getSessionUser, destroySession } from '@/lib/auth/session';
import { clearSessionCookie, handle, readJson, readSessionToken } from '@/lib/http';
import { unsubscribe } from '@/lib/notify/subscriptions';

export async function POST(req: Request) {
  return handle(async () => {
    const token = await readSessionToken();
    const { endpoint } = await readJson(req);
    if (token) {
      // Best-effort: drop this device's push subscription before the session goes away.
      if (typeof endpoint === 'string' && endpoint) {
        try {
          const user = await getSessionUser(token);
          if (user) await unsubscribe(user, endpoint);
        } catch (e) {
          console.error('logout unsubscribe failed', e);
        }
      }
      await destroySession(token);
    }
    await clearSessionCookie();
    return Response.json({ ok: true });
  });
}
