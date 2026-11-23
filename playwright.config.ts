import { defineConfig } from '@playwright/test';
import 'dotenv/config';

const PORT = 3107;

/** Next Sunday 12:00 Asia/Riyadh (= 09:00Z; Riyadh has no DST). Inside the seeded pickup window. */
export function fakeNow(from = new Date()): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1, 9, 0, 0));
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
    launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium' },
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
      APP_URL: `http://localhost:${PORT}`,
    },
  },
});
