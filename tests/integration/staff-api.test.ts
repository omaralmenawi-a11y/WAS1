import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/db';
import { createSchoolWithAdmin } from '../../src/lib/admin/schools';
import { createClassroom, createGate, setClassSchedule } from '../../src/lib/school/setup';
import { applyImport } from '../../src/lib/school/import';
import { advanceItem, createRequest } from '../../src/lib/pickup/service';
import { listStaffRequests } from '../../src/lib/pickup/staff';
import { createSession } from '../../src/lib/auth/session';
import { NotFound } from '../../src/lib/errors';
import { PATCH as patchItem } from '../../src/app/api/staff/items/[id]/route';
import './setup';

process.env.PICKUP_CODE_SECRET ||= 'test-secret';

// Mon 2026-11-23 12:30 Riyadh
const T = new Date('2026-11-23T09:30:00Z');
const phone = (n: number) => `+96655000000${n}`;

async function mkSchool(tag: string) {
  const s = await createSchoolWithAdmin({
    schoolName: `مدرسة ${tag}`, branchName: `فرع ${tag}`, adminName: `مدير ${tag}`, adminUsername: `admin_${tag}`, tempPassword: 'temp-pass-123',
  });
  const gate1 = await createGate(s.admin, { branchId: s.branch.id, name: 'بوابة 1' });
  const gate2 = await createGate(s.admin, { branchId: s.branch.id, name: 'بوابة 2' });
  const room = await createClassroom(s.admin, { branchId: s.branch.id, name: '1/أ', grade: '1' });
  for (const w of [0, 1, 2, 3, 4]) await setClassSchedule(s.admin, { classroomId: room.id, weekday: w, dismissal: '12:30' });
  return { ...s, gate1, gate2 };
}
const guardian = (n: number) => prisma.user.create({ data: { role: 'GUARDIAN', name: `ولي ${n}`, phone: phone(n), passwordHash: 'x' } });
const staffOf = (s: { branch: { id: string }; school: { id: string } }, gateIds: string[] = []) =>
  prisma.user.create({ data: { role: 'STAFF', name: 'موظف', passwordHash: 'x', branchId: s.branch.id, schoolId: s.school.id, gateIds, username: `st_${Math.random()}` } });

async function world() {
  const s = await mkSchool('a');
  const names = ['أحمد', 'بدر', 'خالد'];
  const gates = ['بوابة 1', 'بوابة 1', 'بوابة 2'];
  await applyImport(s.admin, s.school.id, names.map((n, i) => ({
    branch: s.branch.name, externalId: `e${i}`, fullName: n, classroom: '1/أ', gate: gates[i], phones: [phone(i + 1)],
  })));
  const st = await prisma.student.findMany({ where: { schoolId: s.school.id }, orderBy: { fullName: 'asc' } });
  const by = Object.fromEntries(st.map((x) => [x.fullName, x]));
  const [g1, g2, g3] = await Promise.all([guardian(1), guardian(2), guardian(3)]);
  const r1 = await createRequest(g1, [by['أحمد'].id], T);
  const r2 = await createRequest(g2, [by['بدر'].id], T);
  const r3 = await createRequest(g3, [by['خالد'].id], T);
  return { s, r1, r2, r3, by };
}

