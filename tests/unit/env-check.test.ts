import { describe, expect, it } from 'vitest';
import { checkProductionEnv } from '../../src/lib/env-check';
import { assertPickupCodeSecret } from '../../src/lib/pickup/code';

const GOOD = 'x'.repeat(32);
const prod = (env: Record<string, string | undefined>) => checkProductionEnv({ NODE_ENV: 'production', ...env });

describe('checkProductionEnv', () => {
  it('passes a sound production env', () => {
    expect(prod({ PICKUP_CODE_SECRET: GOOD, OTP_MODE: 'sms' })).toEqual({ errors: [], warnings: [] });
  });

  it('refuses a missing, short or placeholder pickup secret', () => {
    for (const s of [undefined, '', 'x'.repeat(31), 'change-me-32-bytes-minimum-aaaaaaaaaa']) {
      const r = prod({ PICKUP_CODE_SECRET: s });
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toContain('PICKUP_CODE_SECRET');
    }
  });

  it('refuses OTP_MODE=dev unless ALLOW_DEV_OTP_IN_PRODUCTION=1, which only warns', () => {
    const r = prod({ PICKUP_CODE_SECRET: GOOD, OTP_MODE: 'dev' });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('OTP_MODE=dev');
    expect(prod({ PICKUP_CODE_SECRET: GOOD, OTP_MODE: 'dev', ALLOW_DEV_OTP_IN_PRODUCTION: 'true' }).errors).toHaveLength(1);
    const allowed = prod({ PICKUP_CODE_SECRET: GOOD, OTP_MODE: 'dev', ALLOW_DEV_OTP_IN_PRODUCTION: '1' });
    expect(allowed.errors).toEqual([]);
    expect(allowed.warnings[0]).toContain('OTP_MODE=dev');
  });

  it('reports every problem at once', () => {
    expect(prod({ OTP_MODE: 'dev' }).errors).toHaveLength(2);
  });

  it('checks nothing outside production', () => {
    expect(checkProductionEnv({ NODE_ENV: 'development', OTP_MODE: 'dev' })).toEqual({ errors: [], warnings: [] });
    expect(checkProductionEnv({})).toEqual({ errors: [], warnings: [] });
  });
});

describe('assertPickupCodeSecret (startup, all modes)', () => {
  it('throws when the secret is missing', () => {
    expect(() => assertPickupCodeSecret({})).toThrow('PICKUP_CODE_SECRET');
    expect(() => assertPickupCodeSecret({ PICKUP_CODE_SECRET: 'dev-secret' })).not.toThrow();
  });
});
