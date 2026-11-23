import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/db';

/** Runs the seed against the test database; returns stdout + stderr. */
function runSeed(env: Record<string, string>, args: string[] = []): string {
  const r = spawnSync('node_modules/.bin/tsx', ['prisma/seed.ts', ...args], {
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL!, ...env },
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`seed failed (${r.status}): ${r.stderr}`);
  return r.stdout + r.stderr;
}

describe('demo seed', () => {
  it('with --force in production keeps every seeded account on a temporary password and warns', async () => {
    const out = runSeed({ NODE_ENV: 'production' }, ['--force']);
    expect(out).toContain('WARNING');
    const users = await prisma.user.findMany({ where: { username: { in: ['root', 'admin', 'noura'] } } });
    expect(users).toHaveLength(3);
    expect(users.every((u) => u.mustChangePassword)).toBe(true);
  }, 60_000);

  it('outside production the demo accounts are ready to use', async () => {
    runSeed({ NODE_ENV: 'development' });
    const users = await prisma.user.findMany({ where: { username: { in: ['root', 'admin', 'noura'] } } });
    expect(users).toHaveLength(3);
    expect(users.every((u) => !u.mustChangePassword)).toBe(true);
  }, 60_000);
});
