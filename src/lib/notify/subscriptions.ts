import type { User } from '@prisma/client';
import { prisma } from '../db';
import { ValidationError } from '../errors';

// Must not import next/headers or next/navigation.

/** Push services browsers actually use; any other host is refused (the server POSTs to this URL). */
const PUSH_HOSTS = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com']);
const PUSH_HOST_SUFFIXES = ['.push.apple.com', '.notify.windows.com'];
const MAX_PER_USER = 10;

function isPushService(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  return PUSH_HOSTS.has(host) || PUSH_HOST_SUFFIXES.some((s) => host.endsWith(s));
}

export type SubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string };

/** Upsert by endpoint (known push services only); an endpoint owned by another user (shared device) moves to this user. Max 10 per user. */
export async function subscribe(user: Pick<User, 'id'>, input: SubscriptionInput): Promise<void> {
  const { endpoint, keys, userAgent } = input ?? ({} as SubscriptionInput);
  if (typeof endpoint !== 'string' || !/^https:\/\/\S+$/.test(endpoint) || endpoint.length > 2048) {
    throw new ValidationError('عنوان الإشعارات غير صالح');
  }
  if (!isPushService(endpoint)) throw new ValidationError('عنوان الإشعارات غير مدعوم');
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' || !keys.p256dh || !keys.auth || keys.p256dh.length > 256 || keys.auth.length > 256) {
    throw new ValidationError('مفاتيح الإشعارات غير صالحة');
  }
  const ua = typeof userAgent === 'string' ? userAgent.slice(0, 300) : null;
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { userId: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: ua },
    update: { userId: user.id, p256dh: keys.p256dh, auth: keys.auth, userAgent: ua },
  });
  // At most MAX_PER_USER devices: evict the oldest.
  const extra = await prisma.pushSubscription.findMany({
    where: { userId: user.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: MAX_PER_USER,
    select: { id: true },
  });
  if (extra.length) await prisma.pushSubscription.deleteMany({ where: { id: { in: extra.map((x) => x.id) } } });
}

/** Deletes only the caller's own subscription; idempotent. */
export async function unsubscribe(user: Pick<User, 'id'>, endpoint: string): Promise<void> {
  if (typeof endpoint !== 'string' || !endpoint) return;
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
}
