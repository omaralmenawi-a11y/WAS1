import { requireUser } from '@/lib/authz';
import { handle } from '@/lib/http';
import { mutation } from '@/lib/school/route';
import { createStudent, listStudents } from '@/lib/school/students';

export const GET = (req: Request) =>
  handle(async () => {
    const actor = await requireUser(req);
    const q = new URL(req.url).searchParams;
    const rows = await listStudents(actor, {
      search: q.get('search') ?? undefined,
      branchId: q.get('branchId') ?? undefined,
      classroomId: q.get('classroomId') ?? undefined,
    });
    return Response.json(rows);
  });

export const POST = mutation(
  (a, b) =>
    createStudent(a, {
      branchId: b.branchId,
      classroomId: b.classroomId,
      gateId: b.gateId,
      fullName: b.fullName,
      externalId: b.externalId,
      phones: b.phones,
    }),
  201,
);
