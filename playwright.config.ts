import { defineConfig } from '@playwright/test';
import 'dotenv/config';

const PORT = 3107;

/**
 * Next Sunday 11:45 Asia/Riyadh (= 08:45Z; Riyadh has no DST). 15 minutes before the first seeded dismissal (12:00), so the
 * reminder fires for the first sibling; still inside both siblings' pickup windows (open 60 min before 12:00 / 12:30).
 */
export function fakeNow(from = new Date()): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1, 8, 45, 0));
  while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/** Dedicated database: same server as DATABASE_URL, database name wasl_e2e (it is reset on every run). */
function e2eDbUrl(): string {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  const base = process.env.DATABASE_URL ?? 'postgresql://wasl:wasl@localhost:5432/wasl_dev';
  const u = new URL(base);
  u.pathname = '/wasl_e2e';
  return u.toString();
}

const FAKE_NOW = fakeNow().toISOString();
process.env.WASL_FAKE_NOW = FAKE_NOW; // read by the spec
process.env.E2E_BASE_URL = `http://localhost:${PORT}`;
const DB = e2eDbUrl();
process.env.E2E_DATABASE_URL_RESOLVED = DB;

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'ar-SA',
    trace: 'off',
    // Only override the browser when PW_CHROMIUM_PATH is set (e.g. sandbox); otherwise use Playwright's own Chromium.
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
  },
  webServer: {
    command: 'bash e2e/start-server.sh',
    url: `http://localhost:${PORT}/login`,
    timeout: 240_000,
    reuseExistingServer: false,
    stdout: 'pipe',
    env: {
      DATABASE_URL: DB,
      PORT: String(PORT),
      OTP_MODE: 'dev',
      NODE_ENV: 'development',
      WASL_FAKE_NOW: FAKE_NOW,
      NOTIFY_TICK_MS: '2000',
      APP_URL: `http://localhost:${PORT}`,
    },
  },
});
