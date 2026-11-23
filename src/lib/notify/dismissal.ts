import { prisma } from '../db';
import { buildScheduleCtxs, SCHEDULE_INCLUDE } from '../guardian/children';
import { dismissalFor } from '../schedule';
import { now, riyadhDay } from '../time';
import { notify } from './index';
import { msgEndOfDay, msgReminder } from './messages';
import { guardiansByStudent } from './recipients';

// Must not import next/*: reachable from server.ts.

const REMINDER_LEAD_MIN = 15;
const END_OF_DAY_WINDOW_MIN = 30;
const SEND_CONCURRENCY = 20;

/** Runs fn over items with at most `limit` in flight. */
async function eachLimit<T>(items: T[], limit: number, fn: (x: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full;

type Entry = { studentId: string; name: string; gate: string };

/**
 * Sends reminders (D-15 <= at < D) and end-of-day notices (D <= at < D+30). Idempotent via dedupeKey.
 * Guardian groups go out 20 at a time; a reminder's minutes left are taken from opts.clock at send time
 * (default: now(), or `at` when `at` is given) and the reminder is dropped once that time reaches D.
 */
export async function runDismissalNotifications(
  at?: Date,
  opts?: { clock?: () => Date },
): Promise<{ reminders: number; endOfDay: number }> {
  const start = at ?? now();
  const clock = opts?.clock ?? (at ? () => start : now);
  const day = riyadhDay(start);
  const students = await prisma.student.findMany({
    where: { active: true, school: { weekDays: { has: day.weekday } } },
    include: SCHEDULE_INCLUDE,
  });
  if (students.length === 0) return { reminders: 0, endOfDay: 0 };

  const ctxs = await buildScheduleCtxs(students, day.date);
  type Due = { kind: 'REMINDER' | 'END_OF_DAY'; time: string; student: (typeof students)[number] };
  const due: Due[] = [];
  for (const s of students) {
    const time = dismissalFor(ctxs.get(s.id)!, day.date);
    if (!time) continue;
    const d = toMin(time);
    if (d - REMINDER_LEAD_MIN <= day.minutes && day.minutes < d) due.push({ kind: 'REMINDER', time, student: s });
    else if (d <= day.minutes && day.minutes < d + END_OF_DAY_WINDOW_MIN) due.push({ kind: 'END_OF_DAY', time, student: s });
  }
  if (due.length === 0) return { reminders: 0, endOfDay: 0 };

  const dueIds = due.map((x) => x.student.id);
  const [items, guardians, gates] = await Promise.all([
    prisma.pickupItem.findMany({
      where: { studentId: { in: dueIds }, request: { day: new Date(`${day.date}T00:00:00Z`) } },
      select: { studentId: true, status: true },
    }),
    guardiansByStudent(dueIds),
    prisma.gate.findMany({ where: { id: { in: [...new Set(due.map((x) => x.student.defaultGateId))] } }, select: { id: true, name: true } }),
  ]);
  const gateName = new Map(gates.map((g) => [g.id, g.name]));
  const busy = new Set(items.filter((i) => ['EN_ROUTE', 'PREPARING', 'READY'].includes(i.status)).map((i) => i.studentId));
  const delivered = new Set(items.filter((i) => i.status === 'DELIVERED').map((i) => i.studentId));

  // group per (kind, time, guardian)
  const groups = new Map<string, { kind: Due['kind']; time: string; userId: string; entries: Entry[] }>();
  for (const x of due) {
    const id = x.student.id;
    if (delivered.has(id)) continue;
    if (x.kind === 'REMINDER' && busy.has(id)) continue;
    for (const userId of guardians.get(id) ?? []) {
      const key = `${x.kind}|${x.time}|${userId}`;
      const g = groups.get(key) ?? { kind: x.kind, time: x.time, userId, entries: [] };
      g.entries.push({ studentId: id, name: firstName(x.student.fullName), gate: gateName.get(x.student.defaultGateId) ?? '' });
      groups.set(key, g);
    }
  }

  let reminders = 0;
  let endOfDay = 0;
  await eachLimit([...groups.values()], SEND_CONCURRENCY, async (g) => {
    const names = g.entries.map((e) => e.name);
    let minutesLeft = 0;
    if (g.kind === 'REMINDER') {
      const t = riyadhDay(clock());
      minutesLeft = t.date === day.date ? toMin(g.time) - t.minutes : 0;
      if (minutesLeft <= 0) return; // dismissal already reached: a reminder now would be wrong
    }
    const msg =
      g.kind === 'REMINDER'
        ? msgReminder({ names, time: g.time, minutesLeft })
        : msgEndOfDay({ names, gate: [...new Set(g.entries.map((e) => e.gate).filter(Boolean))].join('، ') });
    const r = await notify([g.userId], { kind: g.kind, title: msg.title, body: msg.body, url: '/parent', tag: `${g.kind}:${day.date}:${g.time}` }, {
      // Known limitation: a sibling skipped at reminder time whose request is then cancelled is still covered by the end-of-day notice.
      dedupeKey: (u) => `${g.kind}:${day.date}:${g.time}:${u}`,
    });
    if (g.kind === 'REMINDER') reminders += r.created;
    else endOfDay += r.created;
  });
  return { reminders, endOfDay };
}
