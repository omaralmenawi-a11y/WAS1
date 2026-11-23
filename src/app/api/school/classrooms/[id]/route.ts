import { mutation } from '@/lib/school/route';
import { deleteClassroom, updateClassroom } from '@/lib/school/setup';

export const PATCH = mutation((a, b, id) => updateClassroom(a, { id: id!, name: b.name, grade: b.grade }));
export const DELETE = mutation((a, _b, id) => deleteClassroom(a, { id: id! }));
