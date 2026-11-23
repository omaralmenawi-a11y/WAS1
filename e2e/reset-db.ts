/** Drops and recreates the dedicated e2e database. Refuses any database not named wasl_e2e. */
import { PrismaClient } from '@prisma/client';

const url = new URL(process.env.DATABASE_URL ?? '');
const name = url.pathname.slice(1);
if (name !== 'wasl_e2e') {
  console.error(`reset-db: refusing to reset "${name}"; only wasl_e2e is allowed`);
  process.exit(1);
}
url.pathname = '/postgres';
const admin = new PrismaClient({ datasources: { db: { url: url.toString() } } });
(async () => {
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS wasl_e2e WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE wasl_e2e`);
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => admin.$disconnect());
