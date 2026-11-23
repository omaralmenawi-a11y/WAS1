import { createHash, randomBytes } from 'node:crypto';
import type { Role, User } from '@prisma/client';
import { prisma } from '../db';
import { now } from '../time';

const HOUR = 3_600_000;
export const GUARDIAN_SESSION_MS = 30 * 24 * HOUR;
export const STAFF_SESSION_MS = 12 * HOUR;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function createSession(userId: string, role: Role): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const ttl = role === 'GUARDIAN' || role === 'DELEGATE' ? GUARDIAN_SESSION_MS : STAFF_SESSION_MS;
  await prisma.session.create({
    data: { userId, tokenHash: sha256(token), expiresAt: new Date(now().getTime() + ttl) },
  });
  return token;
}

export async function getSessionUser(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const s = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!s || s.expiresAt <= now() || !s.user.active) return null;
  return s.user;
}

export async function destroySession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
}

/** Ends every session of the user except the one holding keepToken (all of them when it is absent). */
export async function destroyOtherSessions(userId: string, keepToken?: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId, ...(keepToken ? { tokenHash: { not: sha256(keepToken) } } : {}) } });
}
