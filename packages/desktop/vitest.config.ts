import { defineConfig } from 'vitest/config';

// main 프로세스에는 electron·node-pty 같은 네이티브가 섞여 있어 전부를 테스트로 끌어올 수 없다.
// 그래서 여기서 도는 것은 **부작용 없는 순수 모듈**뿐이다(§4 chat 브리지의 `policy`·`cards`·
// `commands`·`strings`). 그것들이 따로 있는 이유이기도 하다 — 판정이 electron 에 붙어 있으면
// 영영 검증되지 않는다.
export default defineConfig({
  test: {
    include: ['src/main/**/*.test.ts'],
    environment: 'node',
  },
});
