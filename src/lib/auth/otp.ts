import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { prisma } from '../db';
import { RateLimitError } from '../errors';
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

let sender: OtpSender = DevSender;
export function setOtpSender(s: OtpSender) {
  sender = s;
}

const OTP_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS = 3;
const SEND_WINDOW_MS = 15 * 60_000;

const hashCode = (c: string) => createHash('sha256').update(c).digest('hex');

export async function issueOtp(identifier: string, purpose: OtpPurpose): Promise<void> {
  const id = parseIdentifier(identifier).value;
  const t = now();
  const sends = await prisma.otpCode.count({
    where: { identifier: id, createdAt: { gt: new Date(t.getTime() - SEND_WINDOW_MS) } },
  });
  if (sends >= MAX_SENDS) throw new RateLimitError('تم تجاوز عدد طلبات الرمز، حاول بعد ١٥ دقيقة');

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const dev = process.env.OTP_MODE === 'dev';
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
  await (dev ? DevSender : sender).send(id, `رمز التحقق في وصل: ${code}`);
}

export async function verifyOtp(identifier: string, purpose: OtpPurpose, code: string): Promise<boolean> {
  const id = parseIdentifier(identifier).value;
  const t = now();
  const row = await prisma.otpCode.findFirst({
    where: { identifier: id, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!row || row.expiresAt <= t || row.attempts >= MAX_ATTEMPTS) return false;

  const a = Buffer.from(hashCode(code.trim()));
  const b = Buffer.from(row.codeHash);
  if (!timingSafeEqual(a, b)) {
    await prisma.otpCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    return false;
  }
  // consume atomically so a code can be used only once
  const res = await prisma.otpCode.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: t },
  });
  return res.count === 1;
}
