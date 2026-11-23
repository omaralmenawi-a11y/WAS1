import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/db';
import { createSchoolWithAdmin } from '../../src/lib/admin/schools';
import { createClassroom, createGate, setClassSchedule } from '../../src/lib/school/setup';
import { applyImport } from '../../src/lib/school/import';
import { advanceItem, cancelRequest, changeGate, createRequest, deliverItems, verifyRecipient } from '../../src/lib/pickup/service';
import { pickupCode, qrPayload } from '../../src/lib/pickup/code';
import { Conflict, NotFound, RateLimitError, ValidationError } from '../../src/lib/errors';
import type { User } from '@prisma/client';

process.env.PICKUP_CODE_SECRET ||= 'test-secret';
import { resetDb as resetDbLocal } from './setup';

// Mon 2026-11-23 12:30 Riyadh (dismissal 12:30)
const T = new Date('2026-11-23T09:30:00Z');
const plus = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);
const P1 = '+966501234567';

async function mkSchool(tag: string) {
  const s = await createSchoolWithAdmin({
    schoolName: `مدرسة ${tag}`, branchName: `فرع ${tag}`, adminName: `مدير ${tag}`, adminUsername: `admin_${tag}`, tempPassword: 'temp-pass-123',
  });
  const gate = await createGate(s.admin, { branchId: s.branch.id, name: 'بوابة 1' });
  const gate2 = await createGate(s.admin, { branchId: s.branch.id, name: 'بوابة 2' });
  const room = await createClassroom(s.admin, { branchId: s.branch.id, name: '1/أ', grade: '1' });
  for (const w of [0, 1, 2, 3, 4]) await setClassSchedule(s.admin, { classroomId: room.id, weekday: w, dismissal: '12:30' });
  return { ...s, gate, gate2, room };
}
async function students(s: Awaited<ReturnType<typeof mkSchool>>, names: string[], phone = P1) {
  await applyImport(s.admin, s.school.id, names.map((n, i) => ({
    branch: s.branch.name, externalId: `${n}${i}`, fullName: n, classroom: '1/أ', gate: 'بوابة 1', phones: [phone],
  })));
  return prisma.student.findMany({ where: { schoolId: s.school.id }, orderBy: { fullName: 'asc' } });
}
const guardian = (phone: string, name = 'ولي') => prisma.user.create({ data: { role: 'GUARDIAN', name, phone, passwordHash: 'x', photoKey: 'photo-1' } });
const staffOf = (branchId: string, schoolId: string, gateIds: string[] = []) =>
  prisma.user.create({ data: { role: 'STAFF', name: 'موظف', passwordHash: 'x', branchId, schoolId, gateIds, username: `st_${Math.random()}` } });

async function setup() {
  const s = await mkSchool('a');
  const [a, b] = await students(s, ['أحمد', 'بدر']);
  const g = await guardian(P1);
  const staff = await staffOf(s.branch.id, s.school.id);
  return { s, a, b, g, staff };
}

describe('createRequest', () => {
  it('two siblings -> one request, two items, number 1; then 2; next day 1', async () => {
    const { a, b, g, s } = await setup();
    const r1 = await createRequest(g, [a.id, b.id], T);
    expect(r1.number).toBe(1);
    expect(r1.items).toHaveLength(2);
    expect(r1.items.every((i) => i.status === 'EN_ROUTE')).toBe(true);
    expect(r1.gateId).toBe(s.gate.id);
    expect(await prisma.auditLog.count({ where: { action: 'PICKUP_CREATED' } })).toBe(1);

    await cancelRequest(g, r1.id);
    const r2 = await createRequest(g, [a.id], plus(T, 1));
    expect(r2.number).toBe(2);

    const tomorrow = new Date(T.getTime() + 24 * 3600_000);
    const r3 = await createRequest(g, [b.id], tomorrow);
    expect(r3.number).toBe(1);
  });

  it('siblings in different branches -> ValidationError', async () => {
    const s = await mkSchool('a');
    const [a] = await students(s, ['أحمد']);
    const br2 = await prisma.branch.create({ data: { schoolId: s.school.id, name: 'فرع 2', boardToken: 'tok-2' } });
    const gate = await prisma.gate.create({ data: { branchId: br2.id, name: 'ب' } });
    const room = await prisma.classroom.create({ data: { branchId: br2.id, name: '2', grade: '2' } });
    const b = await prisma.student.create({
      data: { schoolId: s.school.id, branchId: br2.id, classroomId: room.id, defaultGateId: gate.id, fullName: 'ب', phones: { create: { phone: P1 } } },
    });
    const g = await guardian(P1);
    await expect(createRequest(g, [a.id, b.id], T)).rejects.toThrow(ValidationError);
  });

  it('second guardian on same child -> Conflict naming first requester', async () => {
    const { a, g } = await setup();
    const g2 = await guardian('+966507654321', 'ثاني');
    await prisma.guardianPhone.create({ data: { studentId: a.id, phone: '+966507654321' } });
    await createRequest(g, [a.id], T);
    const e = await createRequest(g2, [a.id], T).catch((x) => x);
    expect(e).toBeInstanceOf(Conflict);
    expect(e.messageAr).toContain('أحمد');
    expect(e.messageAr).toContain('ولي');
  });

  it('outside window -> ValidationError with reason; invisible student -> NotFound', async () => {
    const { a, g } = await setup();
    const e = await createRequest(g, [a.id], plus(T, -600)).catch((x) => x);
    expect(e).toBeInstanceOf(ValidationError);
    expect(e.messageAr).toContain('يبدأ طلب الاستلام');
    const other = await guardian('+966500000009');
    await expect(createRequest(other, [a.id], T)).rejects.toThrow(NotFound);
  });
});

