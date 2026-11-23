import { prisma } from '../db';

// Must not import next/*: reachable from server.ts via pickup/service.

/** Active GUARDIAN users whose phone matches any GuardianPhone of the given students. */
export async function linkedGuardianIds(studentIds: string[]): Promise<string[]> {
  if (studentIds.length === 0) return [];
  const phones = await prisma.guardianPhone.findMany({ where: { studentId: { in: studentIds } }, select: { phone: true }, distinct: ['phone'] });
  if (phones.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { role: 'GUARDIAN', active: true, phone: { in: phones.map((p) => p.phone) } },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return users.map((u) => u.id);
}
