import type { User } from '@prisma/client';
import { prisma } from '../db';
import { ValidationError } from '../errors';

// Must not import next/headers or next/navigation.

export type SubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string };

/** Upsert by endpoint; an endpoint owned by another user (shared device) moves to this user. */
export async function subscribe(user: Pick<User, 'id'>, input: SubscriptionInput): Promise<void> {
  const { endpoint, keys, userAgent } = input ?? ({} as SubscriptionInput);
  if (typeof endpoint !== 'string' || !/^https:\/\/\S+$/.test(endpoint) || endpoint.length > 2048) {
    throw new ValidationError('عنوان الإشعارات غير صالح');
  }
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' || !keys.p256dh || !keys.auth) {
    throw new ValidationError('مفاتيح الإشعارات غير صالحة');
  }
  const ua = typeof userAgent === 'string' ? userAgent.slice(0, 300) : null;
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { userId: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: ua },
    update: { userId: user.id, p256dh: keys.p256dh, auth: keys.auth, userAgent: ua },
  });
}

/** Deletes only the caller's own subscription; idempotent. */
export async function unsubscribe(user: Pick<User, 'id'>, endpoint: string): Promise<void> {
  if (typeof endpoint !== 'string' || !endpoint) return;
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
}
