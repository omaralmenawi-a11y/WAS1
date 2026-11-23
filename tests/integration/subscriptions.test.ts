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
    await subscribe(u, { endpoint: 'https://fcm.googleapis.com/fcm/send/1', keys });
    await subscribe(u, { endpoint: 'https://fcm.googleapis.com/fcm/send/1', keys: { p256dh: 'p2', auth: 'a2' }, userAgent: 'UA' });
    const rows = await prisma.pushSubscription.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].p256dh).toBe('p2');
    expect(rows[0].userAgent).toBe('UA');
  });

  it('endpoint of user A subscribed by user B moves to B', async () => {
    const a = await mk('a');
    const b = await mk('b');
    await subscribe(a, { endpoint: 'https://fcm.googleapis.com/fcm/send/1', keys });
    await subscribe(b, { endpoint: 'https://fcm.googleapis.com/fcm/send/1', keys });
    const rows = await prisma.pushSubscription.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(b.id);
  });

  it('non-https endpoint or empty keys -> ValidationError', async () => {
    const u = await mk('a');
    await expect(subscribe(u, { endpoint: 'http://fcm.googleapis.com/fcm/send/1', keys })).rejects.toBeInstanceOf(ValidationError);
    await expect(subscribe(u, { endpoint: 'https://fcm.googleapis.com/fcm/send/1', keys: { p256dh: '', auth: 'a' } })).rejects.toBeInstanceOf(ValidationError);
    expect(await prisma.pushSubscription.count()).toBe(0);
  });

  it('oversized keys -> ValidationError', async () => {
    const u = await mk('a');
    await expect(subscribe(u, { endpoint: 'https://fcm.googleapis.com/fcm/send/1', keys: { p256dh: 'x'.repeat(257), auth: 'a' } })).rejects.toBeInstanceOf(ValidationError);
    await expect(subscribe(u, { endpoint: 'https://fcm.googleapis.com/fcm/send/1', keys: { p256dh: 'p', auth: 'a'.repeat(257) } })).rejects.toBeInstanceOf(ValidationError);
  });

  it("unsubscribe of another user's endpoint does nothing; own is idempotent", async () => {
    const a = await mk('a');
    const b = await mk('b');
    await subscribe(a, { endpoint: 'https://fcm.googleapis.com/fcm/send/1', keys });
    await unsubscribe(b, 'https://fcm.googleapis.com/fcm/send/1');
    expect(await prisma.pushSubscription.count()).toBe(1);
    await unsubscribe(a, 'https://fcm.googleapis.com/fcm/send/1');
    await unsubscribe(a, 'https://fcm.googleapis.com/fcm/send/1');
    expect(await prisma.pushSubscription.count()).toBe(0);
  });

  it('accepts only known push-service hosts', async () => {
    const u = await mk('a');
    const ok = [
      'https://fcm.googleapis.com/fcm/send/x',
      'https://updates.push.services.mozilla.com/wpush/v2/x',
      'https://push.services.mozilla.com/x',
      'https://web.push.apple.com/x',
      'https://api.push.apple.com/x',
      'https://wns2-par02p.notify.windows.com/w/?token=x',
    ];
    for (const endpoint of ok) await subscribe(u, { endpoint, keys });
    expect(await prisma.pushSubscription.count()).toBe(ok.length);
    const bad = [
      'https://push.example/1',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/x',
      'https://fcm.googleapis.com.evil.com/x',
      'https://evilpush.apple.com/x',
      'https://notify.windows.com.evil.com/x',
      'https://user@fcm.googleapis.com/x',
      'https://fcm.googleapis.com:8443/x',
    ];
    for (const endpoint of bad) {
      await expect(subscribe(u, { endpoint, keys })).rejects.toThrow('عنوان الإشعارات غير مدعوم');
    }
    expect(await prisma.pushSubscription.count()).toBe(ok.length);
  });

  it('keeps at most 10 subscriptions per user, evicting the oldest', async () => {
    const u = await mk('a');
    const other = await mk('b');
    await subscribe(other, { endpoint: 'https://fcm.googleapis.com/fcm/send/other', keys });
    for (let i = 0; i < 10; i++) await subscribe(u, { endpoint: `https://fcm.googleapis.com/fcm/send/${i}`, keys });
    await prisma.pushSubscription.update({ where: { endpoint: 'https://fcm.googleapis.com/fcm/send/0' }, data: { createdAt: new Date('2020-01-01') } });
    await subscribe(u, { endpoint: 'https://fcm.googleapis.com/fcm/send/new', keys });
    const mine = await prisma.pushSubscription.findMany({ where: { userId: u.id } });
    expect(mine).toHaveLength(10);
    expect(mine.map((s) => s.endpoint)).not.toContain('https://fcm.googleapis.com/fcm/send/0');
    expect(mine.map((s) => s.endpoint)).toContain('https://fcm.googleapis.com/fcm/send/new');
    expect(await prisma.pushSubscription.count({ where: { userId: other.id } })).toBe(1);
  });
});
