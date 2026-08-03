/**
 * §5.11 v4.29 — 카드 한 장의 실패를 그 카드 안에 가두는 판단 — 순수 함수.
 *
 * 실패는 **두 단계**에서 온다.
 *  ① 호스트가 `match`·`severity`·`render` 를 부르는 순간. 이건 슬롯 자신의 `useMemo` 안이라
 *     에러 바운더리가 못 잡는다 — 예외가 슬롯의 렌더 단계에서 올라가 **호스트를 통째로 무너뜨린다.**
 *  ② 만들어진 노드를 React 가 그리는 순간. 이건 바운더리가 잡는다.
 *
 * 두 경로가 같은 창구로 보고하도록 로그를 여기에 모으고, 컴포넌트(`PluginErrorBoundary.tsx`)는
 * 이 모듈을 가져다 쓴다.
 */

/** 같은 카드가 매 렌더마다 콘솔을 채우지 않도록 id 당 한 번만 남긴다. */
const reported = new Set<string>();

export function reportPluginFailure(pluginId: string, error: unknown, detail?: string): void {
  if (reported.has(pluginId)) return;
  reported.add(pluginId);
  console.error(`[plugins] ${pluginId} 카드가 렌더 중 실패해 이 자리에서 제외했습니다`, error, detail);
}

/** 테스트 전용 — 보고 기록을 비운다. */
export function resetPluginFailureLog(): void {
  reported.clear();
}

/**
 * 기여 하나를 만들어 본다. 던지면 그 카드만 빠지고 나머지는 그대로 그린다.
 * `null` 은 "이 컨텍스트에는 붙지 않는다"와 "만들다 실패했다"를 함께 뜻한다 — 호스트는 둘 다 똑같이 건너뛴다.
 */
export function tryBuild<T>(pluginId: string, build: () => T | null): T | null {
  try {
    return build();
  } catch (error) {
    reportPluginFailure(pluginId, error);
    return null;
  }
}
