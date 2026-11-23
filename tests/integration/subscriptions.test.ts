import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/db';
import { subscribe, unsubscribe } from '../../src/lib/notify/subscriptions';
import { ValidationError } from '../../src/lib/errors';
import './setup';

const mk = (n: string) => prisma.user.create({ data: { role: 'GUARDIAN', name: n, passwordHash: 'x', phone: `+9665${Math.floor(Math.random() * 1e8)}` } });
const keys = { p256dh: 'p', auth: 'a' };

describe('subscriptions', () => {
  it('subscribe twice same endpoint keeps one row', async () => {
    const u = await mk('a');
    await subscribe(u, { endpoint: 'https://push.example/1', keys });
    await subscribe(u, { endpoint: 'https://push.example/1', keys: { p256dh: 'p2', auth: 'a2' }, userAgent: 'UA' });
    const rows = await prisma.pushSubscription.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].p256dh).toBe('p2');
    expect(rows[0].userAgent).toBe('UA');
  });

  it('endpoint of user A subscribed by user B moves to B', async () => {
    const a = await mk('a');
    const b = await mk('b');
    await subscribe(a, { endpoint: 'https://push.example/1', keys });
    await subscribe(b, { endpoint: 'https://push.example/1', keys });
    const rows = await prisma.pushSubscription.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(b.id);
  });

  it('non-https endpoint or empty keys -> ValidationError', async () => {
    const u = await mk('a');
    await expect(subscribe(u, { endpoint: 'http://push.example/1', keys })).rejects.toBeInstanceOf(ValidationError);
    await expect(subscribe(u, { endpoint: 'https://push.example/1', keys: { p256dh: '', auth: 'a' } })).rejects.toBeInstanceOf(ValidationError);
    expect(await prisma.pushSubscription.count()).toBe(0);
  });

  it("unsubscribe of another user's endpoint does nothing; own is idempotent", async () => {
    const a = await mk('a');
    const b = await mk('b');
    await subscribe(a, { endpoint: 'https://push.example/1', keys });
    await unsubscribe(b, 'https://push.example/1');
    expect(await prisma.pushSubscription.count()).toBe(1);
    await unsubscribe(a, 'https://push.example/1');
    await unsubscribe(a, 'https://push.example/1');
    expect(await prisma.pushSubscription.count()).toBe(0);
  });
});
