import { beforeEach, describe, expect, it } from 'vitest';
import type { UserDefaults } from '@vibisual/shared';

import { useGraphStore } from './graphStore.js';

/** §4 — 저장한 옵션 값이 되돌아오지 않는다: 배치 뒤에 풀리는 `graph_snapshot` 이 저장 직전 값을 다시 얹지 못하게 `updatedAt` 역행을 버린다. */
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
