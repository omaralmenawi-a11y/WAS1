/** Current time. Honours WASL_FAKE_NOW outside production (tests, demos). */
export function now(): Date {
  const fake = process.env.WASL_FAKE_NOW;
  if (fake && process.env.NODE_ENV !== 'production') return new Date(fake);
  return new Date();
}

export type RiyadhDay = { date: string; weekday: number; minutes: number };

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const riyadhFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Riyadh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Calendar date, weekday (0=Sunday) and minutes since midnight in Asia/Riyadh. */
export function riyadhDay(d: Date): RiyadhDay {
  const p: Record<string, string> = {};
  for (const part of riyadhFmt.formatToParts(d)) p[part.type] = part.value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: WEEKDAYS[p.weekday],
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}
