import type { User } from '@prisma/client';
import { prisma } from '../db';
import { ValidationError } from '../errors';

// Must not import next/headers or next/navigation.

export async function listInbox(user: Pick<User, 'id'>, opts: { limit?: number; before?: string } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  let before: Date | undefined;
  if (opts.before) {
    before = new Date(opts.before);
    if (Number.isNaN(before.getTime())) throw new ValidationError();
  }
  return prisma.notification.findMany({
    where: { userId: user.id, ...(before ? { createdAt: { lt: before } } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });
}

export function unreadCount(user: Pick<User, 'id'>): Promise<number> {
  return prisma.notification.count({ where: { userId: user.id, readAt: null } });
}

export async function markRead(user: Pick<User, 'id'>, ids: string[] | 'all'): Promise<void> {
  if (ids !== 'all' && (!Array.isArray(ids) || ids.some((i) => typeof i !== 'string'))) throw new ValidationError();
  await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null, ...(ids === 'all' ? {} : { id: { in: ids } }) },
    data: { readAt: new Date() },
  });
}
