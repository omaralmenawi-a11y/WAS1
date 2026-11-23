import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/db';
import { createSchoolWithAdmin } from '../../src/lib/admin/schools';
import { createPlatformAdmin } from '../../src/lib/admin/schools';
import { createSession, getSessionUser } from '../../src/lib/auth/session';
import { login } from '../../src/lib/auth/accounts';
import { Conflict, Forbidden, InvalidCredentials, NotFound, ValidationError } from '../../src/lib/errors';
import {
  addHoliday,
  addOverride,
  createBranch,
  createClassroom,
  createGate,
  deleteClassroom,
  deleteGate,
  setClassSchedule,
  updateSchoolSettings,
} from '../../src/lib/school/setup';
import { createStaff, resetStaffPassword, setUserActive } from '../../src/lib/school/staff';

async function mkSchool(tag: string) {
  return createSchoolWithAdmin({
    schoolName: `مدرسة ${tag}`,
    branchName: `فرع ${tag}`,
    adminName: `مدير ${tag}`,
    adminUsername: `admin_${tag}`,
    tempPassword: 'temp-pass-123',
  });
}

async function fixture() {
  const a = await mkSchool('a');
  const b = await mkSchool('b');
  const gate = await createGate(a.admin, { branchId: a.branch.id, name: 'البوابة 1' });
  const room = await createClassroom(a.admin, { branchId: a.branch.id, name: '1/أ', grade: 'الأول' });
  return { a, b, gate, room };
}

describe('school setup', () => {
  it('branch create generates a 24-char board token and audits', async () => {
    const { a } = await fixture();
    const br = await createBranch(a.admin, { schoolId: a.school.id, name: 'فرع ثان' });
    expect(br.boardToken).toHaveLength(24);
    expect(await prisma.auditLog.count({ where: { action: 'BRANCH_CREATED', entityId: br.id } })).toBe(1);
  });

  it('schedule rejects bad time and weekday', async () => {
    const { a, room } = await fixture();
    await expect(setClassSchedule(a.admin, { classroomId: room.id, weekday: 1, dismissal: '25:00' })).rejects.toThrow(ValidationError);
    await expect(setClassSchedule(a.admin, { classroomId: room.id, weekday: 7, dismissal: '12:30' })).rejects.toThrow(ValidationError);
  });

  it('setClassSchedule upserts on same weekday', async () => {
    const { a, room } = await fixture();
    const s1 = await setClassSchedule(a.admin, { classroomId: room.id, weekday: 1, dismissal: '12:30' });
    const s2 = await setClassSchedule(a.admin, { classroomId: room.id, weekday: 1, dismissal: '13:00' });
    expect(s2.id).toBe(s1.id);
    expect(s2.dismissal).toBe('13:00');
    expect(await prisma.classSchedule.count()).toBe(1);
  });

  it('holiday and override are created and audited', async () => {
    const { a, room } = await fixture();
    const h = await addHoliday(a.admin, { schoolId: a.school.id, date: '2026-12-01', note: 'إجازة' });
    expect(h.date.toISOString().slice(0, 10)).toBe('2026-12-01');
    const o = await addOverride(a.admin, { branchId: a.branch.id, classroomId: room.id, date: '2026-12-02', dismissal: '11:00' });
    expect(o.dismissal).toBe('11:00');
    await expect(addHoliday(a.admin, { schoolId: a.school.id, date: '2026-02-31', note: 'x' })).rejects.toThrow(ValidationError);
    expect(await prisma.auditLog.count({ where: { action: { in: ['HOLIDAY_CREATED', 'OVERRIDE_CREATED'] } } })).toBe(2);
  });

  it('settings update validates ranges', async () => {
    const { a } = await fixture();
    const s = await updateSchoolSettings(a.admin, { weekDays: [0, 1, 2, 3], pickupLeadMin: 30, pickupTailMin: 120, etaSpeedKmh: 40 });
    expect(s.weekDays).toEqual([0, 1, 2, 3]);
    await expect(updateSchoolSettings(a.admin, { weekDays: [7], pickupLeadMin: 30, pickupTailMin: 120, etaSpeedKmh: 40 })).rejects.toThrow(ValidationError);
    await expect(updateSchoolSettings(a.admin, { weekDays: [1], pickupLeadMin: 241, pickupTailMin: 120, etaSpeedKmh: 40 })).rejects.toThrow(ValidationError);
    await expect(updateSchoolSettings(a.admin, { weekDays: [1], pickupLeadMin: 30, pickupTailMin: 481, etaSpeedKmh: 40 })).rejects.toThrow(ValidationError);
    await expect(updateSchoolSettings(a.admin, { weekDays: [1], pickupLeadMin: 30, pickupTailMin: 120, etaSpeedKmh: 4 })).rejects.toThrow(ValidationError);
  });

  it('admin of another school gets NotFound on every create', async () => {
    const { a, b, gate, room } = await fixture();
    const x = b.admin;
    await expect(createBranch(x, { schoolId: a.school.id, name: 'x' })).rejects.toThrow(NotFound);
    await expect(createGate(x, { branchId: a.branch.id, name: 'x' })).rejects.toThrow(NotFound);
    await expect(createClassroom(x, { branchId: a.branch.id, name: 'x', grade: 'x' })).rejects.toThrow(NotFound);
    await expect(setClassSchedule(x, { classroomId: room.id, weekday: 1, dismissal: '12:00' })).rejects.toThrow(NotFound);
    await expect(addHoliday(x, { schoolId: a.school.id, date: '2026-12-01', note: 'x' })).rejects.toThrow(NotFound);
    await expect(addOverride(x, { branchId: a.branch.id, date: '2026-12-01', dismissal: '11:00' })).rejects.toThrow(NotFound);
    await expect(createStaff(x, { branchId: a.branch.id, name: 'x', username: 'xx', tempPassword: 'password123', gateIds: [] })).rejects.toThrow(NotFound);
    await expect(deleteGate(x, { id: gate.id })).rejects.toThrow(NotFound);
    await expect(deleteClassroom(x, { id: room.id })).rejects.toThrow(NotFound);
  });

  it('staff role cannot mutate', async () => {
    const { a } = await fixture();
    const staff = await createStaff(a.admin, { branchId: a.branch.id, name: 's', username: 'st1', tempPassword: 'password123', gateIds: [] });
    await expect(createGate(staff, { branchId: a.branch.id, name: 'x' })).rejects.toThrow(Forbidden);
  });

  it('platform admin can mutate', async () => {
    const { a } = await fixture();
    const p = await createPlatformAdmin('plat', 'password123');
    const g = await createGate(p, { branchId: a.branch.id, name: 'بوابة' });
    expect(g.branchId).toBe(a.branch.id);
  });

  it('gate/classroom delete blocked by students, allowed otherwise', async () => {
    const { a, gate, room } = await fixture();
    await setClassSchedule(a.admin, { classroomId: room.id, weekday: 1, dismissal: '12:00' });
    await prisma.student.create({
      data: { schoolId: a.school.id, branchId: a.branch.id, classroomId: room.id, defaultGateId: gate.id, fullName: 'طالب' },
    });
    await expect(deleteGate(a.admin, { id: gate.id })).rejects.toThrow(Conflict);
    await expect(deleteClassroom(a.admin, { id: room.id })).rejects.toThrow(Conflict);
    const g2 = await createGate(a.admin, { branchId: a.branch.id, name: 'ثانية' });
    await deleteGate(a.admin, { id: g2.id });
    const r2 = await createClassroom(a.admin, { branchId: a.branch.id, name: '2', grade: 'x' });
    await setClassSchedule(a.admin, { classroomId: r2.id, weekday: 2, dismissal: '12:00' });
    await deleteClassroom(a.admin, { id: r2.id });
    expect(await prisma.classroom.findUnique({ where: { id: r2.id } })).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: { in: ['GATE_DELETED', 'CLASSROOM_DELETED'] } } })).toBe(2);
  });
});

