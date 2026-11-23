import { createPlatformAdmin } from '../src/lib/admin/schools';
import { AppError } from '../src/lib/errors';
import { prisma } from '../src/lib/db';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const username = arg('username');
  const password = arg('password');
  if (!username || !password) {
    console.error('Usage: npm run create-platform-admin -- --username X --password Y');
    process.exit(2);
  }
  try {
    const u = await createPlatformAdmin(username, password);
    console.log(`Platform admin created: ${u.username}`);
  } catch (e) {
    if (e instanceof AppError) {
      console.error(`${e.code}: ${e.messageAr}`);
      process.exitCode = 1;
    } else throw e;
  } finally {
    await prisma.$disconnect();
  }
}
main();
