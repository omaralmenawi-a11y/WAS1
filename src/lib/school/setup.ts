import type { User } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { writeAudit } from '../audit';
import { assertBranchAccess, assertSchoolAccess, requireRole } from '../authz';
import { Conflict, NotFound, ValidationError } from '../errors';
import { newBoardToken } from './board-token';

export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw new ValidationError(r.error.issues[0]?.message || 'بيانات غير صالحة');
  return r.data;
}

/** Only SCHOOL_ADMIN / PLATFORM_ADMIN may mutate school setup. */
export function requireManager(actor: User): void {
  requireRole(actor, 'SCHOOL_ADMIN', 'PLATFORM_ADMIN');
}

const id = z.string().min(1, 'المعرف مطلوب');
const name = z.string().trim().min(1, 'الاسم مطلوب').max(100, 'الاسم طويل جداً');
const weekday = z.number({ message: 'اليوم غير صالح' }).int().min(0, 'اليوم غير صالح').max(6, 'اليوم غير صالح');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'الوقت غير صالح (HH:MM)');
const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ غير صالح')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'التاريخ غير صالح');
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);

function resolveSchoolId(actor: User, schoolId?: string): string {
  const sid = schoolId ?? actor.schoolId;
  if (!sid) throw new ValidationError('المدرسة مطلوبة');
  return sid;
}

async function schoolIdOfBranch(branchId: string): Promise<string> {
  const b = await prisma.branch.findUnique({ where: { id: branchId }, select: { schoolId: true } });
  if (!b) throw new NotFound();
  return b.schoolId;
}

// ---------- school settings ----------
const settingsSchema = z.object({
  schoolId: id.optional(),
  weekDays: z
    .array(weekday)
    .min(1, 'اختر يوماً واحداً على الأقل')
    .transform((a) => [...new Set(a)].sort((x, y) => x - y)),
  pickupLeadMin: z.number().int().min(0, 'المدة غير صالحة').max(240, 'المدة غير صالحة'),
  pickupTailMin: z.number().int().min(0, 'المدة غير صالحة').max(480, 'المدة غير صالحة'),
  etaSpeedKmh: z.number().int().min(5, 'السرعة غير صالحة').max(120, 'السرعة غير صالحة'),
});

export async function updateSchoolSettings(actor: User, input: z.input<typeof settingsSchema>) {
  const { schoolId, ...data } = parse(settingsSchema, input);
  requireManager(actor);
  const sid = resolveSchoolId(actor, schoolId);
  assertSchoolAccess(actor, sid);
  return prisma.$transaction(async (tx) => {
    const school = await tx.school.update({ where: { id: sid }, data });
    await writeAudit({ schoolId: sid, actorId: actor.id, action: 'SCHOOL_SETTINGS_UPDATED', entity: 'School', entityId: sid, data }, tx);
    return school;
  });
}

// ---------- branches ----------
export async function createBranch(actor: User, input: { schoolId?: string; name: string }) {
  const i = parse(z.object({ schoolId: id.optional(), name }), input);
  requireManager(actor);
  const sid = resolveSchoolId(actor, i.schoolId);
  assertSchoolAccess(actor, sid);
  return prisma.$transaction(async (tx) => {
    if (!(await tx.school.findUnique({ where: { id: sid }, select: { id: true } }))) throw new NotFound();
    const b = await tx.branch.create({ data: { schoolId: sid, name: i.name, boardToken: newBoardToken() } });
    await writeAudit({ schoolId: sid, actorId: actor.id, action: 'BRANCH_CREATED', entity: 'Branch', entityId: b.id, data: { name: i.name } }, tx);
    return b;
  });
}

export async function updateBranch(actor: User, input: { id: string; name: string }) {
  const i = parse(z.object({ id, name }), input);
  requireManager(actor);
  await assertBranchAccess(actor, i.id);
  return prisma.$transaction(async (tx) => {
    const b = await tx.branch.update({ where: { id: i.id }, data: { name: i.name } });
    await writeAudit({ schoolId: b.schoolId, actorId: actor.id, action: 'BRANCH_UPDATED', entity: 'Branch', entityId: b.id, data: { name: i.name } }, tx);
    return b;
  });
}

// ---------- gates ----------
export async function createGate(actor: User, input: { branchId: string; name: string }) {
  const i = parse(z.object({ branchId: id, name }), input);
  requireManager(actor);
  await assertBranchAccess(actor, i.branchId);
  const schoolId = await schoolIdOfBranch(i.branchId);
  return prisma.$transaction(async (tx) => {
    const g = await tx.gate.create({ data: { branchId: i.branchId, name: i.name } });
    await writeAudit({ schoolId, actorId: actor.id, action: 'GATE_CREATED', entity: 'Gate', entityId: g.id, data: { name: i.name, branchId: i.branchId } }, tx);
    return g;
  });
}

