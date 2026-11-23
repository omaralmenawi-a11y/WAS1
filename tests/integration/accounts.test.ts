import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/db';
import { issueOtp, verifyOtp } from '../../src/lib/auth/otp';
import { registerGuardian, login, resetPassword } from '../../src/lib/auth/accounts';
import { createSession, getSessionUser } from '../../src/lib/auth/session';
import { Conflict, InvalidCredentials, RateLimitError, ValidationError } from '../../src/lib/errors';

const PHONE = '+966501234567';

async function otpFor(identifier: string, purpose: 'REGISTER' | 'RESET' | 'LINK_PHONE' = 'REGISTER') {
  await issueOtp(identifier, purpose);
  const row = await prisma.otpCode.findFirstOrThrow({
    where: { identifier, purpose },
    orderBy: { createdAt: 'desc' },
  });
  return row.devVisible!;
}

afterEach(() => {
  delete process.env.WASL_FAKE_NOW;
});

describe('accounts', () => {
  it('registers guardian with phone after OTP', async () => {
    const code = await otpFor(PHONE);
    const user = await registerGuardian({ identifier: '0501234567', code, name: 'أحمد', password: 'password123' });
    expect(user.role).toBe('GUARDIAN');
    expect(user.phone).toBe(PHONE);
    const again = await login({ identifier: PHONE, password: 'password123' });
    expect(again.id).toBe(user.id);
  });

  it('rejects wrong OTP and locks after 5 attempts', async () => {
    const code = await otpFor(PHONE);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect(await verifyOtp(PHONE, 'REGISTER', wrong)).toBe(false);
    expect(await verifyOtp(PHONE, 'REGISTER', code)).toBe(false);
  });

  it('rate-limits OTP sends', async () => {
    await issueOtp(PHONE, 'REGISTER');
    await issueOtp(PHONE, 'REGISTER');
    await issueOtp(PHONE, 'REGISTER');
    await expect(issueOtp(PHONE, 'REGISTER')).rejects.toBeInstanceOf(RateLimitError);
  });

  it('rejects an expired OTP', async () => {
    const code = await otpFor(PHONE);
    await prisma.otpCode.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await verifyOtp(PHONE, 'REGISTER', code)).toBe(false);
  });

  it('accepts the right code once only', async () => {
    const code = await otpFor(PHONE);
    expect(await verifyOtp(PHONE, 'REGISTER', code)).toBe(true);
    expect(await verifyOtp(PHONE, 'REGISTER', code)).toBe(false);
  });

  it('login rejects wrong password', async () => {
    const code = await otpFor(PHONE);
    await registerGuardian({ identifier: PHONE, code, name: 'x', password: 'password123' });
    await expect(login({ identifier: PHONE, password: 'nope-nope' })).rejects.toBeInstanceOf(InvalidCredentials);
    await expect(login({ identifier: '0509999999', password: 'password123' })).rejects.toBeInstanceOf(InvalidCredentials);
  });

  it('email registration works', async () => {
    const code = await otpFor('a@b.com');
    const user = await registerGuardian({ identifier: ' A@B.com ', code, name: 'x', password: 'password123' });
    expect(user.email).toBe('a@b.com');
    expect(user.phone).toBeNull();
    expect((await login({ identifier: 'a@b.com', password: 'password123' })).id).toBe(user.id);
  });

  it('login accepts a username', async () => {
    const { hashPassword } = await import('../../src/lib/auth/password');
    const u = await prisma.user.create({
      data: { role: 'STAFF', name: 's', username: 'staff1', passwordHash: await hashPassword('password123') },
    });
    expect((await login({ identifier: 'staff1', password: 'password123' })).id).toBe(u.id);
  });

  it('reset password', async () => {
    const code = await otpFor(PHONE);
    await registerGuardian({ identifier: PHONE, code, name: 'x', password: 'oldpassword1' });
    const rcode = await otpFor(PHONE, 'RESET');
    await resetPassword({ identifier: PHONE, code: rcode, password: 'newpassword1' });
    await expect(login({ identifier: PHONE, password: 'oldpassword1' })).rejects.toBeInstanceOf(InvalidCredentials);
    expect((await login({ identifier: PHONE, password: 'newpassword1' })).phone).toBe(PHONE);
  });

  it('session lifetime', async () => {
    const u = await prisma.user.create({ data: { role: 'GUARDIAN', name: 'g', passwordHash: 'h' } });
    const s = await prisma.user.create({ data: { role: 'STAFF', name: 's', passwordHash: 'h' } });
    const gt = await createSession(u.id, 'GUARDIAN');
    const st = await createSession(s.id, 'STAFF');
    const rows = await prisma.session.findMany();
    const byUser = (id: string) => rows.find((r) => r.userId === id)!;
    const day = 86_400_000;
    expect(Math.abs(byUser(u.id).expiresAt.getTime() - (Date.now() + 30 * day))).toBeLessThan(60_000);
    expect(Math.abs(byUser(s.id).expiresAt.getTime() - (Date.now() + 12 * 3_600_000))).toBeLessThan(60_000);
    expect((await getSessionUser(gt))?.id).toBe(u.id);
    expect(await getSessionUser(undefined)).toBeNull();
    expect(await getSessionUser('garbage')).toBeNull();
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await getSessionUser(st)).toBeNull();
  });

  it('locks login after 10 failed attempts even with the right password', async () => {
    const code = await otpFor(PHONE);
    await registerGuardian({ identifier: PHONE, code, name: 'x', password: 'password123' });
    for (let i = 0; i < 10; i++) {
      await expect(login({ identifier: PHONE, password: 'wrong-wrong' })).rejects.toBeInstanceOf(InvalidCredentials);
    }
    await expect(login({ identifier: '0501234567', password: 'password123' })).rejects.toBeInstanceOf(RateLimitError);
  });

  it('parallel wrong OTP guesses cannot exceed the attempt cap', async () => {
    const code = await otpFor(PHONE);
    const wrong = code === '000000' ? '111111' : '000000';
    await Promise.all(Array.from({ length: 10 }, () => verifyOtp(PHONE, 'REGISTER', wrong)));
    const row = await prisma.otpCode.findFirstOrThrow();
    expect(row.attempts).toBe(5);
    expect(await verifyOtp(PHONE, 'REGISTER', code)).toBe(false);
  });

  it('fails closed outside OTP_MODE=dev', async () => {
    const prev = process.env.OTP_MODE;
    delete process.env.OTP_MODE;
    try {
      await expect(issueOtp(PHONE, 'REGISTER')).rejects.toMatchObject({ code: 'OTP_UNAVAILABLE', status: 503 });
      expect(await prisma.otpCode.count()).toBe(0);
    } finally {
      process.env.OTP_MODE = prev;
    }
  });

  it('registering an existing identifier with a wrong code gives the OTP error, not Conflict', async () => {
    const code = await otpFor(PHONE);
    await registerGuardian({ identifier: PHONE, code, name: 'x', password: 'password123' });
    const p = registerGuardian({ identifier: PHONE, code: '123456', name: 'y', password: 'password123' });
    await expect(p).rejects.toBeInstanceOf(ValidationError);
    await expect(p).rejects.not.toBeInstanceOf(Conflict);
  });
});
