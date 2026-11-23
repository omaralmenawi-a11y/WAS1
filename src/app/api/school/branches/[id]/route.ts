import { mutation } from '@/lib/school/route';
import { updateBranch } from '@/lib/school/setup';

export const PATCH = mutation((a, b, id) => updateBranch(a, { id: id!, name: b.name, lat: b.lat, lng: b.lng }));
