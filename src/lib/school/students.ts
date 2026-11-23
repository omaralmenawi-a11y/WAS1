import type { Prisma, User } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { writeAudit } from '../audit';
import { assertBranchAccess, assertSchoolAccess } from '../authz';
import { Conflict, NotFound, ValidationError } from '../errors';
import { normalizePhone } from '../phone';
import { parse, requireManager } from './setup';

const id = z.string().min(1, 'المعرف مطلوب');
const fullName = z.string().trim().min(1, 'اسم الطالب مطلوب').max(150, 'الاسم طويل جداً');
const externalId = z.string().trim().max(50, 'رقم الطالب طويل جداً').nullish();
const phonesIn = z.array(z.string()).max(10, 'عدد الأرقام كبير');

function normalizePhones(list: string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    if (!raw.trim()) continue;
    const p = normalizePhone(raw);
    if (!p) throw new ValidationError(`رقم الجوال غير صالح: ${raw}`);
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/** Classroom and gate must belong to the student's branch. */
async function assertRefs(tx: Pick<Prisma.TransactionClient, 'classroom' | 'gate'>, branchId: string, classroomId: string, gateId: string) {
  const [room, gate] = await Promise.all([
    tx.classroom.findUnique({ where: { id: classroomId }, select: { branchId: true } }),
    tx.gate.findUnique({ where: { id: gateId }, select: { branchId: true } }),
  ]);
  if (!room || room.branchId !== branchId) throw new ValidationError('الفصل لا يتبع هذا الفرع');
  if (!gate || gate.branchId !== branchId) throw new ValidationError('البوابة لا تتبع هذا الفرع');
}

const isUnique = (e: unknown) => (e as { code?: string })?.code === 'P2002';
const DUP = 'رقم الطالب مستخدم مسبقاً';

export async function createStudent(
  actor: User,
  input: { branchId: string; classroomId: string; gateId: string; fullName: string; externalId?: string | null; phones?: string[] },
) {
  const i = parse(z.object({ branchId: id, classroomId: id, gateId: id, fullName, externalId, phones: phonesIn.default([]) }), input);
  requireManager(actor);
  await assertBranchAccess(actor, i.branchId);
  const phones = normalizePhones(i.phones);
  const branch = await prisma.branch.findUnique({ where: { id: i.branchId }, select: { schoolId: true } });
  if (!branch) throw new NotFound();
  try {
    return await prisma.$transaction(async (tx) => {
      await assertRefs(tx, i.branchId, i.classroomId, i.gateId);
      const s = await tx.student.create({
        data: {
          schoolId: branch.schoolId,
          branchId: i.branchId,
          classroomId: i.classroomId,
          defaultGateId: i.gateId,
          fullName: i.fullName,
          externalId: i.externalId || null,
          phones: { create: phones.map((phone) => ({ phone })) },
        },
      });
      await writeAudit({ schoolId: branch.schoolId, actorId: actor.id, action: 'STUDENT_CREATED', entity: 'Student', entityId: s.id, data: { fullName: i.fullName, externalId: i.externalId ?? null, phones: phones.length } }, tx);
      return s;
    });
  } catch (e) {
    if (isUnique(e)) throw new Conflict(DUP);
    throw e;
  }
}

async function loadStudent(actor: User, studentId: string) {
  const s = await prisma.student.findUnique({ where: { id: studentId } });
  if (!s) throw new NotFound();
  await assertBranchAccess(actor, s.branchId);
  return s;
}

export async function updateStudent(
  actor: User,
  input: { id: string; fullName?: string; externalId?: string | null; branchId?: string; classroomId?: string; gateId?: string; phones?: string[] },
) {
  const i = parse(
    z.object({ id, fullName: fullName.optional(), externalId, branchId: id.optional(), classroomId: id.optional(), gateId: id.optional(), phones: phonesIn.optional() }),
    input,
  );
  requireManager(actor);
  const s = await loadStudent(actor, i.id);
  const branchId = i.branchId ?? s.branchId;
  if (branchId !== s.branchId) await assertBranchAccess(actor, branchId);
  const classroomId = i.classroomId ?? s.classroomId;
  const gateId = i.gateId ?? s.defaultGateId;
  const phones = i.phones ? normalizePhones(i.phones) : null;
  const schoolId = branchId === s.branchId ? s.schoolId : (await prisma.branch.findUnique({ where: { id: branchId }, select: { schoolId: true } }))?.schoolId;
  if (schoolId !== s.schoolId) throw new NotFound(); // never move a student across schools
  try {
    return await prisma.$transaction(async (tx) => {
      await assertRefs(tx, branchId, classroomId, gateId);
      const u = await tx.student.update({
        where: { id: s.id },
        data: {
          fullName: i.fullName ?? s.fullName,
          branchId,
          classroomId,
          defaultGateId: gateId,
          ...(i.externalId !== undefined ? { externalId: i.externalId || null } : {}),
        },
      });
      if (phones) {
        await tx.guardianPhone.deleteMany({ where: { studentId: s.id } });
        if (phones.length) await tx.guardianPhone.createMany({ data: phones.map((phone) => ({ studentId: s.id, phone })) });
      }
      await writeAudit({ schoolId: s.schoolId, actorId: actor.id, action: 'STUDENT_UPDATED', entity: 'Student', entityId: s.id, data: { fullName: u.fullName, branchId, classroomId, gateId, phones: phones?.length ?? null } }, tx);
      return u;
    });
  } catch (e) {
    if (isUnique(e)) throw new Conflict(DUP);
    throw e;
  }
}

export async function setStudentActive(actor: User, input: { id: string; active: boolean }) {
  const i = parse(z.object({ id, active: z.boolean({ message: 'الحالة غير صالحة' }) }), input);
  requireManager(actor);
  const s = await loadStudent(actor, i.id);
  return prisma.$transaction(async (tx) => {
    const u = await tx.student.update({ where: { id: s.id }, data: { active: i.active } });
    await writeAudit({ schoolId: s.schoolId, actorId: actor.id, action: i.active ? 'STUDENT_ACTIVATED' : 'STUDENT_DEACTIVATED', entity: 'Student', entityId: s.id, data: {} }, tx);
    return u;
  });
}

export async function listStudents(
  actor: User,
  filter: { schoolId?: string; search?: string; branchId?: string; classroomId?: string; includeInactive?: boolean } = {},
) {
  requireManager(actor);
  const schoolId = filter.schoolId ?? actor.schoolId;
  if (!schoolId) throw new ValidationError('المدرسة مطلوبة');
  assertSchoolAccess(actor, schoolId);
  const q = filter.search?.trim();
  return prisma.student.findMany({
    where: {
      schoolId,
      ...(filter.branchId ? { branchId: filter.branchId } : {}),
      ...(filter.classroomId ? { classroomId: filter.classroomId } : {}),
      ...(q ? { OR: [{ fullName: { contains: q, mode: 'insensitive' as const } }, { externalId: { contains: q, mode: 'insensitive' as const } }] } : {}),
    },
    include: { phones: { orderBy: { phone: 'asc' } }, branch: { select: { name: true } }, classroom: { select: { name: true } } },
    orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
    take: 1000,
  });
}