async function loadGate(actor: User, gateId: string) {
  const g = await prisma.gate.findUnique({ where: { id: gateId }, include: { branch: { select: { schoolId: true } } } });
  if (!g) throw new NotFound();
  await assertBranchAccess(actor, g.branchId);
  return g;
}

export async function updateGate(actor: User, input: { id: string; name: string }) {
  const i = parse(z.object({ id, name }), input);
  requireManager(actor);
  const g = await loadGate(actor, i.id);
  return prisma.$transaction(async (tx) => {
    const u = await tx.gate.update({ where: { id: i.id }, data: { name: i.name } });
    await writeAudit({ schoolId: g.branch.schoolId, actorId: actor.id, action: 'GATE_UPDATED', entity: 'Gate', entityId: g.id, data: { name: i.name } }, tx);
    return u;
  });
}

export async function deleteGate(actor: User, input: { id: string }) {
  const i = parse(z.object({ id }), input);
  requireManager(actor);
  const g = await loadGate(actor, i.id);
  return prisma.$transaction(async (tx) => {
    if ((await tx.student.count({ where: { defaultGateId: g.id } })) > 0) {
      throw new Conflict('لا يمكن حذف البوابة لوجود طلاب مرتبطين بها');
    }
    await tx.gate.delete({ where: { id: g.id } });
    await writeAudit({ schoolId: g.branch.schoolId, actorId: actor.id, action: 'GATE_DELETED', entity: 'Gate', entityId: g.id, data: { name: g.name } }, tx);
    return g;
  });
}

// ---------- classrooms ----------
const classFields = { name, grade: z.string().trim().min(1, 'الصف مطلوب').max(100, 'الصف طويل جداً') };

export async function createClassroom(actor: User, input: { branchId: string; name: string; grade: string }) {
  const i = parse(z.object({ branchId: id, ...classFields }), input);
  requireManager(actor);
  await assertBranchAccess(actor, i.branchId);
  const schoolId = await schoolIdOfBranch(i.branchId);
  return prisma.$transaction(async (tx) => {
    const c = await tx.classroom.create({ data: i });
    await writeAudit({ schoolId, actorId: actor.id, action: 'CLASSROOM_CREATED', entity: 'Classroom', entityId: c.id, data: i }, tx);
    return c;
  });
}

async function loadClassroom(actor: User, classroomId: string) {
  const c = await prisma.classroom.findUnique({ where: { id: classroomId }, include: { branch: { select: { schoolId: true } } } });
  if (!c) throw new NotFound();
  await assertBranchAccess(actor, c.branchId);
  return c;
}

export async function updateClassroom(actor: User, input: { id: string; name: string; grade: string }) {
  const { id: cid, ...data } = parse(z.object({ id, ...classFields }), input);
  requireManager(actor);
  const c = await loadClassroom(actor, cid);
  return prisma.$transaction(async (tx) => {
    const u = await tx.classroom.update({ where: { id: cid }, data });
    await writeAudit({ schoolId: c.branch.schoolId, actorId: actor.id, action: 'CLASSROOM_UPDATED', entity: 'Classroom', entityId: cid, data }, tx);
    return u;
  });
}

export async function deleteClassroom(actor: User, input: { id: string }) {
  const i = parse(z.object({ id }), input);
  requireManager(actor);
  const c = await loadClassroom(actor, i.id);
  return prisma.$transaction(async (tx) => {
    if ((await tx.student.count({ where: { classroomId: c.id } })) > 0) {
      throw new Conflict('لا يمكن حذف الفصل لوجود طلاب مسجلين فيه');
    }
    await tx.classSchedule.deleteMany({ where: { classroomId: c.id } });
    await tx.scheduleOverride.deleteMany({ where: { classroomId: c.id } });
    await tx.classroom.delete({ where: { id: c.id } });
    await writeAudit({ schoolId: c.branch.schoolId, actorId: actor.id, action: 'CLASSROOM_DELETED', entity: 'Classroom', entityId: c.id, data: { name: c.name } }, tx);
    return c;
  });
}

// ---------- class schedules ----------
export async function setClassSchedule(actor: User, input: { classroomId: string; weekday: number; dismissal: string }) {
  const i = parse(z.object({ classroomId: id, weekday, dismissal: hhmm }), input);
  requireManager(actor);
  const c = await loadClassroom(actor, i.classroomId);
  return prisma.$transaction(async (tx) => {
    const s = await tx.classSchedule.upsert({
      where: { classroomId_weekday: { classroomId: i.classroomId, weekday: i.weekday } },
      create: i,
      update: { dismissal: i.dismissal },
    });
    await writeAudit({ schoolId: c.branch.schoolId, actorId: actor.id, action: 'SCHEDULE_SET', entity: 'ClassSchedule', entityId: s.id, data: i }, tx);
    return s;
  });
}

