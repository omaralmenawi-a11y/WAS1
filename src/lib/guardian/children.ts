import type { ItemStatus, User } from '@prisma/client';
import { prisma } from '../db';
import { canRequestNow, dismissalFor, type ScheduleCtx } from '../schedule';
import { now, riyadhDay } from '../time';

export type ChildView = {
  studentId: string;
  fullName: string;
  schoolName: string;
  branchId: string;
  branchName: string;
  classroom: string;
  gateName: string;
  todayDismissal: string | null;
  status: 'IN_SCHOOL' | ItemStatus;
  activeRequestId: string | null;
  canRequest: { ok: boolean; reasonAr?: string };
};

const ACTIVE: ItemStatus[] = ['EN_ROUTE', 'PREPARING', 'READY'];
const dateKey = (d: Date) => d.toISOString().slice(0, 10);

export type StudentForSchedule = {
  id: string;
  schoolId: string;
  branchId: string;
  classroomId: string;
  school: { weekDays: number[] };
  classroom: { schedules: { weekday: number; dismissal: string }[] };
};

/** Prisma include that yields everything buildScheduleCtxs needs. */
export const SCHEDULE_INCLUDE = {
  school: { select: { name: true, weekDays: true } },
  classroom: { include: { schedules: true } },
} as const;

/** Per-student ScheduleCtx for one Riyadh calendar date (YYYY-MM-DD). */
export async function buildScheduleCtxs(students: StudentForSchedule[], date: string): Promise<Map<string, ScheduleCtx>> {
  const day = new Date(`${date}T00:00:00Z`);
  const [holidays, overrides] = await Promise.all([
    prisma.holiday.findMany({
      where: { date: day, schoolId: { in: [...new Set(students.map((s) => s.schoolId))] } },
      select: { schoolId: true, branchId: true, date: true },
    }),
    prisma.scheduleOverride.findMany({
      where: { date: day, branchId: { in: [...new Set(students.map((s) => s.branchId))] } },
      select: { branchId: true, classroomId: true, date: true, dismissal: true },
    }),
  ]);
  return new Map(
    students.map((s) => [
      s.id,
      {
        weekDays: s.school.weekDays,
        schedule: s.classroom.schedules.map((x) => ({ weekday: x.weekday, dismissal: x.dismissal })),
        holidays: holidays.filter((h) => h.schoolId === s.schoolId && (h.branchId === null || h.branchId === s.branchId)).map((h) => dateKey(h.date)),
        overrides: overrides
          .filter((o) => o.branchId === s.branchId && (o.classroomId === null || o.classroomId === s.classroomId))
          // a classroom-specific override outranks a branch-wide one (dismissalFor takes the first match)
          .sort((a, b) => Number(b.classroomId !== null) - Number(a.classroomId !== null))
          .map((o) => ({ date: dateKey(o.date), dismissal: o.dismissal })),
      },
    ]),
  );
}

/** Guardian's active children, matched on the user's verified phone across schools. */
export async function listChildrenForUser(user: User): Promise<ChildView[]> {
  if (user.role !== 'GUARDIAN' || !user.phone) return [];
  const today = riyadhDay(now()).date;
  const day = new Date(`${today}T00:00:00Z`);

  const students = await prisma.student.findMany({
    where: { active: true, phones: { some: { phone: user.phone } } },
    include: {
      school: { select: { name: true, weekDays: true, pickupLeadMin: true, pickupTailMin: true } },
      branch: { select: { name: true } },
      classroom: { include: { schedules: true } },
    },
    orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
  });
  if (students.length === 0) return [];

  const ids = students.map((s) => s.id);
  const [gates, ctxs, items] = await Promise.all([
    prisma.gate.findMany({ where: { id: { in: students.map((s) => s.defaultGateId) } }, select: { id: true, name: true } }),
    buildScheduleCtxs(students, today),
    prisma.pickupItem.findMany({
      where: { studentId: { in: ids }, request: { day } },
      select: { studentId: true, status: true, requestId: true },
      orderBy: { request: { createdAt: 'desc' } },
    }),
  ]);
  const at = now();
  const gateName = new Map(gates.map((g) => [g.id, g.name]));

  return students.map((s) => {
    const ctx = ctxs.get(s.id)!;
    const mine = items.filter((i) => i.studentId === s.id && i.status !== 'CANCELLED');
    const active = mine.find((i) => ACTIVE.includes(i.status));
    let status: ChildView['status'] = 'IN_SCHOOL';
    let activeRequestId: string | null = null;
    if (active) {
      status = active.status;
      activeRequestId = active.requestId;
    } else if (mine[0]?.status === 'DELIVERED') {
      status = 'DELIVERED';
    }
    const can = canRequestNow(ctx, s.school.pickupLeadMin, s.school.pickupTailMin, at);
    return {
      studentId: s.id,
      fullName: s.fullName,
      schoolName: s.school.name,
      branchId: s.branchId,
      branchName: s.branch.name,
      classroom: s.classroom.name,
      gateName: gateName.get(s.defaultGateId) ?? '',
      todayDismissal: dismissalFor(ctx, today),
      status,
      activeRequestId,
      canRequest: can.ok ? { ok: true } : { ok: false, reasonAr: can.reasonAr },
    };
  });
}
