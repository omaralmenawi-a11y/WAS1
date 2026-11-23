import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/db';
import { notify } from '../../src/lib/notify';
import { setPushSender, type PushSender } from '../../src/lib/notify/push';

type Sub = { endpoint: string; p256dh: string; auth: string };

function fakeSender(results: Record<string, 'ok' | 'gone' | 'error'> = {}) {
  const calls: { sub: Sub; payload: string }[] = [];
  const sender: PushSender = {
    async send(sub, payload) {
      calls.push({ sub, payload });
      return results[sub.endpoint] ?? 'ok';
    },
  };
  return { sender, calls };
}

async function mkUser(name = 'u') {
  return prisma.user.create({ data: { role: 'GUARDIAN', name, passwordHash: 'x', phone: `+9665${Math.floor(Math.random() * 1e8)}` } });
}
async function mkSub(userId: string, endpoint: string) {
  return prisma.pushSubscription.create({ data: { userId, endpoint, p256dh: 'p', auth: 'a' } });
}
const payload = { kind: 'TEST', title: 'عنوان', body: 'نص', url: '/guardian' };

beforeEach(() => setPushSender(null));
afterEach(() => setPushSender(null));

describe('notify', () => {
  it('stores one inbox row per user and pushes to each of their subscriptions', async () => {
    const u = await mkUser();
    await mkSub(u.id, 'https://e/1');
    await mkSub(u.id, 'https://e/2');
    const { sender, calls } = fakeSender();
    setPushSender(sender);
    const r = await notify([u.id], payload);
    expect(r).toEqual({ created: 1, pushed: 2 });
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(1);
    expect(JSON.parse(calls[0].payload)).toEqual({ title: 'عنوان', body: 'نص', url: '/guardian', tag: 'TEST' });
  });

  it('same dedupeKey twice creates and pushes once', async () => {
    const u = await mkUser();
    await mkSub(u.id, 'https://e/1');
    const { sender, calls } = fakeSender();
    setPushSender(sender);
    const opts = { dedupeKey: (id: string) => `k:${id}` };
    expect(await notify([u.id], payload, opts)).toEqual({ created: 1, pushed: 1 });
    expect(await notify([u.id], payload, opts)).toEqual({ created: 0, pushed: 0 });
    expect(calls).toHaveLength(1);
    expect(await prisma.notification.count()).toBe(1);
  });

  it('gone subscription is deleted, others still receive', async () => {
    const u = await mkUser();
    await mkSub(u.id, 'https://e/gone');
    await mkSub(u.id, 'https://e/ok');
    const { sender } = fakeSender({ 'https://e/gone': 'gone' });
    setPushSender(sender);
    const r = await notify([u.id], payload);
    expect(r.pushed).toBe(1);
    const left = await prisma.pushSubscription.findMany();
    expect(left.map((s) => s.endpoint)).toEqual(['https://e/ok']);
  });

  it('sender error does not throw and does not delete the subscription', async () => {
    const u = await mkUser();
    await mkSub(u.id, 'https://e/err');
    const { sender } = fakeSender({ 'https://e/err': 'error' });
    setPushSender(sender);
    await expect(notify([u.id], payload)).resolves.toEqual({ created: 1, pushed: 0 });
    expect(await prisma.pushSubscription.count()).toBe(1);
  });

  it('no push sender configured → still stores inbox row, pushed === 0', async () => {
    const u = await mkUser();
    await mkSub(u.id, 'https://e/1');
    const r = await notify([u.id], payload);
    expect(r).toEqual({ created: 1, pushed: 0 });
    expect(await prisma.notification.count()).toBe(1);
  });

  it('successful push sets lastSuccessAt', async () => {
    const u = await mkUser();
    await mkSub(u.id, 'https://e/1');
    setPushSender(fakeSender().sender);
    await notify([u.id], payload);
    const s = await prisma.pushSubscription.findFirstOrThrow();
    expect(s.lastSuccessAt).not.toBeNull();
  });

  it('push tag is the payload tag when given, else the kind', async () => {
    const u = await mkUser();
    await mkSub(u.id, 'https://e/1');
    const { sender, calls } = fakeSender();
    setPushSender(sender);
    await notify([u.id], { ...payload, tag: 'TEST:abc' });
    expect(JSON.parse(calls[0].payload).tag).toBe('TEST:abc');
  });
});
