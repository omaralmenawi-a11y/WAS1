import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { Conflict, ValidationError } from '../errors';
import { hashPassword } from '../auth/password';
import { writeAudit } from '../audit';

export interface CreateSchoolInput {
  schoolName: string;
  branchName: string;
  adminName: string;
  adminUsername: string;
  tempPassword: string;
  actorId?: string | null;
}

export async function createSchoolWithAdmin(i: CreateSchoolInput) {
  const schoolName = i.schoolName?.trim();
  const branchName = i.branchName?.trim();
  const adminName = i.adminName?.trim();
  const adminUsername = i.adminUsername?.trim().toLowerCase();
  if (!schoolName || !branchName || !adminName || !adminUsername) throw new ValidationError('جميع الحقول مطلوبة');
  if ((i.tempPassword ?? '').length < 8) throw new ValidationError('كلمة المرور المؤقتة يجب ألا تقل عن ٨ أحرف');

  const passwordHash = await hashPassword(i.tempPassword);
  try {
    return await prisma.$transaction(async (tx) => {
      if (await tx.user.findUnique({ where: { username: adminUsername } })) {
        throw new Conflict('اسم المستخدم مستخدم مسبقاً');
      }
      const school = await tx.school.create({ data: { name: schoolName } });
      const branch = await tx.branch.create({
        data: { schoolId: school.id, name: branchName, boardToken: randomBytes(18).toString('base64url') },
      });
      const admin = await tx.user.create({
        data: {
          role: 'SCHOOL_ADMIN',
          schoolId: school.id,
          name: adminName,
          username: adminUsername,
          passwordHash,
          mustChangePassword: true,
        },
      });
      await writeAudit(
        {
          schoolId: school.id,
          actorId: i.actorId ?? null,
          action: 'SCHOOL_CREATED',
          entity: 'School',
          entityId: school.id,
          data: { schoolName, branchId: branch.id, adminId: admin.id },
        },
        tx,
      );
      return { school, branch, admin };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new Conflict('اسم المستخدم مستخدم مسبقاً');
    }
    throw e;
  }
}

export async function createPlatformAdmin(username: string, password: string) {
  const u = username?.trim().toLowerCase();
  if (!u) throw new ValidationError('اسم المستخدم مطلوب');
  if ((password ?? '').length < 8) throw new ValidationError('كلمة المرور يجب ألا تقل عن ٨ أحرف');
  if (await prisma.user.findUnique({ where: { username: u } })) throw new Conflict('اسم المستخدم مستخدم مسبقاً');
  return prisma.user.create({
    data: { role: 'PLATFORM_ADMIN', name: 'مدير المنصة', username: u, passwordHash: await hashPassword(password) },
  });
}
