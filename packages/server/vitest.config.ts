import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
    // better-sqlite3 native binding이 ESM 컨텍스트에서 문제 없도록 pool 제한
    pool: 'forks',
  },
});
