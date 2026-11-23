import { mutation } from '@/lib/school/route';
import { deleteHoliday } from '@/lib/school/setup';

export const DELETE = mutation((a, _b, id) => deleteHoliday(a, { id: id! }));
