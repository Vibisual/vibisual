/**
 * hookMatcher.ts — §5.5 #17-32 ⑤: "방금 울린 이벤트가 이 훅 줄에 걸리는가".
 *
 * Claude Code 는 `hooks.<이벤트>[].matcher` 를 **도구 이름에 대한 정규식**으로 대조한다.
 * 서버가 보내는 발동 신호(`HookFiredPayload`)에는 이벤트 이름과 도구 이름만 실리므로, 어느
 * 줄에 불을 켤지는 이 함수 하나가 정한다 — 화면과 계측이 같은 규칙을 쓰게 순수 함수로 뽑았다.
 *
 * 규칙(실측 기준):
 *  · matcher 가 없거나 빈 문자열이거나 `*` → 그 이벤트의 **모든** 호출에 걸린다.
 *  · 도구 이름이 없는 이벤트(`Stop`·`SessionStart`·`UserPromptSubmit` …) → matcher 는 무의미하다.
 *    그 자리에 뭔가 적혀 있어도 이벤트 이름만 같으면 걸린 것으로 본다(적힌 쪽이 잘못이지
 *    우리가 불을 끄고 있을 일이 아니다).
 *  · 그 외에는 **완전 일치 정규식**으로 본다(`Edit` 가 `MultiEdit` 을 삼키지 않도록 앵커를 건다).
 *    깨진 정규식은 문자열 그대로 비교로 떨어진다 — 던지지 않는다.
 */

/** matcher 가 "전부" 를 뜻하는가. */
export function isWildcardHookMatcher(matcher: string | undefined): boolean {
  const m = (matcher ?? '').trim();
  return m.length === 0 || m === '*';
}

/**
 * 이 matcher 가 그 도구 이름에 걸리는가.
 *
 * @param matcher  설정에 적힌 대조 문자열(없을 수 있다)
 * @param toolName 그 순간의 도구 이름. 도구가 없는 이벤트면 undefined
 */
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
