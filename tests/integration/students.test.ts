import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/db';
import { createPlatformAdmin, createSchoolWithAdmin } from '../../src/lib/admin/schools';
import { createClassroom, createGate, setClassSchedule } from '../../src/lib/school/setup';
import { applyImport, type ImportRow } from '../../src/lib/school/import';
import { createStudent, listStudents, setStudentActive, updateStudent } from '../../src/lib/school/students';
import { listChildrenForUser } from '../../src/lib/guardian/children';
import { requestPhoneLinkOtp, linkPhone } from '../../src/lib/guardian/phone';
import { Conflict, Forbidden, NotFound, ValidationError } from '../../src/lib/errors';
import { riyadhDay, now } from '../../src/lib/time';

async function mkSchool(tag: string) {
  const s = await createSchoolWithAdmin({
    schoolName: `مدرسة ${tag}`, branchName: `فرع ${tag}`, adminName: `مدير ${tag}`, adminUsername: `admin_${tag}`, tempPassword: 'temp-pass-123',
  });
  const gate = await createGate(s.admin, { branchId: s.branch.id, name: 'بوابة 1' });
  const room = await createClassroom(s.admin, { branchId: s.branch.id, name: '1/أ', grade: 'الأول' });
  return { ...s, gate, room };
}
const row = (o: Partial<ImportRow> & { branch: string }): ImportRow => ({
  externalId: '1', fullName: 'طالب', classroom: '1/أ', gate: 'بوابة 1', phones: ['+966501234567'], ...o,
});
async function guardian(phone?: string, email?: string) {
  return prisma.user.create({ data: { role: 'GUARDIAN', name: 'ولي', phone, email, passwordHash: 'x' } });
}

describe('import', () => {
  it('second run updates rather than creates; one audit row per import', async () => {
    const s = await mkSchool('a');
    const rows = [row({ branch: s.branch.name, externalId: '1' }), row({ branch: s.branch.name, externalId: '2', fullName: 'ثان' })];
    expect(await applyImport(s.admin, s.school.id, rows)).toMatchObject({ created: 2, updated: 0, errors: [] });
    expect(await applyImport(s.admin, s.school.id, rows)).toMatchObject({ created: 0, updated: 2, errors: [] });
    expect(await prisma.student.count()).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: 'STUDENTS_IMPORTED' } })).toBe(2);
  });

  it('unknown branch/classroom/gate are row errors; good rows are kept; absent students untouched', async () => {
    const s = await mkSchool('a');
    await applyImport(s.admin, s.school.id, [row({ branch: s.branch.name, externalId: '9' })]);
    const res = await applyImport(s.admin, s.school.id, [
      row({ branch: 'مجهول', externalId: '1' }),
      row({ branch: s.branch.name, externalId: '2', classroom: 'مجهول' }),
      row({ branch: s.branch.name, externalId: '3', gate: 'مجهول' }),
      row({ branch: s.branch.name, externalId: '4' }),
    ]);
    expect(res.created).toBe(1);
    expect(res.errors.map((e) => e.row)).toEqual([2, 3, 4]);
    expect((await prisma.student.findFirstOrThrow({ where: { externalId: '9' } })).active).toBe(true);
  });

  it('forbids staff/guardian and other-school admins', async () => {
    const a = await mkSchool('a');
    const b = await mkSchool('b');
    await expect(applyImport(await guardian('+966500000001'), a.school.id, [])).rejects.toThrow(Forbidden);
    await expect(applyImport(b.admin, a.school.id, [])).rejects.toThrow(NotFound);
    const pa = await createPlatformAdmin('plat', 'platform-pass-1');
    await expect(applyImport(pa, a.school.id, [])).resolves.toMatchObject({ created: 0, updated: 0 });
  });
});

describe('children', () => {
  it('guardian sees children across schools; email-only sees none; removing phone removes child', async () => {
    const a = await mkSchool('a');
    const b = await mkSchool('b');
    await applyImport(a.admin, a.school.id, [row({ branch: a.branch.name, externalId: '1', phones: ['+966501234567'] })]);
    await applyImport(b.admin, b.school.id, [row({ branch: b.branch.name, externalId: '1', phones: ['+966501234567', '+966509999999'] })]);
    const g = await guardian('+966501234567');
    const kids = await listChildrenForUser(g);
    expect(kids).toHaveLength(2);
    expect(new Set(kids.map((k) => k.schoolName))).toEqual(new Set(['مدرسة a', 'مدرسة b']));
    expect(kids[0]).toMatchObject({ status: 'IN_SCHOOL', activeRequestId: null });
    expect(await listChildrenForUser(await guardian(undefined, 'e@x.com'))).toEqual([]);
    expect(await listChildrenForUser(a.admin)).toEqual([]);

    await applyImport(a.admin, a.school.id, [row({ branch: a.branch.name, externalId: '1', phones: ['+966500000000'] })]);
    expect(await listChildrenForUser(g)).toHaveLength(1);
  });

  it('inactive students are hidden; todayDismissal and status reflect pickup state', async () => {
    process.env.WASL_FAKE_NOW = '2026-11-22T09:00:00Z'; // Sunday, Riyadh
    try {
      const a = await mkSchool('a');
      await setClassSchedule(a.admin, { classroomId: a.room.id, weekday: 0, dismissal: '12:30' });
      await applyImport(a.admin, a.school.id, [row({ branch: a.branch.name })]);
      const g = await guardian('+966501234567');
      let [k] = await listChildrenForUser(g);
      expect(k.todayDismissal).toBe('12:30');
      expect(k).toMatchObject({ branchName: a.branch.name, classroom: '1/أ', gateName: 'بوابة 1' });

      const st = await prisma.student.findFirstOrThrow();
      const day = new Date(`${riyadhDay(now()).date}T00:00:00Z`);
      const req = await prisma.pickupRequest.create({
        data: { schoolId: a.school.id, branchId: a.branch.id, gateId: a.gate.id, number: 1, day, requesterId: g.id },
      });
      const item = await prisma.pickupItem.create({ data: { requestId: req.id, studentId: st.id, status: 'PREPARING' } });
      [k] = await listChildrenForUser(g);
      expect(k).toMatchObject({ status: 'PREPARING', activeRequestId: req.id });
      await prisma.pickupItem.update({ where: { id: item.id }, data: { status: 'DELIVERED' } });
      [k] = await listChildrenForUser(g);
      expect(k).toMatchObject({ status: 'DELIVERED', activeRequestId: null });
      await prisma.pickupItem.update({ where: { id: item.id }, data: { status: 'CANCELLED' } });
      [k] = await listChildrenForUser(g);
      expect(k.status).toBe('IN_SCHOOL');

      await setStudentActive(a.admin, { id: st.id, active: false });
      expect(await listChildrenForUser(g)).toEqual([]);
    } finally {
      delete process.env.WASL_FAKE_NOW;
    }
  });
});

