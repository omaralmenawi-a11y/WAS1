import { changePassword } from '@/lib/auth/accounts';
import { requireUser } from '@/lib/auth/guard';
import { HOME_BY_ROLE } from '@/lib/auth/home';
import { handle, readJson } from '@/lib/http';

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const b = await readJson(req);
    await changePassword(user.id, String(b.current ?? ''), String(b.password ?? ''));
    return Response.json({ redirect: HOME_BY_ROLE[user.role] });
  });
}
