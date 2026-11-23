import { mutation } from '@/lib/school/route';
import { deleteClassSchedule, setClassSchedule } from '@/lib/school/setup';

export const POST = mutation((a, b) => setClassSchedule(a, { classroomId: b.classroomId, weekday: b.weekday, dismissal: b.dismissal }));
export const DELETE = mutation((a, b) => deleteClassSchedule(a, { classroomId: b.classroomId, weekday: b.weekday }));