describe('student CRUD', () => {
  it('creates with normalised phones; rejects invalid phone and cross-branch classroom', async () => {
    const a = await mkSchool('a');
    const b = await mkSchool('b');
    const s = await createStudent(a.admin, {
      branchId: a.branch.id, classroomId: a.room.id, gateId: a.gate.id, fullName: 'طالب', externalId: 'X1', phones: ['٠٥٠١٢٣٤٥٦٧'],
    });
    expect((await prisma.guardianPhone.findMany({ where: { studentId: s.id } })).map((p) => p.phone)).toEqual(['+966501234567']);
    await expect(
      createStudent(a.admin, { branchId: a.branch.id, classroomId: a.room.id, gateId: a.gate.id, fullName: 'ط', phones: ['123'] }),
    ).rejects.toThrow(ValidationError);
    await expect(
      createStudent(a.admin, { branchId: a.branch.id, classroomId: b.room.id, gateId: a.gate.id, fullName: 'ط', phones: [] }),
    ).rejects.toThrow(ValidationError);
    await expect(
      createStudent(a.admin, { branchId: a.branch.id, classroomId: a.room.id, gateId: a.gate.id, fullName: 'ط', externalId: 'X1', phones: [] }),
    ).rejects.toThrow(Conflict);
    await expect(
      createStudent(b.admin, { branchId: a.branch.id, classroomId: a.room.id, gateId: a.gate.id, fullName: 'ط', phones: [] }),
    ).rejects.toThrow(NotFound);
  });

  it('update replaces phones, blocks cross-tenant, list filters', async () => {
    const a = await mkSchool('a');
    const b = await mkSchool('b');
    const s = await createStudent(a.admin, { branchId: a.branch.id, classroomId: a.room.id, gateId: a.gate.id, fullName: 'سعد', phones: ['0501234567'] });
    await updateStudent(a.admin, { id: s.id, fullName: 'سعد ٢', phones: ['0501234568'] });
    expect((await prisma.guardianPhone.findMany({ where: { studentId: s.id } })).map((p) => p.phone)).toEqual(['+966501234568']);
    await expect(updateStudent(b.admin, { id: s.id, fullName: 'x' })).rejects.toThrow(NotFound);
    await expect(setStudentActive(b.admin, { id: s.id, active: false })).rejects.toThrow(NotFound);
    expect(await listStudents(a.admin, { search: 'سعد' })).toHaveLength(1);
    expect(await listStudents(a.admin, { search: 'غير' })).toHaveLength(0);
    expect(await listStudents(b.admin, {})).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { action: 'STUDENT_UPDATED' } })).toBe(1);
  });
});

describe('LINK_PHONE', () => {
  async function otpFor(phone: string) {
    return (await prisma.otpCode.findFirstOrThrow({ where: { identifier: phone, purpose: 'LINK_PHONE' }, orderBy: { createdAt: 'desc' } })).devVisible!;
  }
  it('email guardian links phone via OTP and then sees children', async () => {
    process.env.OTP_MODE = 'dev';
    const a = await mkSchool('a');
    await applyImport(a.admin, a.school.id, [row({ branch: a.branch.name })]);
    const g = await guardian(undefined, 'p@x.com');
    await requestPhoneLinkOtp(g, '0501234567');
    await expect(linkPhone(g, '0501234567', '000000')).rejects.toThrow(ValidationError);
    const u = await linkPhone(g, '٠٥٠١٢٣٤٥٦٧', await otpFor('+966501234567'));
    expect(u.phone).toBe('+966501234567');
    expect(await listChildrenForUser(u)).toHaveLength(1);
  });

  it('phone owned by another user raises Conflict', async () => {
    process.env.OTP_MODE = 'dev';
    await guardian('+966501234567');
    const g = await guardian(undefined, 'p@x.com');
    await expect(requestPhoneLinkOtp(g, '0501234567')).rejects.toThrow(Conflict);
    await expect(linkPhone(g, '0501234567', '123456')).rejects.toThrow(Conflict);
  });

  it('rejects non-guardians and users that already have a phone', async () => {
    const a = await mkSchool('a');
    await expect(requestPhoneLinkOtp(a.admin, '0501234567')).rejects.toThrow(Forbidden);
    const g = await guardian('+966500000009');
    await expect(requestPhoneLinkOtp(g, '0501234567')).rejects.toThrow(ValidationError);
  });
});
