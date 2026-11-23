import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/db';
import { createSchoolWithAdmin } from '../../src/lib/admin/schools';
import { createClassroom, createGate, setClassSchedule } from '../../src/lib/school/setup';
import { applyImport } from '../../src/lib/school/import';
import { setPushSender } from '../../src/lib/notify/push';
import { runDismissalNotifications } from '../../src/lib/notify/dismissal';

const P1 = '+966501234567';
const P2 = '+966507654321';
// Sunday 2026-11-22, Riyadh = UTC+3, dismissal 12:15
const at = (hhmm: string, date = '2026-11-22') => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(`${date}T${String(h - 3).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
};
const guardian = (phone: string, name = 'ولي', extra: object = {}) =>
  prisma.user.create({ data: { role: 'GUARDIAN', name, phone, passwordHash: 'x', photoKey: 'p', ...extra } });
const rows = (userId: string, kind?: string) => prisma.notification.findMany({ where: { userId, ...(kind ? { kind } : {}) } });

async function setup(names = ['سارة محمد'], phones = [P1], weekdays = [0, 1, 2, 3, 4], gates = ['بوابة 1']) {
  const s = await createSchoolWithAdmin({ schoolName: 'م', branchName: 'ف', adminName: 'م', adminUsername: `a_${Math.random()}`, tempPassword: 'temp-pass-123' });
  for (const g of gates) await createGate(s.admin, { branchId: s.branch.id, name: g });
  const room = await createClassroom(s.admin, { branchId: s.branch.id, name: '1/أ', grade: '1' });
  for (const w of weekdays) await setClassSchedule(s.admin, { classroomId: room.id, weekday: w, dismissal: '12:15' });
  await applyImport(s.admin, s.school.id, names.map((n, i) => ({
    branch: s.branch.name, externalId: `${i}`, fullName: n, classroom: '1/أ', gate: gates[i % gates.length], phones,
  })));
  const students = await prisma.student.findMany({ where: { schoolId: s.school.id }, orderBy: { externalId: 'asc' } });
  return { s, room, students };
}

async function addItem(studentId: string, schoolId: string, branchId: string, status: 'EN_ROUTE' | 'DELIVERED', day = '2026-11-22') {
  const gate = await prisma.gate.findFirstOrThrow({ where: { branchId } });
  const u = await prisma.user.findFirstOrThrow({ where: { role: 'GUARDIAN' } });
  const req = await prisma.pickupRequest.create({
    data: { schoolId, branchId, gateId: gate.id, number: Math.floor(Math.random() * 1e6), day: new Date(`${day}T00:00:00Z`), requesterId: u.id },
  });
  await prisma.pickupItem.create({ data: { requestId: req.id, studentId, status } });
}

beforeEach(() => setPushSender(null));

describe('runDismissalNotifications', () => {
  it('reminds at D-15, not before, and only once', async () => {
    await setup();
    const g = await guardian(P1);
    expect(await runDismissalNotifications(at('11:59'))).toEqual({ reminders: 0, endOfDay: 0 });
    expect(await rows(g.id)).toHaveLength(0);
    expect(await runDismissalNotifications(at('12:00'))).toEqual({ reminders: 1, endOfDay: 0 });
    const r = await rows(g.id, 'REMINDER');
    expect(r).toHaveLength(1);
    expect(r[0].body).toBe('انصراف سارة الساعة 12:15، بعد 15 دقيقة.');
    expect(r[0].url).toBe('/parent');
    await runDismissalNotifications(at('12:01'));
    expect(await rows(g.id)).toHaveLength(1);
  });

  it('combines siblings with the same dismissal into one reminder', async () => {
    await setup(['سارة محمد', 'عمر محمد'], [P1]);
    const g = await guardian(P1);
    await runDismissalNotifications(at('12:00'));
    const r = await rows(g.id, 'REMINDER');
    expect(r).toHaveLength(1);
    expect(r[0].body).toContain('سارة');
    expect(r[0].body).toContain('عمر');
  });

  it('sends to each guardian of a student', async () => {
    await setup(['سارة محمد'], [P1, P2]);
    const g1 = await guardian(P1);
    const g2 = await guardian(P2);
    await runDismissalNotifications(at('12:00'));
    expect(await rows(g1.id, 'REMINDER')).toHaveLength(1);
    expect(await rows(g2.id, 'REMINDER')).toHaveLength(1);
  });

  it('catches up a missed reminder at 12:10 but not at 12:20 (end-of-day instead)', async () => {
    await setup();
    const g = await guardian(P1);
    expect(await runDismissalNotifications(at('12:10'))).toEqual({ reminders: 1, endOfDay: 0 });
    await prisma.notification.deleteMany({});
    expect(await runDismissalNotifications(at('12:20'))).toEqual({ reminders: 0, endOfDay: 1 });
    expect(await rows(g.id, 'REMINDER')).toHaveLength(0);
    expect(await rows(g.id, 'END_OF_DAY')).toHaveLength(1);
  });

  it('sends end-of-day at D and stops after 30 minutes', async () => {
    await setup();
    const g = await guardian(P1);
    await runDismissalNotifications(at('12:15'));
    const r = await rows(g.id, 'END_OF_DAY');
    expect(r).toHaveLength(1);
    expect(r[0].body).toBe('انتهى دوام سارة. بوابة 1.');
    await prisma.notification.deleteMany({});
    expect(await runDismissalNotifications(at('12:45'))).toEqual({ reminders: 0, endOfDay: 0 });
  });

  it('lists distinct gates for siblings in the end-of-day notice', async () => {
    await setup(['سارة محمد', 'عمر محمد'], [P1], [0, 1, 2, 3, 4], ['بوابة 1', 'بوابة 2']);
    const g = await guardian(P1);
    await runDismissalNotifications(at('12:15'));
    const r = await rows(g.id, 'END_OF_DAY');
    expect(r).toHaveLength(1);
    expect(r[0].body).toContain('بوابة 1، بوابة 2');
  });

  it('skips reminder for active item; skips both for delivered', async () => {
    const { s, students } = await setup(['سارة محمد', 'عمر محمد'], [P1]);
    const g = await guardian(P1);
    await addItem(students[0].id, s.school.id, s.branch.id, 'EN_ROUTE');
    await runDismissalNotifications(at('12:00'));
    let r = await rows(g.id, 'REMINDER');
    expect(r).toHaveLength(1);
    expect(r[0].body).not.toContain('سارة');
    expect(r[0].body).toContain('عمر');
    await prisma.notification.deleteMany({});
    await prisma.pickupItem.deleteMany({});
    await addItem(students[0].id, s.school.id, s.branch.id, 'DELIVERED');
    await addItem(students[1].id, s.school.id, s.branch.id, 'DELIVERED');
    await runDismissalNotifications(at('12:00'));
    await runDismissalNotifications(at('12:16'));
    expect(await rows(g.id)).toHaveLength(0);
  });

  it('ignores items from other days', async () => {
    const { s, students } = await setup();
    const g = await guardian(P1);
    await addItem(students[0].id, s.school.id, s.branch.id, 'DELIVERED', '2026-11-21');
    await runDismissalNotifications(at('12:00'));
    expect(await rows(g.id, 'REMINDER')).toHaveLength(1);
  });

  it('sends nothing on Friday or a holiday', async () => {
    const { s } = await setup();
    const g = await guardian(P1);
    expect(await runDismissalNotifications(at('12:00', '2026-11-27'))).toEqual({ reminders: 0, endOfDay: 0 });
    await prisma.holiday.create({ data: { schoolId: s.school.id, date: new Date('2026-11-22T00:00:00Z'), note: 'x' } });
    expect(await runDismissalNotifications(at('12:00'))).toEqual({ reminders: 0, endOfDay: 0 });
    expect(await rows(g.id)).toHaveLength(0);
  });

  it('ignores inactive students, unregistered and inactive guardians', async () => {
    const { students } = await setup();
    await prisma.student.update({ where: { id: students[0].id }, data: { active: false } });
    const g = await guardian(P1);
    await runDismissalNotifications(at('12:00'));
    expect(await rows(g.id)).toHaveLength(0);
    await prisma.student.update({ where: { id: students[0].id }, data: { active: true } });
    await prisma.user.update({ where: { id: g.id }, data: { active: false } });
    await runDismissalNotifications(at('12:00'));
    expect(await prisma.notification.count()).toBe(0); // no registered guardian at all for P2 either
  });
});
