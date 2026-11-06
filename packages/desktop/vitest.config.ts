import { defineConfig } from 'vitest/config';

// main 에는 electron·node-pty 네이티브가 섞여 있어 여기서는 부작용 없는 순수 모듈만 돈다(§4 chat 브리지의 `policy`·`cards`·`commands`·`strings`).
// 판정을 electron 에 붙이면 영영 검증되지 않는다 — 그래서 순수 모듈로 따로 둔다.
// 가짜 엔진 계약 시험은 앱을 띄우지 않으므로 여기서 세 OS 단위 시험과 함께 돈다(앱 통째 스모크는 vitest.e2e.config.ts).
export default defineConfig({
  test: {
    include: ['src/main/**/*.test.ts', 'e2e/fake-engine/**/*.test.ts'],
    environment: 'node',
  },
});
