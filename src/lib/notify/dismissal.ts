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

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full;

type Entry = { studentId: string; name: string; gate: string };

/** Sends reminders (D-15 <= now < D) and end-of-day notices (D <= now < D+30). Idempotent via dedupeKey. */
export async function runDismissalNotifications(at: Date = now()): Promise<{ reminders: number; endOfDay: number }> {
  const day = riyadhDay(at);
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
  for (const g of groups.values()) {
    const names = g.entries.map((e) => e.name);
    const msg =
      g.kind === 'REMINDER'
        ? msgReminder({ names, time: g.time })
        : msgEndOfDay({ names, gate: [...new Set(g.entries.map((e) => e.gate).filter(Boolean))].join('، ') });
    const r = await notify([g.userId], { kind: g.kind, title: msg.title, body: msg.body, url: '/parent' }, {
      dedupeKey: (u) => `${g.kind}:${day.date}:${g.time}:${u}`,
    });
    if (g.kind === 'REMINDER') reminders += r.created;
    else endOfDay += r.created;
  }
  return { reminders, endOfDay };
}
