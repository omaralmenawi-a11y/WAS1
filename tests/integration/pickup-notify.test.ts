import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as recipients from '../../src/lib/notify/recipients';
import { setStudentActive } from '../../src/lib/school/students';
import { prisma } from '../../src/lib/db';
import { createSchoolWithAdmin } from '../../src/lib/admin/schools';
import { createClassroom, createGate, setClassSchedule } from '../../src/lib/school/setup';
import { applyImport } from '../../src/lib/school/import';
import { updateStudent } from '../../src/lib/school/students';
import { advanceItem, cancelRequest, closeStaleRequests, createRequest, deliverItems, verifyRecipient } from '../../src/lib/pickup/service';
import { pickupCode } from '../../src/lib/pickup/code';
import { linkedGuardianIds } from '../../src/lib/notify/recipients';
import { setPushSender } from '../../src/lib/notify/push';
import { flushNotifications } from '../../src/lib/notify';

process.env.PICKUP_CODE_SECRET ||= 'test-secret';

const T = new Date('2026-11-23T09:30:00Z'); // Mon 12:30 Riyadh
const plus = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);
const P1 = '+966501234567';
const P2 = '+966507654321';
const P3 = '+966509999999';

beforeEach(() => setPushSender(null));
afterEach(async () => {
  await flushNotifications();
  setPushSender(null);
});

const guardian = (phone: string, name = 'ولي') => prisma.user.create({ data: { role: 'GUARDIAN', name, phone, passwordHash: 'x', photoKey: 'p' } });

async function setup() {
  const s = await createSchoolWithAdmin({ schoolName: 'م', branchName: 'ف', adminName: 'م', adminUsername: `a_${Math.random()}`, tempPassword: 'temp-pass-123' });
  await createGate(s.admin, { branchId: s.branch.id, name: 'بوابة 1' });
  const room = await createClassroom(s.admin, { branchId: s.branch.id, name: '1/أ', grade: '1' });
  for (const w of [0, 1, 2, 3, 4]) await setClassSchedule(s.admin, { classroomId: room.id, weekday: w, dismissal: '12:30' });
  await applyImport(s.admin, s.school.id, ['أحمد علي', 'بدر سعد'].map((n, i) => ({
    branch: s.branch.name, externalId: `${i}`, fullName: n, classroom: '1/أ', gate: 'بوابة 1', phones: [P1, P2],
  })));
  const [a, b] = await prisma.student.findMany({ where: { schoolId: s.school.id }, orderBy: { fullName: 'asc' } });
  const g1 = await guardian(P1, 'ولي 1');
  const g2 = await guardian(P2, 'ولي 2');
  const other = await guardian(P3, 'غريب');
  const staff = await prisma.user.create({ data: { role: 'STAFF', name: 'موظف', passwordHash: 'x', branchId: s.branch.id, schoolId: s.school.id, gateIds: [], username: `st_${Math.random()}` } });
  const req = await createRequest(g1, [a.id, b.id], T);
  return { s, a, b, g1, g2, other, staff, req };
}
const rows = async (userId: string, kind?: string) => {
  await flushNotifications();
  return prisma.notification.findMany({ where: { userId, ...(kind ? { kind } : {}) } });
};

describe('linkedGuardianIds', () => {
  it('returns active guardians whose phone matches a student phone', async () => {
    const { a, g1, g2, other } = await setup();
    const ids = await linkedGuardianIds([a.id]);
    expect(ids.sort()).toEqual([g1.id, g2.id].sort());
    expect(ids).not.toContain(other.id);
    await prisma.user.update({ where: { id: g2.id }, data: { active: false } });
    expect(await linkedGuardianIds([a.id])).toEqual([g1.id]);
    expect(await linkedGuardianIds([])).toEqual([]);
  });
});

