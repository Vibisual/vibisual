import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * `virtual:vibisual-css-source/<이름>` — **CSS 원문을 테스트에 그대로 넘겨 주는 통로**(`src/<이름>.css`).
 *
 * 규칙 중에는 컴포넌트가 아니라 CSS 에 사는 것이 있다(§5.5 ⑤-3 글꼴 스택 — 언어별 폴백 차례).
 * 그런데 테스트에서는 `import '../index.css?raw'` 도 `import.meta.glob(?raw)` 도 **빈 문자열**이
 * 온다(실측 길이 0) — `.css` 는 Tailwind 플러그인과 vitest 의 CSS 스텁을 차례로 지나며 원문이
 * 사라지기 때문이다. 클라이언트 tsconfig 에는 Node 타입이 없어 테스트가 `node:fs` 로 직접 열 수도
 * 없다(`typographyFloor.test.ts` 와 같은 제약). 그래서 **설정 파일이 대신 읽어 넘긴다** — 설정은
 * Node 에서 돌고 tsc 대상도 아니므로 두 제약을 함께 비켜 간다.
 */
function cssSourcePlugin(): Plugin {
  const PREFIX = 'virtual:vibisual-css-source/';
  return {
    name: 'vibisual:css-source',
    resolveId(id) {
      return id.startsWith(PREFIX) ? `\0${id}` : null;
    },
    load(id) {
      if (!id.startsWith(`\0${PREFIX}`)) return null;
      // 이름에 `.css` 확장자를 붙이지 말 것 — vitest 는 id 의 확장자만 보고 CSS 를 가려내 빈 모듈로
      //   바꿔치므로, 가상 모듈이어도 이름이 `.css` 로 끝나면 그대로 삼켜진다(실측 길이 0).
      const name = id.slice(PREFIX.length + 1);
      return `export default ${JSON.stringify(readFileSync(join(HERE, 'src', `${name}.css`), 'utf8'))};`;
    },
  };
}

/**
 * 테스트 전용 vite 설정. 앱 설정(`vite.config.ts`)의 dev 서버·프록시는 테스트가 안 쓰므로 옮겨
 * 오지 않고, Tailwind 플러그인도 넣지 않는다(테스트는 컴파일된 CSS 를 보지 않는다).
 */
export default defineConfig({
  plugins: [react(), cssSourcePlugin()],
});
