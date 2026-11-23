import { describe, it, expect } from 'vitest';
import { riyadhDay } from '@/lib/time';
import { dismissalFor, pickupWindow, canRequestNow, type ScheduleCtx } from '@/lib/schedule';

// 2026-11-22 is a Sunday; Riyadh = UTC+3
const ctx: ScheduleCtx = {
  weekDays: [0, 1, 2, 3, 4],
  schedule: [0, 1, 2, 3, 4].map((weekday) => ({ weekday, dismissal: '12:15' })),
  holidays: ['2026-11-23'],
  overrides: [{ date: '2026-11-24', dismissal: '10:30' }],
};
const at = (iso: string) => new Date(iso);

describe('riyadhDay', () => {
  it('converts UTC to Riyadh across midnight', () => {
    expect(riyadhDay(at('2026-11-21T21:30:00Z'))).toEqual({ date: '2026-11-22', weekday: 0, minutes: 30 });
  });
});

describe('dismissalFor', () => {
  it('returns schedule, override, null for holiday and non-school day', () => {
    expect(dismissalFor(ctx, '2026-11-22')).toBe('12:15');
    expect(dismissalFor(ctx, '2026-11-24')).toBe('10:30');
    expect(dismissalFor(ctx, '2026-11-23')).toBeNull();
    expect(dismissalFor(ctx, '2026-11-27')).toBeNull();
  });
  it('treats malformed dismissal as no schedule', () => {
    const bad = { ...ctx, schedule: [{ weekday: 0, dismissal: '25:99' }] };
    expect(dismissalFor(bad, '2026-11-22')).toBeNull();
  });
});

describe('pickupWindow', () => {
  it('computes and clamps', () => {
    expect(pickupWindow('12:15', 60, 180)).toEqual({ openMin: 675, closeMin: 915 });
    expect(pickupWindow('00:30', 60, 180)).toEqual({ openMin: 0, closeMin: 210 });
    expect(pickupWindow('23:00', 60, 180)).toEqual({ openMin: 1320, closeMin: 1439 });
  });
});

describe('canRequestNow', () => {
  it('before window', () => {
    const r = canRequestNow(ctx, 60, 180, at('2026-11-22T08:14:00Z'));
    expect(r).toEqual({ ok: false, reasonAr: 'يبدأ طلب الاستلام الساعة 11:15' });
  });
  it('window edges', () => {
    expect(canRequestNow(ctx, 60, 180, at('2026-11-22T08:15:00Z'))).toEqual({ ok: true, dismissal: '12:15' });
    expect(canRequestNow(ctx, 60, 180, at('2026-11-22T12:15:00Z'))).toEqual({ ok: true, dismissal: '12:15' });
    expect(canRequestNow(ctx, 60, 180, at('2026-11-22T12:16:00Z'))).toEqual({
      ok: false,
      reasonAr: 'انتهى وقت طلب الاستلام لهذا اليوم',
    });
  });
  it('Friday', () => {
    expect(canRequestNow(ctx, 60, 180, at('2026-11-27T09:00:00Z'))).toEqual({ ok: false, reasonAr: 'لا يوجد دوام اليوم' });
  });
  it('holiday', () => {
    expect(canRequestNow(ctx, 60, 180, at('2026-11-23T09:00:00Z'))).toEqual({ ok: false, reasonAr: 'لا يوجد دوام اليوم' });
  });
  it('override window 09:30-13:30', () => {
    expect(canRequestNow(ctx, 60, 180, at('2026-11-24T06:29:00Z')).ok).toBe(false);
    expect(canRequestNow(ctx, 60, 180, at('2026-11-24T06:30:00Z'))).toEqual({ ok: true, dismissal: '10:30' });
    expect(canRequestNow(ctx, 60, 180, at('2026-11-24T10:30:00Z')).ok).toBe(true);
    expect(canRequestNow(ctx, 60, 180, at('2026-11-24T10:31:00Z')).ok).toBe(false);
  });
});
