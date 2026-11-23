import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { emitToUser } from '../realtime';
import { getPushSender } from './push';

// Must not import next/headers or next/navigation: reachable from server.ts via pickup/service.

export type NotificationPayload = { kind: string; title: string; body: string; url: string };

const PUSH_TIMEOUT_MS = 10_000;

function withTimeout<T>(p: Promise<T>, fallback: T): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([p, new Promise<T>((r) => (t = setTimeout(() => r(fallback), PUSH_TIMEOUT_MS)))]).finally(() => clearTimeout(t));
}

async function notifyOne(userId: string, payload: NotificationPayload, dedupeKey: string | undefined) {
  let row;
  try {
    row = await prisma.notification.create({
      data: { userId, kind: payload.kind, title: payload.title, body: payload.body, url: payload.url, dedupeKey },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { created: 0, pushed: 0 };
    throw e;
  }
  emitToUser(userId, 'notification:new', {
    id: row.id, kind: row.kind, title: row.title, body: row.body, url: row.url, createdAt: row.createdAt,
  });

  const sender = getPushSender();
  if (!sender) return { created: 1, pushed: 0 };
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  const body = JSON.stringify({ title: payload.title, body: payload.body, url: payload.url, tag: payload.kind });
  const results = await Promise.all(
    subs.map(async (s) => {
      let r: 'ok' | 'gone' | 'error';
      try {
        r = await withTimeout(sender.send({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, body), 'error' as const);
      } catch (e) {
        console.error('push send threw', e);
        r = 'error';
      }
      try {
        if (r === 'gone') await prisma.pushSubscription.deleteMany({ where: { id: s.id } });
        else if (r === 'ok') await prisma.pushSubscription.updateMany({ where: { id: s.id }, data: { lastSuccessAt: new Date() } });
      } catch (e) {
        console.error('push bookkeeping failed', e);
      }
      return r;
    }),
  );
  return { created: 1, pushed: results.filter((r) => r === 'ok').length };
}

/** Inbox row + live socket event + Web Push per user. Never throws. */
export async function notify(
  userIds: string[],
  payload: NotificationPayload,
  opts?: { dedupeKey?: (userId: string) => string },
): Promise<{ created: number; pushed: number }> {
  let created = 0;
  let pushed = 0;
  for (const userId of [...new Set(userIds)]) {
    try {
      const r = await notifyOne(userId, payload, opts?.dedupeKey?.(userId));
      created += r.created;
      pushed += r.pushed;
    } catch (e) {
      console.error('notify failed', userId, e);
    }
  }
  return { created, pushed };
}

/** Bridge (ruling N1): Task 3 replaces the pickup service's calls with real notifications. */
export async function notifyPickupEvent(_userIds: string[], _event: string, _data: object): Promise<void> {}
