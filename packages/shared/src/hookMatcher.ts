/**
 * §5.5 #17-32 ⑤ — 울린 이벤트가 이 훅 줄에 걸리나(`matcher` = 도구 이름 정규식, 화면·계측 공용). 규칙(실측):
 * matcher 없음·빈 문자열·`*` → 전부 · 도구 없는 이벤트(`Stop` 등)는 이벤트만 같으면 걸림 · 그 외 완전 일치(앵커 — `Edit` ≠ `MultiEdit`), 깨진 정규식은 문자열 비교.
 */

/** matcher 가 "전부" 를 뜻하는가. */
export function isWildcardHookMatcher(matcher: string | undefined): boolean {
  const m = (matcher ?? '').trim();
  return m.length === 0 || m === '*';
}

/** @param toolName 그 순간의 도구 이름 — 도구가 없는 이벤트면 undefined. */
export function hookMatcherMatches(matcher: string | undefined, toolName: string | undefined): boolean {
  if (isWildcardHookMatcher(matcher)) return true;
  // 도구가 없는 이벤트에서는 대조할 대상 자체가 없다 — 이벤트가 같으면 걸린 것이다.
  if (!toolName) return true;

  const m = (matcher ?? '').trim();
  if (m === toolName) return true;

  try {
    // 앵커를 걸어 부분 일치를 막는다(`Edit` ≠ `MultiEdit`). `Edit|Write` 같은 파이프도
    // 그룹으로 감싸야 두 갈래 모두에 앵커가 걸린다.
    return new RegExp(`^(?:${m})$`).test(toolName);
  } catch {
    // 정규식으로 못 읽는 문자열은 위에서 이미 문자열 비교를 마쳤다.
    return false;
  }
}