describe('pickup status notifications', () => {
  it('PREPARING is per item: each sibling gets its own message naming only that child', async () => {
    const { req, staff, g1, g2 } = await setup();
    const [i1, i2] = req.items;
    await advanceItem(staff, i1.id, 'PREPARE', plus(T, 1));
    await advanceItem(staff, i2.id, 'PREPARE', plus(T, 1));
    const r = await rows(g1.id, 'PREPARING');
    expect(r).toHaveLength(2);
    expect(r.every((x) => x.title.split(' و ').length === 1 && x.title.startsWith('جاري تجهيز '))).toBe(true);
    expect(r[0].body).toBe(`الطلب ${req.number} · بوابة 1`);
    expect(r[0].url).toBe(`/parent/request/${req.id}`);
    expect(await rows(g2.id)).toHaveLength(0); // requester only
  });

  it('READY names only the ready child; the sibling gets its own message later', async () => {
    const { req, staff, g1 } = await setup();
    const [i1, i2] = req.items;
    await advanceItem(staff, i1.id, 'PREPARE', plus(T, 1));
    await advanceItem(staff, i2.id, 'PREPARE', plus(T, 1));
    await advanceItem(staff, i1.id, 'READY', plus(T, 2));
    let r = await rows(g1.id, 'READY');
    expect(r).toHaveLength(1);
    expect(r[0].title).toMatch(/^[^ ]+ جاهز للاستلام$/);
    await advanceItem(staff, i2.id, 'READY', plus(T, 3));
    r = await rows(g1.id, 'READY');
    expect(r).toHaveLength(2);
    expect(new Set(r.map((x) => x.title)).size).toBe(2);
  });

  it('deliver notifies requester and other linked guardian, not unrelated', async () => {
    const { req, staff, g1, g2, other } = await setup();
    for (const i of req.items) await advanceItem(staff, i.id, 'PREPARE', plus(T, 1));
    for (const i of req.items) await advanceItem(staff, i.id, 'READY', plus(T, 2));
    await verifyRecipient(staff, { requestNumber: req.number, code: pickupCode(req.id, plus(T, 3)) }, plus(T, 3));
    await deliverItems(staff, req.id, req.items.map((i) => i.id), plus(T, 4));
    for (const u of [g1, g2]) {
      const r = await rows(u.id, 'DELIVERED');
      expect(r).toHaveLength(1);
      expect(r[0].title).toMatch(/^تم تسليم /);
      expect(r[0].body).toBe('الساعة 12:34 · بوابة 1');
    }
    expect(await rows(other.id)).toHaveLength(0);
  });

  it('a throwing notification path does not fail deliverItems', async () => {
    const { req, staff } = await setup();
    for (const i of req.items) await advanceItem(staff, i.id, 'PREPARE', plus(T, 1));
    for (const i of req.items) await advanceItem(staff, i.id, 'READY', plus(T, 2));
    await verifyRecipient(staff, { requestNumber: req.number, code: pickupCode(req.id, plus(T, 3)) }, plus(T, 3));
    const spy = vi.spyOn(recipients, 'linkedGuardianIds').mockRejectedValue(new Error('boom'));
    try {
      await expect(deliverItems(staff, req.id, req.items.map((i) => i.id), plus(T, 4))).resolves.toBeUndefined();
      await flushNotifications();
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect(await prisma.pickupItem.count({ where: { requestId: req.id, status: 'DELIVERED' } })).toBe(2);
  });

  it('a failing push sender does not fail deliverItems', async () => {
    const { req, staff, g1 } = await setup();
    await prisma.pushSubscription.create({ data: { userId: g1.id, endpoint: 'https://e/x', p256dh: 'p', auth: 'a' } });
    setPushSender({ send: async () => { throw new Error('boom'); } });
    for (const i of req.items) await advanceItem(staff, i.id, 'PREPARE', plus(T, 1));
    for (const i of req.items) await advanceItem(staff, i.id, 'READY', plus(T, 2));
    await verifyRecipient(staff, { requestNumber: req.number, code: pickupCode(req.id, plus(T, 3)) }, plus(T, 3));
    await expect(deliverItems(staff, req.id, req.items.map((i) => i.id), plus(T, 4))).resolves.toBeUndefined();
    expect(await rows(g1.id, 'DELIVERED')).toHaveLength(1);
  });

  it('a push endpoint that never answers does not delay the hand-over; the inbox row is still written', async () => {
    const { req, staff, g1 } = await setup();
    await prisma.pushSubscription.create({ data: { userId: g1.id, endpoint: 'https://e/hung', p256dh: 'p', auth: 'a' } });
    const release: (() => void)[] = [];
    setPushSender({ send: () => new Promise((r) => release.push(() => r('ok'))) });
    try {
      for (const i of req.items) await advanceItem(staff, i.id, 'PREPARE', plus(T, 1));
      for (const i of req.items) await advanceItem(staff, i.id, 'READY', plus(T, 2));
      await verifyRecipient(staff, { requestNumber: req.number, code: pickupCode(req.id, plus(T, 3)) }, plus(T, 3));
      const t0 = Date.now();
      await deliverItems(staff, req.id, req.items.map((i) => i.id), plus(T, 4));
      expect(Date.now() - t0).toBeLessThan(1000);
      expect(await prisma.pickupItem.count({ where: { requestId: req.id, status: 'DELIVERED' } })).toBe(2);
      await vi.waitFor(async () => expect(await prisma.notification.count({ where: { userId: g1.id, kind: 'DELIVERED' } })).toBe(1));
    } finally {
      await vi.waitFor(() => expect(release.length).toBeGreaterThanOrEqual(5));
      release.forEach((r) => r());
    }
  });

  it('staff cancel: body is the reason, requester and other guardian notified', async () => {
    const { req, staff, g1, g2, other } = await setup();
    await cancelRequest(staff, req.id, 'تعذر الاستلام', plus(T, 1));
    for (const u of [g1, g2]) {
      const r = await rows(u.id, 'CANCELLED');
      expect(r).toHaveLength(1);
      expect(r[0].body).toBe('تعذر الاستلام');
      expect(r[0].title).toBe(`أُلغي طلب الاستلام ${req.number}`);
    }
    expect(await rows(other.id)).toHaveLength(0);
  });

  it('stale auto-close sends nothing', async () => {
    const { g1, g2 } = await setup();
    await closeStaleRequests(new Date(T.getTime() + 24 * 3600_000));
    expect(await prisma.notification.count({ where: { userId: { in: [g1.id, g2.id] } } })).toBe(0);
  });

  it('revocation: other guardian gets exactly one notice, revoked requester none', async () => {
    const { s, a, b, req, g1, g2, other } = await setup();
    // g1 (requester) loses the link to both students at once; g2 stays linked.
    await updateStudent(s.admin, { id: a.id, phones: [P2] });
    await updateStudent(s.admin, { id: b.id, phones: [P2] });
    expect(await rows(g1.id)).toHaveLength(0);
    const r = await rows(g2.id, 'CANCELLED');
    expect(r).toHaveLength(2); // one per revoking action, each naming only that action's items
    expect(r.every((x) => x.title === `أُلغي طلب الاستلام ${req.number}`)).toBe(true);
    expect(await rows(other.id)).toHaveLength(0);
  });

  it('revocation: a requester who is still linked is notified', async () => {
    const { s, a, req, g1, g2 } = await setup();
    await setStudentActive(s.admin, { id: a.id, active: false });
    const r = await rows(g1.id, 'CANCELLED');
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe(`أُلغي طلب الاستلام ${req.number}`);
    expect(await rows(g2.id, 'CANCELLED')).toHaveLength(1);
  });

  it('import: two sibling rows of one request both lose the requester; each remaining guardian gets exactly one notice', async () => {
    const { s, req, g1, g2, other } = await setup();
    await applyImport(s.admin, s.school.id, ['أحمد علي', 'بدر سعد'].map((n, i) => ({
      branch: s.branch.name, externalId: `${i}`, fullName: n, classroom: '1/أ', gate: 'بوابة 1', phones: [P2],
    })));
    expect(await rows(g1.id)).toHaveLength(0);
    const r = await rows(g2.id, 'CANCELLED');
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe(`أُلغي طلب الاستلام ${req.number}`);
    expect(await rows(other.id)).toHaveLength(0);
  });
});
