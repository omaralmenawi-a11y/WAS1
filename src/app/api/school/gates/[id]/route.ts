import { mutation } from '@/lib/school/route';
import { deleteGate, updateGate } from '@/lib/school/setup';

export const PATCH = mutation((a, b, id) => updateGate(a, { id: id!, name: b.name }));
export const DELETE = mutation((a, _b, id) => deleteGate(a, { id: id! }));
