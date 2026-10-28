import { defineConfig } from 'vitest/config';

// main 에는 electron·node-pty 네이티브가 섞여 있어 여기서는 부작용 없는 순수 모듈만 돈다(§4 chat 브리지의 `policy`·`cards`·`commands`·`strings`).
// 판정을 electron 에 붙이면 영영 검증되지 않는다 — 그래서 순수 모듈로 따로 둔다.
export default defineConfig({
  test: {
    include: ['src/main/**/*.test.ts'],
    environment: 'node',
  },
});
