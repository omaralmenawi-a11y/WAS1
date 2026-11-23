import type { User } from '@prisma/client';
import { prisma } from '../db';
import { Conflict, InvalidCredentials, ValidationError } from '../errors';
import { normalizePhone } from '../phone';
import { parseIdentifier } from './identifier';
import { verifyOtp } from './otp';
import { hashPassword, verifyPassword } from './password';

export const MIN_PASSWORD = 8;

function checkPassword(p: string) {
  if (typeof p !== 'string' || p.length < MIN_PASSWORD) {
    throw new ValidationError('كلمة المرور يجب ألا تقل عن ٨ أحرف');
  }
}

const whereIdentifier = (i: ReturnType<typeof parseIdentifier>) =>
  i.kind === 'email' ? { email: i.value } : { phone: i.value };

export async function registerGuardian(input: {
  identifier: string;
  code: string;
  name: string;
  password: string;
}): Promise<User> {
  const id = parseIdentifier(input.identifier);
  const name = input.name?.trim();
  if (!name) throw new ValidationError('الاسم مطلوب');
  checkPassword(input.password);
  if (await prisma.user.findUnique({ where: whereIdentifier(id) })) {
    throw new Conflict('هذا الحساب مسجل مسبقاً');
  }
  if (!(await verifyOtp(id.value, 'REGISTER', input.code))) {
    throw new ValidationError('رمز التحقق غير صحيح أو منتهي');
  }
  try {
    return await prisma.user.create({
      data: {
        role: 'GUARDIAN',
        name,
        passwordHash: await hashPassword(input.password),
        ...(id.kind === 'email' ? { email: id.value } : { phone: id.value }),
      },
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw new Conflict('هذا الحساب مسجل مسبقاً');
    throw e;
  }
}

async function findForLogin(raw: string): Promise<User | null> {
  const s = raw.trim();
  if (s.includes('@')) return prisma.user.findUnique({ where: { email: s.toLowerCase() } });
  const phone = normalizePhone(s);
  if (phone) {
    const u = await prisma.user.findUnique({ where: { phone } });
    if (u) return u;
  }
  return prisma.user.findUnique({ where: { username: s } });
}

export async function login(input: { identifier: string; password: string }): Promise<User> {
  const user = await findForLogin(input.identifier ?? '');
  if (!user || !(await verifyPassword(user.passwordHash, input.password ?? ''))) {
    throw new InvalidCredentials();
  }
  return user;
}

export async function resetPassword(input: { identifier: string; code: string; password: string }): Promise<void> {
  const id = parseIdentifier(input.identifier);
  checkPassword(input.password);
  if (!(await verifyOtp(id.value, 'RESET', input.code))) {
    throw new ValidationError('رمز التحقق غير صحيح أو منتهي');
  }
  const user = await prisma.user.findUnique({ where: whereIdentifier(id) });
  if (!user) throw new ValidationError('رمز التحقق غير صحيح أو منتهي');
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(input.password), mustChangePassword: false },
    }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ]);
}

export async function changePassword(userId: string, current: string, next: string): Promise<void> {
  checkPassword(next);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(user.passwordHash, current ?? ''))) throw new InvalidCredentials('كلمة المرور الحالية غير صحيحة');
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(next), mustChangePassword: false },
  });
}
