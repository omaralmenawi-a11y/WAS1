import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/guard';
import { listStudents } from '@/lib/school/students';
import { StudentsClient } from './students-client';

export const dynamic = 'force-dynamic';

type Search = { search?: string; branchId?: string; classroomId?: string; page?: string };

export default async function StudentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePageUser(['SCHOOL_ADMIN']);
  const schoolId = user.schoolId!;
  const sp = await searchParams;
  const filter = { search: sp.search ?? '', branchId: sp.branchId ?? '', classroomId: sp.classroomId ?? '' };
  const [branches, list] = await Promise.all([
    prisma.branch.findMany({
      where: { schoolId },
      orderBy: { name: 'asc' },
      include: { gates: { orderBy: { name: 'asc' } }, classrooms: { orderBy: { name: 'asc' } } },
    }),
    listStudents(user, {
      schoolId,
      search: filter.search || undefined,
      branchId: filter.branchId || undefined,
      classroomId: filter.classroomId || undefined,
      page: Number(sp.page) || 1,
    }),
  ]);
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <h1 className="font-heading text-2xl font-bold text-navy">الطلاب</h1>
      <StudentsClient
        branches={branches.map((b) => ({
          id: b.id,
          name: b.name,
          gates: b.gates.map((g) => ({ id: g.id, name: g.name })),
          classrooms: b.classrooms.map((c) => ({ id: c.id, name: c.name })),
        }))}
        filter={filter}
        paging={{ page: list.page, pageSize: list.pageSize, total: list.total }}
        students={list.rows.map((s) => ({
          id: s.id,
          externalId: s.externalId ?? '',
          fullName: s.fullName,
          branchId: s.branchId,
          branchName: s.branch.name,
          classroomId: s.classroomId,
          classroomName: s.classroom.name,
          gateId: s.defaultGateId,
          phones: s.phones.map((p) => p.phone),
          active: s.active,
        }))}
      />
    </main>
  );
}
