import { mutation } from '@/lib/school/route';
import { addOverride } from '@/lib/school/setup';

export const POST = mutation(
  (a, b) => addOverride(a, { branchId: b.branchId, classroomId: b.classroomId || null, date: b.date, dismissal: b.dismissal }),
  201,
);
