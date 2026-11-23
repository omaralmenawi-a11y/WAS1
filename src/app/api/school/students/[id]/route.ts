import { ValidationError } from '@/lib/errors';
import { mutation } from '@/lib/school/route';
import { setStudentActive, updateStudent } from '@/lib/school/students';

export const PATCH = mutation(async (a, b, id) => {
  if (typeof b.active === 'boolean' && Object.keys(b).length === 1) return setStudentActive(a, { id: id!, active: b.active });
  if (Object.keys(b).length === 0) throw new ValidationError();
  return updateStudent(a, {
    id: id!,
    fullName: b.fullName,
    externalId: b.externalId,
    branchId: b.branchId,
    classroomId: b.classroomId,
    gateId: b.gateId,
    phones: b.phones,
  });
});
