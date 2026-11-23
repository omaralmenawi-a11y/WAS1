import { createHmac } from 'node:crypto';

/** Called by server.ts at startup so a missing secret fails the boot, not the first pickup. */
export function assertPickupCodeSecret(env: Record<string, string | undefined> = process.env): void {
  if (!env.PICKUP_CODE_SECRET) throw new Error('PICKUP_CODE_SECRET is not set');
}

function secretOf(): string {
  assertPickupCodeSecret();
  return process.env.PICKUP_CODE_SECRET!;
}

const windowOf = (at: Date) => Math.floor(at.getTime() / 1000 / 60);

function codeFor(requestId: string, win: number, secret: string): string {
  const mac = createHmac('sha256', secret).update(`${requestId}:${win}`).digest();
  return String(mac.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

export function pickupCode(requestId: string, at: Date, secret: string = secretOf()): string {
  return codeFor(requestId, windowOf(at), secret);
}

/** Accepts the current and the previous 60-second window. */
export function checkPickupCode(requestId: string, code: string, at: Date): boolean {
  const secret = secretOf();
  const w = windowOf(at);
  return codeFor(requestId, w, secret) === code || codeFor(requestId, w - 1, secret) === code;
}

export function qrPayload(requestId: string, at: Date): string {
  return `WASL1:${requestId}:${pickupCode(requestId, at)}`;
}

export function parseQr(s: string): { requestId: string; code: string } | null {
  const m = /^WASL1:([A-Za-z0-9_-]+):(\d{6})$/.exec(s);
  return m ? { requestId: m[1], code: m[2] } : null;
}
