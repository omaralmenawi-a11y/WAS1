import { mutation } from '@/lib/school/route';
import { createClassroom } from '@/lib/school/setup';

export const POST = mutation((a, b) => createClassroom(a, { branchId: b.branchId, name: b.name, grade: b.grade }), 201);
