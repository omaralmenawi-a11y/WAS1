import type { Role, User } from '@prisma/client';
import { prisma } from './db';
import { Forbidden, NotFound, Unauthorized } from './errors';
import { getSessionUser } from './auth/session';
import { parseCookie, SESSION_COOKIE } from './cookies';

// No Next.js imports here: realtime.ts (loaded by server.ts before next().prepare()) depends on this module.

export const MUST_CHANGE_PASSWORD = 'MUST_CHANGE_PASSWORD';

/**
 * API-route auth: session user from the request cookie, else 401. A user who must change the
 * temporary password gets 403 MUST_CHANGE_PASSWORD everywhere except the password route
 * (allowMustChangePassword); logout needs no user.
 */
export async function requireUser(req: Request, opts: { allowMustChangePassword?: boolean } = {}): Promise<User> {
  const user = await getSessionUser(parseCookie(req.headers.get('cookie'), SESSION_COOKIE));
  if (!user) throw new Unauthorized();
  if (user.mustChangePassword && !opts.allowMustChangePassword) {
    throw new Forbidden('يجب تغيير كلمة المرور المؤقتة أولاً', MUST_CHANGE_PASSWORD);
  }
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
