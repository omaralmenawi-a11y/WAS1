import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/db';

describe('database smoke', () => {
  it('creates and reads back a School with defaults', async () => {
    const created = await prisma.school.create({ data: { name: 'مدرسة الأمل' } });
    const found = await prisma.school.findUniqueOrThrow({ where: { id: created.id } });
    expect(found.name).toBe('مدرسة الأمل');
    expect(found.weekDays).toEqual([0, 1, 2, 3, 4]);
    expect(found.pickupLeadMin).toBe(60);
    expect(found.pickupTailMin).toBe(180);
    expect(found.etaSpeedKmh).toBe(30);
  });

  it('resetDb empties tables between tests', async () => {
    expect(await prisma.school.count()).toBe(0);
  });
});

describe('active pickup item uniqueness', () => {
  it('rejects a second active item for the same student but allows after delivery', async () => {
    const school = await prisma.school.create({ data: { name: 'S' } });
    const branch = await prisma.branch.create({ data: { schoolId: school.id, name: 'B', boardToken: 't' } });
    const gate = await prisma.gate.create({ data: { branchId: branch.id, name: 'G' } });
    const cls = await prisma.classroom.create({ data: { branchId: branch.id, name: 'C', grade: '1' } });
    const student = await prisma.student.create({
      data: { schoolId: school.id, branchId: branch.id, classroomId: cls.id, defaultGateId: gate.id, fullName: 'x' },
    });
    const user = await prisma.user.create({ data: { role: 'GUARDIAN', name: 'g', passwordHash: 'h' } });
    const mk = (number: number) =>
      prisma.pickupRequest.create({
        data: { schoolId: school.id, branchId: branch.id, gateId: gate.id, number, day: new Date('2026-01-01'), requesterId: user.id },
      });
    const r1 = await mk(1);
    const r2 = await mk(2);
    const first = await prisma.pickupItem.create({ data: { requestId: r1.id, studentId: student.id, status: 'EN_ROUTE' } });
    await expect(
      prisma.pickupItem.create({ data: { requestId: r2.id, studentId: student.id, status: 'EN_ROUTE' } }),
    ).rejects.toThrow();
    await prisma.pickupItem.update({ where: { id: first.id }, data: { status: 'DELIVERED' } });
    await expect(
      prisma.pickupItem.create({ data: { requestId: r2.id, studentId: student.id, status: 'EN_ROUTE' } }),
    ).resolves.toBeTruthy();
  });
});
