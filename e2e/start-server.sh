#!/usr/bin/env bash
# Playwright webServer entry: reset + migrate + seed the dedicated e2e database, then start the dev server.
# Env (DATABASE_URL, PORT, OTP_MODE, WASL_FAKE_NOW) is supplied by playwright.config.ts.
set -euo pipefail
cd "$(dirname "$0")/.."
npx tsx e2e/reset-db.ts
npx prisma migrate deploy
npx tsx prisma/seed.ts
exec npm run dev
