/**
 * §5.11 — 카드 실패를 가두는 판단(순수 함수). 실패는 두 단계에서 온다: ① 호스트가 `match`·`severity`·`render` 를 부를 때
 * — 슬롯 `useMemo` 안이라 에러 바운더리가 못 잡는다 ② React 가 그릴 때 — `PluginErrorBoundary.tsx` 가 잡는다. 두 경로의 로그를 여기 모은다.
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

/** 던지면 그 카드만 빠진다. `null` = 이 컨텍스트에 안 붙음 또는 만들다 실패 — 호스트는 둘 다 건너뛴다. */
export function tryBuild<T>(pluginId: string, build: () => T | null): T | null {
  try {
    return build();
  } catch (error) {
    reportPluginFailure(pluginId, error);
    return null;
  }
}
