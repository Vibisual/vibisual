/// <reference types="vite/client" />

/**
 * 테스트 전용 가상 모듈 — CSS 원문을 문자열로 준다(`vitest.config.ts` 의 `vibisual:css-source`).
 * 규칙이 CSS 에 사는 경우(§5.5 ⑤-3 언어별 글꼴 스택)를 테스트로 못 박기 위한 통로이며,
 * 앱 번들에는 들어가지 않는다(테스트에서만 import 한다).
 */
declare module 'virtual:vibisual-css-source/*' {
  const source: string;
  export default source;
}
