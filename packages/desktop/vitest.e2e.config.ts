import { defineConfig } from 'vitest/config';

// 앱 통째 스모크 — 빌드된 앱(out/)을 격리된 사용자로 띄운다. 단위 시험(vitest.config.ts)과 섞지 않는다:
// 빌드가 필요하고, 창 하나가 한 번에 하나씩만 돌아야 한다(같은 시나리오가 끄고 다시 켠다).
export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 120_000,
    reporters: ['verbose'],
  },
});
