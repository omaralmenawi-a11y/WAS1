import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/guard';
import { SetupClient } from './setup-client';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  const user = await requirePageUser(['SCHOOL_ADMIN']);
  const schoolId = user.schoolId!;
  const [school, branches, holidays] = await Promise.all([
    prisma.school.findUniqueOrThrow({ where: { id: schoolId } }),
    prisma.branch.findMany({
      where: { schoolId },
      orderBy: { name: 'asc' },
      include: {
        gates: { orderBy: { name: 'asc' } },
        classrooms: { orderBy: { name: 'asc' }, include: { schedules: true } },
      },
    }),
    prisma.holiday.findMany({ where: { schoolId }, orderBy: { date: 'asc' } }),
  ]);
  const overrides = await prisma.scheduleOverride.findMany({
    where: { branchId: { in: branches.map((b) => b.id) } },
    orderBy: { date: 'asc' },
  });
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const data = {
    settings: {
      weekDays: school.weekDays,
      pickupLeadMin: school.pickupLeadMin,
      pickupTailMin: school.pickupTailMin,
      etaSpeedKmh: school.etaSpeedKmh,
    },
    branches: branches.map((b) => ({
      id: b.id,
      name: b.name,
      gates: b.gates.map((g) => ({ id: g.id, name: g.name })),
      classrooms: b.classrooms.map((c) => ({
        id: c.id,
        name: c.name,
        grade: c.grade,
        schedules: Object.fromEntries(c.schedules.map((s) => [s.weekday, s.dismissal])),
      })),
    })),
    holidays: holidays.map((h) => ({ id: h.id, date: day(h.date), note: h.note, branchId: h.branchId })),
    overrides: overrides.map((o) => ({ id: o.id, date: day(o.date), branchId: o.branchId, classroomId: o.classroomId, dismissal: o.dismissal })),
  };
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <h1 className="font-heading text-2xl font-bold text-navy">إعداد المدرسة</h1>
      <SetupClient data={data} />
    </main>
  );
}