describe('lifecycle', () => {
  it('staff of other branch -> NotFound', async () => {
    const { a, g } = await setup();
    const s2 = await mkSchool('b');
    const outsider = await staffOf(s2.branch.id, s2.school.id);
    const r = await createRequest(g, [a.id], T);
    await expect(advanceItem(outsider, r.items[0].id, 'PREPARE', T)).rejects.toThrow(NotFound);
  });

  it('deliver before verify -> Conflict; wrong code -> ValidationError', async () => {
    const { a, g, staff } = await setup();
    const r = await createRequest(g, [a.id], T);
    await advanceItem(staff, r.items[0].id, 'PREPARE', T);
    await advanceItem(staff, r.items[0].id, 'READY', T);
    await expect(deliverItems(staff, r.id, [r.items[0].id], T)).rejects.toThrow(Conflict);
    const wrong = pickupCode(r.id, T) === '000000' ? '000001' : '000000';
    await expect(verifyRecipient(staff, { requestId: r.id, code: wrong }, T)).rejects.toThrow(ValidationError);
    await expect(verifyRecipient(staff, { code: wrong }, T)).rejects.toThrow(ValidationError);
  });

  it('full flow closes request and nulls location', async () => {
    const { a, g, staff } = await setup();
    const r = await createRequest(g, [a.id], T);
    await prisma.pickupRequest.update({ where: { id: r.id }, data: { lat: 1, lng: 2, locationAt: T, etaSeconds: 60 } });
    const it0 = r.items[0].id;
    await expect(advanceItem(staff, it0, 'READY', T)).rejects.toThrow(Conflict);
    expect((await advanceItem(staff, it0, 'PREPARE', T)).status).toBe('PREPARING');
    expect((await advanceItem(staff, it0, 'READY', T)).status).toBe('READY');
    const v = await verifyRecipient(staff, { code: pickupCode(r.id, T) }, T);
    expect(v).toMatchObject({ requestId: r.id, recipient: { name: 'ولي', role: 'GUARDIAN', photoKey: 'photo-1' } });
    expect(v.items).toEqual([{ itemId: it0, studentName: 'أحمد', status: 'READY' }]);
    await deliverItems(staff, r.id, [it0], plus(T, 1));
    const after = await prisma.pickupRequest.findUniqueOrThrow({ where: { id: r.id }, include: { items: true } });
    expect(after).toMatchObject({ open: false, lat: null, lng: null, locationAt: null, etaSeconds: null, verifyMethod: 'CODE', verifiedById: staff.id });
    expect(after.closedAt).toEqual(plus(T, 1));
    expect(after.items[0]).toMatchObject({ status: 'DELIVERED', deliveredById: staff.id });
    const actions = (await prisma.auditLog.findMany()).map((x) => x.action);
    for (const act of ['PICKUP_CREATED', 'ITEM_PREPARING', 'ITEM_READY', 'RECIPIENT_VERIFIED', 'ITEM_DELIVERED']) expect(actions).toContain(act);
  });

  it('verify by QR; stale verification (>10 min) blocks delivery', async () => {
    const { a, g, staff } = await setup();
    const r = await createRequest(g, [a.id], T);
    await advanceItem(staff, r.items[0].id, 'PREPARE', T);
    await advanceItem(staff, r.items[0].id, 'READY', T);
    await verifyRecipient(staff, { qr: qrPayload(r.id, T) }, T);
    expect((await prisma.pickupRequest.findUniqueOrThrow({ where: { id: r.id } })).verifyMethod).toBe('QR');
    await expect(deliverItems(staff, r.id, [r.items[0].id], plus(T, 11))).rejects.toThrow(Conflict);
    await deliverItems(staff, r.id, [r.items[0].id], plus(T, 9));
  });

  it('multi-item: request stays open until the last active item is done', async () => {
    const { a, b, g, staff } = await setup();
    const r = await createRequest(g, [a.id, b.id], T);
    const [i1, i2] = r.items.map((i) => i.id);
    for (const id of [i1, i2]) { await advanceItem(staff, id, 'PREPARE', T); await advanceItem(staff, id, 'READY', T); }
    await verifyRecipient(staff, { requestId: r.id, code: pickupCode(r.id, T) }, T);
    await prisma.pickupRequest.update({ where: { id: r.id }, data: { lat: 1, lng: 2, locationAt: T, etaSeconds: 5 } });
    await deliverItems(staff, r.id, [i1], T);
    let req = await prisma.pickupRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(req.open).toBe(true);
    expect(req.lat).toBe(1);
    await expect(deliverItems(staff, r.id, [i1], T)).rejects.toThrow(Conflict); // already delivered
    await cancelRequest(staff, r.id, 'سبب', T);
    req = await prisma.pickupRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(req.open).toBe(false);
    expect(req.lat).toBeNull();
    const items = await prisma.pickupItem.findMany({ where: { requestId: r.id }, orderBy: { id: 'asc' } });
    expect(items.map((i) => i.status).sort()).toEqual(['CANCELLED', 'DELIVERED']);
    expect(items.find((i) => i.status === 'CANCELLED')!.cancelReason).toBe('سبب');
  });

  it('deliver rejects items not READY or not in the request', async () => {
    const { a, b, g, staff } = await setup();
    const r = await createRequest(g, [a.id, b.id], T);
    await advanceItem(staff, r.items[0].id, 'PREPARE', T);
    await advanceItem(staff, r.items[0].id, 'READY', T);
    await verifyRecipient(staff, { requestId: r.id, code: pickupCode(r.id, T) }, T);
    await expect(deliverItems(staff, r.id, [r.items[0].id, r.items[1].id], T)).rejects.toThrow(Conflict);
    await expect(deliverItems(staff, r.id, ['nope'], T)).rejects.toThrow(Conflict);
    await expect(deliverItems(staff, r.id, [], T)).rejects.toThrow(ValidationError);
  });

  it('guardian cancel clears location and cancels all; staff cancel needs reason', async () => {
    const { a, b, g, staff } = await setup();
    const r = await createRequest(g, [a.id, b.id], T);
    await prisma.pickupRequest.update({ where: { id: r.id }, data: { lat: 1, lng: 2, locationAt: T, etaSeconds: 5 } });
    await expect(cancelRequest(staff, r.id)).rejects.toThrow(ValidationError);
    await expect(cancelRequest(staff, r.id, '  ')).rejects.toThrow(ValidationError);
    const other = await guardian('+966500000009');
    await expect(cancelRequest(other, r.id, undefined, T)).rejects.toThrow(NotFound);
    await cancelRequest(g, r.id, undefined, T);
    const req = await prisma.pickupRequest.findUniqueOrThrow({ where: { id: r.id }, include: { items: true } });
    expect(req).toMatchObject({ open: false, lat: null, lng: null, locationAt: null, etaSeconds: null });
    expect(req.items.every((i) => i.status === 'CANCELLED')).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'PICKUP_CANCELLED' } })).toBe(1);
    // student can request again
    await expect(createRequest(g, [a.id], plus(T, 1))).resolves.toBeTruthy();
  });

  it('changeGate moves request within branch, audited', async () => {
    const { a, g, staff, s } = await setup();
    const r = await createRequest(g, [a.id], T);
    await changeGate(staff, r.id, s.gate2.id, T);
    expect((await prisma.pickupRequest.findUniqueOrThrow({ where: { id: r.id } })).gateId).toBe(s.gate2.id);
    expect(await prisma.auditLog.count({ where: { action: 'GATE_CHANGED' } })).toBe(1);
    const s2 = await mkSchool('b');
    await expect(changeGate(staff, r.id, s2.gate.id, T)).rejects.toThrow(NotFound);
  });
});

