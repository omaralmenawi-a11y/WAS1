import { mutation } from '@/lib/school/route';
import { deleteOverride } from '@/lib/school/setup';

export const DELETE = mutation((a, _b, id) => deleteOverride(a, { id: id! }));
