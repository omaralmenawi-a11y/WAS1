import { mutation } from '@/lib/school/route';
import { createStaff } from '@/lib/school/staff';

export const POST = mutation(async (a, b) => {
  const u = await createStaff(a, { branchId: b.branchId, name: b.name, username: b.username, tempPassword: b.tempPassword, gateIds: b.gateIds });
  return { id: u.id };
}, 201);
