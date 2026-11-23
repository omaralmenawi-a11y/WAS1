import { ValidationError } from '@/lib/errors';
import { mutation } from '@/lib/school/route';
import { resetStaffPassword, setUserActive } from '@/lib/school/staff';

export const PATCH = mutation(async (a, b, id) => {
  if (typeof b.active === 'boolean') await setUserActive(a, { userId: id!, active: b.active });
  else if (b.tempPassword !== undefined) await resetStaffPassword(a, { userId: id!, tempPassword: b.tempPassword });
  else throw new ValidationError();
  return { ok: true };
});
