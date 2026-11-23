import { mutation } from '@/lib/school/route';
import { createBranch } from '@/lib/school/setup';

export const POST = mutation((a, b) => createBranch(a, { schoolId: b.schoolId, name: b.name, lat: b.lat, lng: b.lng }), 201);
