import { beforeEach, describe, expect, it } from 'vitest';
import type { UserDefaults } from '@vibisual/shared';

import { useGraphStore } from './graphStore.js';

/**
 * §4 — **저장한 값이 되돌아오던 자리.**
 *
 * 사용자 옵션은 두 통로로 들어온다: 즉시 적용되는 WS `user_defaults_updated` 와, 배치 타이머에
 * 모였다 나중에 풀리는 `graph_snapshot`(useWebSocket 의 `flushSnapshot`). 에이전트가 돌고 있으면
 * 스냅샷이 계속 흐르므로 **저장 직전에 버퍼에 들어간 스냅샷이 저장 직후에 풀려** 옛 값을 다시
 * 얹었고, Options 창의 재시드 effect 가 폼을 옛 값으로 되돌렸다 — 디스크에는 저장됐는데 화면은
 * 원래대로 돌아오니 사용자에게는 **저장 실패**로 보였다(돌고 있는 것이 없으면 재현되지 않는다).
 *
 * `updatedAt` 역행을 버리는 것이 그 사슬을 끊는 한 줄이다.
 */
function defaults(updatedAt: number, autoCompact: string): UserDefaults {
  return { updatedAt, agentConfig: { autoCompact } } as UserDefaults;
}

describe('applyUserDefaults — 늦게 도착한 옛 값 막기', () => {
  beforeEach(() => {
    useGraphStore.setState({ userDefaults: null });
  });

  it('처음 오는 값은 그대로 앉는다', () => {
    useGraphStore.getState().applyUserDefaults(defaults(100, '400000'));
    expect(useGraphStore.getState().userDefaults?.agentConfig?.autoCompact).toBe('400000');
  });

  it('더 새 값은 덮는다', () => {
    useGraphStore.getState().applyUserDefaults(defaults(100, '400000'));
    useGraphStore.getState().applyUserDefaults(defaults(200, '200000'));
    expect(useGraphStore.getState().userDefaults?.agentConfig?.autoCompact).toBe('200000');
  });

  it('뒤늦게 풀린 옛 스냅샷은 방금 저장한 값을 덮지 못한다', () => {
    // 사용자가 Apply → 서버 응답을 그 자리에서 앉힌다.
    useGraphStore.getState().applyUserDefaults(defaults(200, '200000'));
    // 저장 직전에 버퍼에 들어가 있던 스냅샷이 이제야 풀린다.
    useGraphStore.getState().applyUserDefaults(defaults(100, '400000'));
    expect(useGraphStore.getState().userDefaults?.agentConfig?.autoCompact).toBe('200000');
    expect(useGraphStore.getState().userDefaults?.updatedAt).toBe(200);
  });

  it('같은 시각이면 통과시킨다 — 내용이 같은 재전송이라 막을 이유가 없다', () => {
    useGraphStore.getState().applyUserDefaults(defaults(200, '200000'));
    useGraphStore.getState().applyUserDefaults(defaults(200, '100000'));
    expect(useGraphStore.getState().userDefaults?.agentConfig?.autoCompact).toBe('100000');
  });

  it('undefined 는 종전대로 비운다(가드가 이 경로를 바꾸지 않는다)', () => {
    useGraphStore.getState().applyUserDefaults(defaults(200, '200000'));
    useGraphStore.getState().applyUserDefaults(undefined);
    expect(useGraphStore.getState().userDefaults).toBeNull();
  });
});
