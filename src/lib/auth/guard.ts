import type { Role, User } from '@prisma/client';
import { redirect } from 'next/navigation';
import { readSessionToken } from '../http';
import { Forbidden, Unauthorized } from '../errors';
import { HOME_BY_ROLE } from './home';
import { getSessionUser } from './session';

export async function currentUser(): Promise<User | null> {
  return getSessionUser(await readSessionToken());
}

export async function requireUser(opts: { allowMustChangePassword?: boolean } = {}): Promise<User> {
  const u = await currentUser();
  if (!u) throw new Unauthorized();
  if (u.mustChangePassword && !opts.allowMustChangePassword) throw new Forbidden('يجب تغيير كلمة المرور المؤقتة أولاً', 'MUST_CHANGE_PASSWORD');
  return u;
}

/** For server-component layouts: login redirect + forced password change. */
export async function requirePageUser(roles: Role[]): Promise<User> {
  const u = await currentUser();
  if (!u) redirect('/login');
  if (u.mustChangePassword) redirect('/account/password');
  if (!roles.includes(u.role)) redirect(HOME_BY_ROLE[u.role]);
  return u;
}
