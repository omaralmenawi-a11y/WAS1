import { prisma } from '../db';

// Must not import next/*: reachable from server.ts via pickup/service.

/** Per student, the active GUARDIAN users whose phone matches one of that student's GuardianPhones. */
export async function guardiansByStudent(studentIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (studentIds.length === 0) return out;
  const links = await prisma.guardianPhone.findMany({ where: { studentId: { in: studentIds } }, select: { studentId: true, phone: true } });
  if (links.length === 0) return out;
  const users = await prisma.user.findMany({
    where: { role: 'GUARDIAN', active: true, phone: { in: [...new Set(links.map((l) => l.phone))] } },
    select: { id: true, phone: true },
    orderBy: { id: 'asc' },
  });
  const byPhone = new Map<string, string[]>();
  for (const u of users) byPhone.set(u.phone!, [...(byPhone.get(u.phone!) ?? []), u.id]);
  for (const l of links) {
    const ids = byPhone.get(l.phone);
    if (ids) out.set(l.studentId, [...new Set([...(out.get(l.studentId) ?? []), ...ids])]);
  }
  return out;
}

/** Active GUARDIAN users whose phone matches any GuardianPhone of the given students. */
export async function linkedGuardianIds(studentIds: string[]): Promise<string[]> {
  const m = await guardiansByStudent(studentIds);
  return [...new Set([...m.values()].flat())].sort();
}