describe('concurrency and stale requests', () => {
  async function ready(n: number) {
    const ctx = await setup();
    const r = await createRequest(ctx.g, [ctx.a.id, ctx.b.id], T);
    for (const i of r.items) { await advanceItem(ctx.staff, i.id, 'PREPARE', T); await advanceItem(ctx.staff, i.id, 'READY', T); }
    await verifyRecipient(ctx.staff, { requestId: r.id, code: pickupCode(r.id, T) }, T);
    await prisma.pickupRequest.update({ where: { id: r.id }, data: { lat: 1, lng: 2, locationAt: T, etaSeconds: 5 } });
    return { ...ctx, r, n };
  }
  const expectClosed = async (id: string) =>
    expect(await prisma.pickupRequest.findUniqueOrThrow({ where: { id } })).toMatchObject({ open: false, lat: null, lng: null, locationAt: null, etaSeconds: null });

  it('concurrent delivery of both siblings closes the request', async () => {
    for (let k = 0; k < 5; k++) {
      await resetDbLocal();
      const { r, staff } = await ready(2);
      await Promise.all(r.items.map((i) => deliverItems(staff, r.id, [i.id], T)));
      await expectClosed(r.id);
    }
  });

  it('concurrent deliver + cancel closes the request', async () => {
    for (let k = 0; k < 5; k++) {
      await resetDbLocal();
      const { r, staff } = await ready(2);
      // cancel is per request in this API, so cancel via item update racing a deliver of the other
      await Promise.all([
        deliverItems(staff, r.id, [r.items[0].id], T),
        cancelRequest(staff, r.id, 'سبب', T),
      ].map((p) => p.catch((e) => e)));
      await expectClosed(r.id);
    }
  });

  it('stale open request from yesterday is auto-closed on a new request', async () => {
    const { a, g } = await setup();
    const yesterday = new Date(T.getTime() - 24 * 3600_000);
    const old = await createRequest(g, [a.id], yesterday);
    await prisma.pickupRequest.update({ where: { id: old.id }, data: { lat: 1, lng: 2, locationAt: yesterday } });
    const fresh = await createRequest(g, [a.id], T);
    expect(fresh.number).toBe(1);
    await expectClosed(old.id);
    const item = await prisma.pickupItem.findFirstOrThrow({ where: { requestId: old.id } });
    expect(item).toMatchObject({ status: 'CANCELLED', cancelReason: 'انتهى اليوم الدراسي' });
    expect(await prisma.auditLog.count({ where: { action: 'PICKUP_AUTO_CLOSED' } })).toBe(1);
  });

  it('verify and deliver reject a request from another day', async () => {
    const { a, g, staff } = await setup();
    const yesterday = new Date(T.getTime() - 24 * 3600_000);
    const old = await createRequest(g, [a.id], yesterday);
    await expect(verifyRecipient(staff, { qr: qrPayload(old.id, T) }, T)).rejects.toThrow('هذا الطلب لم يعد صالحاً');
    await expect(verifyRecipient(staff, { requestId: old.id, code: pickupCode(old.id, T) }, T)).rejects.toThrow(ValidationError);
    await prisma.pickupRequest.update({ where: { id: old.id }, data: { verifiedAt: T } });
    await expect(deliverItems(staff, old.id, [old.items[0].id], T)).rejects.toThrow('هذا الطلب لم يعد صالحاً');
  });
});

describe('verify rate limit and ambiguity', () => {
  it('blocks after 10 failures in 5 minutes', async () => {
    const { a, g, staff } = await setup();
    const r = await createRequest(g, [a.id], T);
    const ok = pickupCode(r.id, T);
    const wrong = ok === '111111' ? '222222' : '111111';
    for (let i = 0; i < 10; i++) await expect(verifyRecipient(staff, { code: wrong }, T)).rejects.toThrow(ValidationError);
    await expect(verifyRecipient(staff, { code: ok }, T)).rejects.toThrow(RateLimitError);
    // window passes -> allowed again
    const later = plus(T, 6);
    await expect(verifyRecipient(staff, { code: pickupCode(r.id, later) }, later)).resolves.toMatchObject({ requestId: r.id });
  });
});
