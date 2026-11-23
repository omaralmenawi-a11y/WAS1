import { describe, expect, it } from 'vitest';
import { checkPickupCode, parseQr, pickupCode, qrPayload } from '../../src/lib/pickup/code';

const S = 'test-secret';
process.env.PICKUP_CODE_SECRET = S;
const t0 = new Date('2026-11-23T10:00:00Z');
const plus = (d: Date, s: number) => new Date(d.getTime() + s * 1000);

describe('pickup code', () => {
  it('is 6 digits and stable within a window', () => {
    const c = pickupCode('r1', t0, S);
    expect(c).toMatch(/^\d{6}$/);
    expect(pickupCode('r1', plus(t0, 59), S)).toBe(c);
  });
  it('differs across requests and windows', () => {
    expect(pickupCode('r1', t0, S)).not.toBe(pickupCode('r2', t0, S));
    expect(pickupCode('r1', t0, S)).not.toBe(pickupCode('r1', plus(t0, 60), S));
  });
  it('accepts current and previous window, rejects two windows old', () => {
    const c = pickupCode('r1', t0, S);
    expect(checkPickupCode('r1', c, plus(t0, 10))).toBe(true);
    expect(checkPickupCode('r1', c, plus(t0, 70))).toBe(true);
    expect(checkPickupCode('r1', c, plus(t0, 130))).toBe(false);
    expect(checkPickupCode('r2', c, t0)).toBe(false);
  });
  it('qr round-trips; garbage is null', () => {
    const q = qrPayload('req_1', t0);
    expect(q.startsWith('WASL1:req_1:')).toBe(true);
    expect(parseQr(q)).toEqual({ requestId: 'req_1', code: pickupCode('req_1', t0) });
    for (const g of ['', 'hello', 'WASL1:', 'WASL1:a:b', 'WASL2:a:123456', 'WASL1::123456', 'WASL1:a:123456:x']) expect(parseQr(g)).toBeNull();
  });
});
