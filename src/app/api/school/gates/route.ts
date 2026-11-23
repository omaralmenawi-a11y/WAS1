import { mutation } from '@/lib/school/route';
import { createGate } from '@/lib/school/setup';

export const POST = mutation((a, b) => createGate(a, { branchId: b.branchId, name: b.name }), 201);