describe('listStaffRequests', () => {
  it('filters by branch, open, today and gates', async () => {
    const { s, r1, r2, r3 } = await world();
    const staff = await staffOf(s);
    expect((await listStaffRequests(staff, {}, T)).map((r) => r.id).sort()).toEqual([r1.id, r2.id, r3.id].sort());

    const gated = await staffOf(s, [s.gate2.id]);
    expect((await listStaffRequests(gated, {}, T)).map((r) => r.id)).toEqual([r3.id]);

    // other branch / other school
    const o = await mkSchool('b');
    const other = await staffOf(o);
    expect(await listStaffRequests(other, {}, T)).toEqual([]);

    // closed and next-day requests are excluded
    await prisma.pickupRequest.update({ where: { id: r1.id }, data: { open: false } });
    expect((await listStaffRequests(staff, {}, T)).map((r) => r.id)).not.toContain(r1.id);
    const tomorrow = new Date(T.getTime() + 24 * 3600_000);
    expect(await listStaffRequests(staff, {}, tomorrow)).toEqual([]);
  });

  it('searches by student name substring and by exact number', async () => {
    const { s, r2 } = await world();
    const staff = await staffOf(s);
    expect((await listStaffRequests(staff, { q: 'بد' }, T)).map((r) => r.id)).toEqual([r2.id]);
    expect((await listStaffRequests(staff, { q: String(r2.number) }, T)).map((r) => r.id)).toEqual([r2.id]);
    expect(await listStaffRequests(staff, { q: 'لا يوجد' }, T)).toEqual([]);
  });

  it('orders READY, PREPARING, then EN_ROUTE by eta asc nulls last, then number', async () => {
    const { s, r1, r2, r3 } = await world();
    const staff = await staffOf(s);
    // r3 READY, r2 PREPARING, r1 EN_ROUTE
    const items = (id: string) => prisma.pickupItem.findFirstOrThrow({ where: { requestId: id } });
    await advanceItem(staff, (await items(r3.id)).id, 'PREPARE', T);
    await advanceItem(staff, (await items(r3.id)).id, 'READY', T);
    await advanceItem(staff, (await items(r2.id)).id, 'PREPARE', T);
    expect((await listStaffRequests(staff, {}, T)).map((r) => r.id)).toEqual([r3.id, r2.id, r1.id]);

    // three EN_ROUTE: eta 300, null, 100 -> 100, 300, null
    await prisma.pickupItem.updateMany({ data: { status: 'EN_ROUTE' } });
    await prisma.pickupRequest.update({ where: { id: r1.id }, data: { etaSeconds: 300 } });
    await prisma.pickupRequest.update({ where: { id: r2.id }, data: { etaSeconds: null } });
    await prisma.pickupRequest.update({ where: { id: r3.id }, data: { etaSeconds: 100 } });
    expect((await listStaffRequests(staff, {}, T)).map((r) => r.id)).toEqual([r3.id, r1.id, r2.id]);
  });

  it('school admin needs branchId with access; staff ignores branchId', async () => {
    const { s, r1 } = await world();
    const o = await mkSchool('b');
    const admin = await prisma.user.findUniqueOrThrow({ where: { id: s.admin.id } });
    expect((await listStaffRequests(admin, { branchId: s.branch.id }, T)).length).toBe(3);
    await expect(listStaffRequests(admin, { branchId: o.branch.id }, T)).rejects.toThrow(NotFound);
    const staff = await staffOf(s);
    expect((await listStaffRequests(staff, { branchId: o.branch.id }, T)).map((r) => r.id)).toContain(r1.id);
  });
});

describe('PATCH /api/staff/items/[id]', () => {
  it('returns 404 for an item of another branch, 200 for own', async () => {
    const { s, r1 } = await world();
    const item = await prisma.pickupItem.findFirstOrThrow({ where: { requestId: r1.id } });
    const o = await mkSchool('b');
    const outsider = await staffOf(o);
    const call = async (u: { id: string; role: any }) =>
      patchItem(
        new Request('http://x/api/staff/items/' + item.id, {
          method: 'PATCH',
          headers: { cookie: `wasl_session=${await createSession(u.id, u.role)}`, 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'PREPARE' }),
        }),
        { params: Promise.resolve({ id: item.id }) },
      );
    expect((await call(outsider)).status).toBe(404);
    expect((await prisma.pickupItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe('EN_ROUTE');
    const own = await staffOf(s);
    expect((await call(own)).status).toBe(200);
    expect((await prisma.pickupItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe('PREPARING');
  });
});
