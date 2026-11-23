import { changePassword } from '@/lib/auth/accounts';
import { HOME_BY_ROLE } from '@/lib/auth/home';
import { requireUser } from '@/lib/authz';
import { parseCookie, SESSION_COOKIE } from '@/lib/cookies';
import { handle, readJson } from '@/lib/http';

export async function POST(req: Request) {
  return handle(async () => {
    // The one API a user with a temporary password may call.
    const user = await requireUser(req, { allowMustChangePassword: true });
    const b = await readJson(req);
    const token = parseCookie(req.headers.get('cookie'), SESSION_COOKIE);
    await changePassword(user.id, String(b.current ?? ''), String(b.password ?? ''), token, typeof b.endpoint === 'string' ? b.endpoint : undefined);
    return Response.json({ redirect: HOME_BY_ROLE[user.role] });
  });
}
