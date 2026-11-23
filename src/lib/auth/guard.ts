import type { Role, User } from '@prisma/client';
import { redirect } from 'next/navigation';
import { readSessionToken } from '../http';
import { Unauthorized } from '../errors';
import { HOME_BY_ROLE } from './home';
import { getSessionUser } from './session';

export async function currentUser(): Promise<User | null> {
  return getSessionUser(await readSessionToken());
}

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) throw new Unauthorized();
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
