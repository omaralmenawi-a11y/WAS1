import { mutation } from '@/lib/school/route';
import { addHoliday } from '@/lib/school/setup';

export const POST = mutation((a, b) => addHoliday(a, { schoolId: b.schoolId, branchId: b.branchId || null, date: b.date, note: b.note }), 201);
