import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/guard';
import { StaffClient } from './staff-client';

export const dynamic = 'force-dynamic';

export default async function StaffPage() {
  const user = await requirePageUser(['SCHOOL_ADMIN']);
  const schoolId = user.schoolId!;
  const [branches, staff] = await Promise.all([
    prisma.branch.findMany({ where: { schoolId }, orderBy: { name: 'asc' }, include: { gates: { orderBy: { name: 'asc' } } } }),
    prisma.user.findMany({ where: { schoolId, role: 'STAFF' }, orderBy: { createdAt: 'desc' } }),
  ]);
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <h1 className="font-heading text-2xl font-bold text-navy">حسابات الموظفين</h1>
      <StaffClient
        branches={branches.map((b) => ({ id: b.id, name: b.name, gates: b.gates.map((g) => ({ id: g.id, name: g.name })) }))}
        staff={staff.map((s) => ({ id: s.id, name: s.name, username: s.username ?? '', branchId: s.branchId, gateIds: s.gateIds, active: s.active }))}
      />
    </main>
  );
}
