import { mutation } from '@/lib/school/route';
import { createBranch } from '@/lib/school/setup';

export const POST = mutation((a, b) => createBranch(a, { schoolId: b.schoolId, name: b.name }), 201);
