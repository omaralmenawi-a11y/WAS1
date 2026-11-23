import { Prisma, type User } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { writeAudit } from '../audit';
import { assertBranchAccess, assertSchoolAccess } from '../authz';
import { normalizeUsername } from '../auth/identifier';
import { hashPassword } from '../auth/password';
import { Conflict, NotFound, ValidationError } from '../errors';
import { parse, requireManager } from './setup';

const id = z.string().min(1, 'المعرف مطلوب');
const tempPassword = z.string().min(8, 'كلمة المرور المؤقتة يجب ألا تقل عن ٨ أحرف');
const USERNAME_TAKEN = 'اسم المستخدم مستخدم مسبقاً';

export async function createStaff(
  actor: User,
  input: { branchId: string; name: string; username: string; tempPassword: string; gateIds?: string[] },
) {
  const i = parse(
    z.object({
      branchId: id,
      name: z.string().trim().min(1, 'الاسم مطلوب').max(100),
      username: z.string().transform(normalizeUsername).pipe(z.string().min(1, 'اسم المستخدم مطلوب').max(64)),
      tempPassword,
      gateIds: z.array(id).default([]),
    }),
    input,
  );
  requireManager(actor);
  await assertBranchAccess(actor, i.branchId);
  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: i.branchId }, select: { schoolId: true } });
  const gateIds = [...new Set(i.gateIds)];
  if (gateIds.length) {
    const n = await prisma.gate.count({ where: { id: { in: gateIds }, branchId: i.branchId } });
    if (n !== gateIds.length) throw new ValidationError('البوابات المختارة يجب أن تتبع فرع الموظف');
  }
  const passwordHash = await hashPassword(i.tempPassword);
  try {
    return await prisma.$transaction(async (tx) => {
      if (await tx.user.findUnique({ where: { username: i.username } })) throw new Conflict(USERNAME_TAKEN);
      const u = await tx.user.create({
        data: {
          role: 'STAFF',
          schoolId: branch.schoolId,
          branchId: i.branchId,
          name: i.name,
          username: i.username,
          passwordHash,
          mustChangePassword: true,
          gateIds,
        },
      });
      await writeAudit(
        { schoolId: branch.schoolId, actorId: actor.id, action: 'STAFF_CREATED', entity: 'User', entityId: u.id, data: { username: i.username, branchId: i.branchId, gateIds } },
        tx,
      );
      return u;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new Conflict(USERNAME_TAKEN);
    throw e;
  }
}

async function loadStaff(actor: User, userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u || u.role !== 'STAFF' || !u.schoolId) throw new NotFound();
  assertSchoolAccess(actor, u.schoolId);
  return u;
}

export async function resetStaffPassword(actor: User, input: { userId: string; tempPassword: string }) {
  const i = parse(z.object({ userId: id, tempPassword }), input);
  requireManager(actor);
  const u = await loadStaff(actor, i.userId);
  const passwordHash = await hashPassword(i.tempPassword);
  return prisma.$transaction(async (tx) => {
    const r = await tx.user.update({ where: { id: u.id }, data: { passwordHash, mustChangePassword: true } });
    await tx.session.deleteMany({ where: { userId: u.id } });
    await writeAudit({ schoolId: u.schoolId, actorId: actor.id, action: 'STAFF_PASSWORD_RESET', entity: 'User', entityId: u.id, data: {} }, tx);
    return r;
  });
}

export async function setUserActive(actor: User, input: { userId: string; active: boolean }) {
  const i = parse(z.object({ userId: id, active: z.boolean({ message: 'الحالة غير صالحة' }) }), input);
  requireManager(actor);
  const u = await loadStaff(actor, i.userId);
  return prisma.$transaction(async (tx) => {
    const r = await tx.user.update({ where: { id: u.id }, data: { active: i.active } });
    if (!i.active) await tx.session.deleteMany({ where: { userId: u.id } });
    await writeAudit(
      { schoolId: u.schoolId, actorId: actor.id, action: i.active ? 'STAFF_ACTIVATED' : 'STAFF_DEACTIVATED', entity: 'User', entityId: u.id, data: {} },
      tx,
    );
    return r;
  });
}
