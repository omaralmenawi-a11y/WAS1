import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { prisma } from '../db';
import { AppError, RateLimitError } from '../errors';
import { now } from '../time';
import { parseIdentifier } from './identifier';

export type OtpPurpose = 'REGISTER' | 'RESET' | 'LINK_PHONE';

export interface OtpSender {
  send(identifier: string, text: string): Promise<void>;
}

/** Dev mode: no message is sent; the code is logged and stored in OtpCode.devVisible. */
export const DevSender: OtpSender = {
  async send(identifier, text) {
    if (process.env.NODE_ENV !== 'test') console.log(`[OTP dev] ${identifier}: ${text}`);
  },
};

let sender: OtpSender | null = null;
export function setOtpSender(s: OtpSender | null) {
  sender = s;
}

const OTP_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS = 3;
const SEND_WINDOW_MS = 15 * 60_000;

const hashCode = (c: string) => createHash('sha256').update(c).digest('hex');

export async function issueOtp(identifier: string, purpose: OtpPurpose): Promise<void> {
  const id = parseIdentifier(identifier).value;
  const dev = process.env.OTP_MODE === 'dev';
  const out = dev ? DevSender : sender;
  if (!out) throw new AppError('OTP_UNAVAILABLE', 'خدمة رمز التحقق غير متاحة حالياً', 503);
  const t = now();
  const sends = await prisma.otpCode.count({
    where: { identifier: id, createdAt: { gt: new Date(t.getTime() - SEND_WINDOW_MS) } },
  });
  if (sends >= MAX_SENDS) throw new RateLimitError('تم تجاوز عدد طلبات الرمز، حاول بعد ١٥ دقيقة');

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await prisma.otpCode.create({
    data: {
      identifier: id,
      purpose,
      codeHash: hashCode(code),
      expiresAt: new Date(t.getTime() + OTP_TTL_MS),
      createdAt: t,
      devVisible: dev ? code : null,
    },
  });
  await out.send(id, `رمز التحقق في وصل: ${code}`);
}

export async function verifyOtp(identifier: string, purpose: OtpPurpose, code: string): Promise<boolean> {
  const id = parseIdentifier(identifier).value;
  const t = now();
  const row = await prisma.otpCode.findFirst({
    where: { identifier: id, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!row || row.expiresAt <= t || row.attempts >= MAX_ATTEMPTS) return false;

  // Count the attempt atomically first; parallel guesses cannot exceed the cap.
  const claimed = await prisma.otpCode.updateMany({
    where: { id: row.id, attempts: { lt: MAX_ATTEMPTS }, consumedAt: null },
    data: { attempts: { increment: 1 } },
  });
  if (claimed.count !== 1) return false;

  const a = Buffer.from(hashCode(code.trim()));
  const b = Buffer.from(row.codeHash);
  if (!timingSafeEqual(a, b)) return false;
  // consume so a code can be used only once
  const res = await prisma.otpCode.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: t },
  });
  return res.count === 1;
}
