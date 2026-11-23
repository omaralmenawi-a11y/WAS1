import { riyadhDay } from './time';

export type ScheduleCtx = {
  weekDays: number[];
  schedule: { weekday: number; dismissal: string }[];
  holidays: string[];
  overrides: { date: string; dismissal: string }[];
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseHHMM(s: string): number | null {
  const m = HHMM.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function fmt(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** Weekday of a YYYY-MM-DD calendar date (0=Sunday). */
function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Dismissal time "HH:MM" for a date, or null if no school / no valid schedule. */
export function dismissalFor(ctx: ScheduleCtx, date: string): string | null {
  if (ctx.holidays.includes(date)) return null;
  const override = ctx.overrides.find((o) => o.date === date);
  if (override) return parseHHMM(override.dismissal) === null ? null : override.dismissal;
  const weekday = weekdayOf(date);
  if (!ctx.weekDays.includes(weekday)) return null;
  const entry = ctx.schedule.find((s) => s.weekday === weekday);
  if (!entry) return null;
  return parseHHMM(entry.dismissal) === null ? null : entry.dismissal;
}

/** Inclusive window in minutes since midnight, clamped to the same day. */
export function pickupWindow(dismissal: string, leadMin: number, tailMin: number): { openMin: number; closeMin: number } {
  const d = parseHHMM(dismissal);
  if (d === null) throw new Error(`Invalid dismissal time: ${dismissal}`);
  return { openMin: Math.max(0, d - leadMin), closeMin: Math.min(1439, d + tailMin) };
}

export type CanRequest = { ok: true; dismissal: string } | { ok: false; reasonAr: string };

export function canRequestNow(ctx: ScheduleCtx, leadMin: number, tailMin: number, at: Date): CanRequest {
  const day = riyadhDay(at);
  const dismissal = dismissalFor(ctx, day.date);
  if (!dismissal) return { ok: false, reasonAr: 'لا يوجد دوام اليوم' };
  const { openMin, closeMin } = pickupWindow(dismissal, leadMin, tailMin);
  if (day.minutes < openMin) return { ok: false, reasonAr: `يبدأ طلب الاستلام الساعة ${fmt(openMin)}` };
  if (day.minutes > closeMin) return { ok: false, reasonAr: 'انتهى وقت طلب الاستلام لهذا اليوم' };
  return { ok: true, dismissal };
}