export async function deleteClassSchedule(actor: User, input: { classroomId: string; weekday: number }) {
  const i = parse(z.object({ classroomId: id, weekday }), input);
  requireManager(actor);
  const c = await loadClassroom(actor, i.classroomId);
  return prisma.$transaction(async (tx) => {
    const s = await tx.classSchedule.findUnique({ where: { classroomId_weekday: i } });
    if (!s) throw new NotFound();
    await tx.classSchedule.delete({ where: { id: s.id } });
    await writeAudit({ schoolId: c.branch.schoolId, actorId: actor.id, action: 'SCHEDULE_DELETED', entity: 'ClassSchedule', entityId: s.id, data: i }, tx);
    return s;
  });
}

// ---------- holidays ----------
export async function addHoliday(actor: User, input: { schoolId?: string; branchId?: string | null; date: string; note: string }) {
  const i = parse(
    z.object({ schoolId: id.optional(), branchId: id.nullish(), date: dateStr, note: z.string().trim().min(1, 'الملاحظة مطلوبة').max(200) }),
    input,
  );
  requireManager(actor);
  let schoolId: string;
  if (i.branchId) {
    await assertBranchAccess(actor, i.branchId);
    schoolId = await schoolIdOfBranch(i.branchId);
    if (i.schoolId && i.schoolId !== schoolId) throw new NotFound();
  } else {
    schoolId = resolveSchoolId(actor, i.schoolId);
    assertSchoolAccess(actor, schoolId);
  }
  return prisma.$transaction(async (tx) => {
    if (!(await tx.school.findUnique({ where: { id: schoolId }, select: { id: true } }))) throw new NotFound();
    const h = await tx.holiday.create({ data: { schoolId, branchId: i.branchId ?? null, date: toDate(i.date), note: i.note } });
    await writeAudit({ schoolId, actorId: actor.id, action: 'HOLIDAY_CREATED', entity: 'Holiday', entityId: h.id, data: { date: i.date, branchId: i.branchId ?? null, note: i.note } }, tx);
    return h;
  });
}

export async function deleteHoliday(actor: User, input: { id: string }) {
  const i = parse(z.object({ id }), input);
  requireManager(actor);
  const h = await prisma.holiday.findUnique({ where: { id: i.id } });
  if (!h) throw new NotFound();
  if (h.branchId) await assertBranchAccess(actor, h.branchId);
  else assertSchoolAccess(actor, h.schoolId);
  return prisma.$transaction(async (tx) => {
    await tx.holiday.delete({ where: { id: h.id } });
    await writeAudit({ schoolId: h.schoolId, actorId: actor.id, action: 'HOLIDAY_DELETED', entity: 'Holiday', entityId: h.id, data: { note: h.note } }, tx);
    return h;
  });
}

// ---------- overrides ----------
export async function addOverride(actor: User, input: { branchId: string; classroomId?: string | null; date: string; dismissal: string }) {
  const i = parse(z.object({ branchId: id, classroomId: id.nullish(), date: dateStr, dismissal: hhmm }), input);
  requireManager(actor);
  await assertBranchAccess(actor, i.branchId);
  const schoolId = await schoolIdOfBranch(i.branchId);
  if (i.classroomId) {
    const c = await prisma.classroom.findUnique({ where: { id: i.classroomId }, select: { branchId: true } });
    if (!c || c.branchId !== i.branchId) throw new NotFound();
  }
  return prisma.$transaction(async (tx) => {
    const o = await tx.scheduleOverride.create({
      data: { branchId: i.branchId, classroomId: i.classroomId ?? null, date: toDate(i.date), dismissal: i.dismissal },
    });
    await writeAudit({ schoolId, actorId: actor.id, action: 'OVERRIDE_CREATED', entity: 'ScheduleOverride', entityId: o.id, data: { ...i } }, tx);
    return o;
  });
}

export async function deleteOverride(actor: User, input: { id: string }) {
  const i = parse(z.object({ id }), input);
  requireManager(actor);
  const o = await prisma.scheduleOverride.findUnique({ where: { id: i.id } });
  if (!o) throw new NotFound();
  await assertBranchAccess(actor, o.branchId);
  const schoolId = await schoolIdOfBranch(o.branchId);
  return prisma.$transaction(async (tx) => {
    await tx.scheduleOverride.delete({ where: { id: o.id } });
    await writeAudit({ schoolId, actorId: actor.id, action: 'OVERRIDE_DELETED', entity: 'ScheduleOverride', entityId: o.id, data: {} }, tx);
    return o;
  });
}

