import { afterEach, beforeEach } from 'vitest';
import { prisma } from '../../src/lib/db';
import { flushNotifications } from '../../src/lib/notify';

export async function resetDb() {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

beforeEach(async () => {
  await resetDb();
});

// Background notifications must not outlive their test (the next test truncates the tables).
afterEach(async () => {
  await flushNotifications();
});
