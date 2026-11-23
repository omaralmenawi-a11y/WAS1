import { defineConfig } from 'vitest/config';
import path from 'node:path';
import 'dotenv/config';

const alias = { '@': path.resolve(__dirname, 'src') };

export default defineConfig({
  test: {
    fileParallelism: false, // integration tests share one database
    projects: [
      {
        resolve: { alias },
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['tests/integration/global-setup.ts'],
          setupFiles: ['tests/integration/setup.ts'],
          env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? '' },
        },
      },
    ],
  },
});
