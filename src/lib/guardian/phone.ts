import type { User } from '@prisma/client';
import { prisma } from '../db';
import { issueOtp, verifyOtp } from '../auth/otp';
import { requireRole } from '../authz';
import { Conflict, ValidationError } from '../errors';
import { normalizePhone } from '../phone';

const TAKEN = 'رقم الجوال مسجل لدى حساب آخر';

async function check(user: User, raw: string): Promise<string> {
  requireRole(user, 'GUARDIAN');
  if (user.phone) throw new ValidationError('حسابك مرتبط برقم جوال مسبقاً');
  const phone = normalizePhone(String(raw ?? ''));
  if (!phone) throw new ValidationError('رقم الجوال غير صالح');
  const owner = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
  if (owner && owner.id !== user.id) throw new Conflict(TAKEN);
  return phone;
}

/** Step 1: send a LINK_PHONE OTP to the new phone. */
export async function requestPhoneLinkOtp(user: User, rawPhone: string): Promise<void> {
  const phone = await check(user, rawPhone);
  await issueOtp(phone, 'LINK_PHONE');
}

/** Step 2: verify the code and attach the phone to the account. */
export async function linkPhone(user: User, rawPhone: string, code: string): Promise<User> {
  const phone = await check(user, rawPhone);
  if (!(await verifyOtp(phone, 'LINK_PHONE', String(code ?? '')))) {
    throw new ValidationError('رمز التحقق غير صحيح أو منتهي');
  }
  try {
    const r = await prisma.user.updateMany({ where: { id: user.id, phone: null }, data: { phone } });
    if (r.count !== 1) throw new ValidationError('حسابك مرتبط برقم جوال مسبقاً');
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw new Conflict(TAKEN);
    throw e;
  }
  return prisma.user.findUniqueOrThrow({ where: { id: user.id } });
}