describe('staff accounts', () => {
  it('creates STAFF with branch, gates, mustChangePassword, normalized username', async () => {
    const { a, gate } = await fixture();
    const s = await createStaff(a.admin, { branchId: a.branch.id, name: 'موظف', username: '  Staff_One ', tempPassword: 'password123', gateIds: [gate.id] });
    expect(s.role).toBe('STAFF');
    expect(s.branchId).toBe(a.branch.id);
    expect(s.schoolId).toBe(a.school.id);
    expect(s.mustChangePassword).toBe(true);
    expect(s.username).toBe('staff_one');
    expect(s.gateIds).toEqual([gate.id]);
    await expect(
      createStaff(a.admin, { branchId: a.branch.id, name: 'x', username: 'STAFF_ONE', tempPassword: 'password123', gateIds: [] }),
    ).rejects.toThrow(Conflict);
  });

  it('rejects gates from another branch', async () => {
    const { a, gate } = await fixture();
    const br2 = await createBranch(a.admin, { schoolId: a.school.id, name: 'ثان' });
    await expect(
      createStaff(a.admin, { branchId: br2.id, name: 'x', username: 'yy', tempPassword: 'password123', gateIds: [gate.id] }),
    ).rejects.toThrow(ValidationError);
  });

  it('reset password and deactivate; inactive cannot log in', async () => {
    const { a } = await fixture();
    const s = await createStaff(a.admin, { branchId: a.branch.id, name: 's', username: 'st2', tempPassword: 'password123', gateIds: [] });
    await expect(login({ identifier: 'st2', password: 'password123' })).resolves.toMatchObject({ id: s.id });
    const r = await resetStaffPassword(a.admin, { userId: s.id, tempPassword: 'another-pass-1' });
    expect(r.mustChangePassword).toBe(true);
    await expect(login({ identifier: 'st2', password: 'password123' })).rejects.toThrow(InvalidCredentials);
    await expect(login({ identifier: 'st2', password: 'another-pass-1' })).resolves.toBeDefined();
    const tok = await createSession(s.id, 'STAFF');
    expect((await getSessionUser(tok))?.id).toBe(s.id);
    const off = await setUserActive(a.admin, { userId: s.id, active: false });
    expect(off.active).toBe(false);
    expect(await getSessionUser(tok)).toBeNull();
    await expect(login({ identifier: 'st2', password: 'another-pass-1' })).rejects.toThrow(InvalidCredentials);
    await setUserActive(a.admin, { userId: s.id, active: true });
    await expect(login({ identifier: 'st2', password: 'another-pass-1' })).resolves.toBeDefined();
    expect(await prisma.auditLog.count({ where: { entity: 'User', entityId: s.id } })).toBe(4);
  });

  it("other school's admin cannot touch staff", async () => {
    const { a, b } = await fixture();
    const s = await createStaff(a.admin, { branchId: a.branch.id, name: 's', username: 'st3', tempPassword: 'password123', gateIds: [] });
    await expect(setUserActive(b.admin, { userId: s.id, active: false })).rejects.toThrow(NotFound);
    await expect(resetStaffPassword(b.admin, { userId: s.id, tempPassword: 'password123' })).rejects.toThrow(NotFound);
  });
});
