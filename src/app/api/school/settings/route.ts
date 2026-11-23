import { mutation } from '@/lib/school/route';
import { updateSchoolSettings } from '@/lib/school/setup';

export const PUT = mutation((a, b) =>
  updateSchoolSettings(a, {
    schoolId: b.schoolId,
    weekDays: b.weekDays,
    pickupLeadMin: b.pickupLeadMin,
    pickupTailMin: b.pickupTailMin,
    etaSpeedKmh: b.etaSpeedKmh,
  }),
);
