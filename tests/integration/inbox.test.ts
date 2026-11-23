import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/db';
import { listInbox, markRead, unreadCount } from '../../src/lib/notify/inbox';
import './setup';

const mk = (n: string) => prisma.user.create({ data: { role: 'GUARDIAN', name: n, passwordHash: 'x', phone: `+9665${Math.floor(Math.random() * 1e8)}` } });
const note = (userId: string, i: number) =>
  prisma.notification.create({ data: { userId, kind: 'T', title: `t${i}`, body: 'b', url: '/parent', createdAt: new Date(Date.UTC(2026, 10, 1, 0, i)) } });

describe('inbox', () => {
  it('lists only own rows newest first, with paging', async () => {
    const a = await mk('a');
    const b = await mk('b');
    for (let i = 0; i < 5; i++) await note(a.id, i);
    await note(b.id, 9);
    const page1 = await listInbox(a, { limit: 3 });
    expect(page1.map((n) => n.title)).toEqual(['t4', 't3', 't2']);
    const page2 = await listInbox(a, { limit: 3, before: page1[2].createdAt.toISOString() });
    expect(page2.map((n) => n.title)).toEqual(['t1', 't0']);
  });

  it("markRead('all') zeroes unreadCount; other user's id has no effect", async () => {
    const a = await mk('a');
    const b = await mk('b');
    await note(a.id, 1);
    const n2 = await note(a.id, 2);
    const nb = await note(b.id, 3);
    expect(await unreadCount(a)).toBe(2);
    await markRead(a, [nb.id]);
    expect(await unreadCount(b)).toBe(1);
    expect(await unreadCount(a)).toBe(2);
    await markRead(a, [n2.id]);
    expect(await unreadCount(a)).toBe(1);
    await markRead(a, 'all');
    expect(await unreadCount(a)).toBe(0);
    expect(await unreadCount(b)).toBe(1);
  });
});
