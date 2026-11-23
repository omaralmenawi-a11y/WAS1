import { requireRole, requireUser } from '@/lib/authz';
import { createSchoolWithAdmin } from '@/lib/admin/schools';
import { handle, readJson } from '@/lib/http';

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser(req);
    requireRole(user, 'PLATFORM_ADMIN');
    const b = await readJson(req);
    const r = await createSchoolWithAdmin({
      schoolName: String(b.schoolName ?? ''),
      branchName: String(b.branchName ?? ''),
      adminName: String(b.adminName ?? ''),
      adminUsername: String(b.adminUsername ?? ''),
      tempPassword: String(b.tempPassword ?? ''),
      actorId: user.id,
    });
    return Response.json({ schoolId: r.school.id, branchId: r.branch.id, adminId: r.admin.id }, { status: 201 });
  });
}
