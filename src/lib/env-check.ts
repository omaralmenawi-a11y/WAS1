// Pure startup checks for server.ts. No Next.js imports (loaded before next().prepare()).

type Env = Record<string, string | undefined>;
export type EnvCheck = { errors: string[]; warnings: string[] };

const MIN_SECRET = 32;

/** Production refuses to start with a weak pickup-code secret or with dev OTP (unless explicitly allowed). */
export function checkProductionEnv(env: Env): EnvCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (env.NODE_ENV !== 'production') return { errors, warnings };

  const secret = env.PICKUP_CODE_SECRET ?? '';
  if (!secret) errors.push('PICKUP_CODE_SECRET is not set');
  else if (secret.length < MIN_SECRET) errors.push(`PICKUP_CODE_SECRET must be at least ${MIN_SECRET} characters`);
  else if (secret.startsWith('change-me')) errors.push('PICKUP_CODE_SECRET still has the placeholder value from .env.example');

  if (env.OTP_MODE === 'dev') {
    if (env.ALLOW_DEV_OTP_IN_PRODUCTION === '1') {
      warnings.push('OTP_MODE=dev in production: OTP codes are NOT sent; they are logged and shown on /admin. Never use this with real users.');
    } else {
      errors.push('OTP_MODE=dev is not allowed in production (set ALLOW_DEV_OTP_IN_PRODUCTION=1 only for a demo)');
    }
  }
  return { errors, warnings };
}
