import { mutation } from '@/lib/school/route';
import { regenerateBoardToken } from '@/lib/school/setup';

export const POST = mutation((a, _b, id) => regenerateBoardToken(a, id!));
