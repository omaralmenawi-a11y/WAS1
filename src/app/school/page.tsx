import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/guard';
import { DashboardClient } from './dashboard-client';

export const dynamic = 'force-dynamic';

export default async function SchoolHome() {
  const user = await requirePageUser(['SCHOOL_ADMIN']);
  const branches = await prisma.branch.findMany({ where: { schoolId: user.schoolId! }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <h1 className="font-heading text-2xl font-bold text-navy">لوحة المدرسة</h1>
      {branches.length === 0 ? (
        <p className="rounded-xl bg-white p-5 text-navy/70 ring-1 ring-navy/10">لا توجد فروع بعد. ابدأ من صفحة الإعداد.</p>
      ) : (
        <DashboardClient branches={branches} />
      )}
    </main>
  );
}
