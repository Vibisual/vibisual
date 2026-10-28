/// <reference types="vite/client" />

/**
 * 테스트 전용 가상 모듈 — CSS 원문을 문자열로 준다(`vitest.config.ts` 의 `vibisual:css-source`). CSS 에 사는 규칙(§5.5 ⑤-3 언어별 글꼴 스택)을
 * 시험으로 못 박는 통로이며 앱 번들에는 안 들어간다.
 */
declare module 'virtual:vibisual-css-source/*' {
  const source: string;
  export default source;
}
