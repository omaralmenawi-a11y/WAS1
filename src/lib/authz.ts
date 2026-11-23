import type { Role, User } from '@prisma/client';
import { prisma } from './db';
import { Forbidden, NotFound, Unauthorized } from './errors';
import { getSessionUser } from './auth/session';
import { SESSION_COOKIE } from './http';

export { currentUser } from './auth/guard';

function cookieValue(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/** API-route auth: session user from the request cookie, else 401. */
export async function requireUser(req: Request): Promise<User> {
  const user = await getSessionUser(cookieValue(req.headers.get('cookie'), SESSION_COOKIE));
  if (!user) throw new Unauthorized();
  return user;
}

export function requireRole(user: User, ...roles: Role[]): void {
  if (!roles.includes(user.role)) throw new Forbidden();
}

/** Cross-tenant access is reported as NotFound so existence is never leaked. */
export function assertSchoolAccess(user: User, schoolId: string): void {
  if (user.role === 'PLATFORM_ADMIN') return;
  if ((user.role === 'SCHOOL_ADMIN' || user.role === 'STAFF') && user.schoolId === schoolId) return;
  throw new NotFound();
}

export async function assertBranchAccess(user: User, branchId: string): Promise<void> {
  if (user.role === 'STAFF') {
    if (user.branchId === branchId) return;
    throw new NotFound();
  }
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { schoolId: true } });
  if (!branch) throw new NotFound();
  if (user.role === 'PLATFORM_ADMIN') return;
  if (user.role === 'SCHOOL_ADMIN' && user.schoolId === branch.schoolId) return;
  throw new NotFound();
}
