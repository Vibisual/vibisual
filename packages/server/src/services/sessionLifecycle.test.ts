/** §9 「창이 뜬 직후의 메인 스레드」 ③ — 죽은 세션은 다 걷은 뒤 `onDeadSettled` 한 번(저장 한 번)으로 마무리한다(세션마다 저장하면 부팅 직후 창이 안 끌린다). */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./sessionDiscovery.js', () => ({
  readAliveSessionIds: vi.fn(() => new Set(['alive-1'])),
  findEntrypointBySession: vi.fn(() => null),
}));
vi.mock('./jsonlWatcher.js', () => ({
  JsonlWatcher: class {
    start(): void { /* 시험에서는 감시하지 않는다 */ }
    stop(): void { /* 시험에서는 감시하지 않는다 */ }
  },
}));
// 진단 로그는 사용자 디스크에 쓴다 — 시험에서는 막는다.
vi.mock('./debugLog.js', () => ({ dbg: vi.fn(), dbgOnChange: vi.fn(() => false) }));

import { SessionLifecycleManager, type LifecycleCallbacks } from './sessionLifecycle.js';

function rig(bubbles: string[]) {
  const calls: string[] = [];
  const callbacks: LifecycleCallbacks = {
    onDead: (sessionId) => { calls.push(`dead:${sessionId}`); },
    onDeadSettled: () => { calls.push('settled'); },
    onVSCodeClosed: () => { /* 호출되지 않는 옛 콜백 */ },
    onMetaChange: () => { /* 이 시험과 무관 */ },
    listAgentSessionIds: () => bubbles,
  };
  const manager = new SessionLifecycleManager(callbacks);
  // 주기 한 번을 직접 돌린다(타이머를 흉내 내지 않는다).
  const poll = (): Promise<void> => (manager as unknown as { pollOnce(): Promise<void> }).pollOnce();
  return { calls, poll };
}

describe('끝난 세션 정리 — 주기마다 한 번 마무리', () => {
  it('죽은 세션을 다 걷은 뒤 마무리를 한 번 부른다(세션마다가 아니다)', async () => {
    const { calls, poll } = rig(['dead-1', 'alive-1', 'dead-2', 'dead-3']);
    await poll();
    expect(calls).toEqual(['dead:dead-1', 'dead:dead-2', 'dead:dead-3', 'settled']);
  });

  it('걷은 것이 없으면 마무리를 부르지 않는다(그 주기에는 저장할 것이 없다)', async () => {
    const { calls, poll } = rig(['alive-1']);
    await poll();
    expect(calls).toEqual([]);
  });

  it('마무리 콜백이 없는 옛 호출자도 그대로 돈다', async () => {
    const calls: string[] = [];
    const manager = new SessionLifecycleManager({
      onDead: (sessionId) => { calls.push(sessionId); },
      onVSCodeClosed: () => { /* 옛 콜백 */ },
      onMetaChange: () => { /* 무관 */ },
      listAgentSessionIds: () => ['dead-1'],
    });
    await (manager as unknown as { pollOnce(): Promise<void> }).pollOnce();
    expect(calls).toEqual(['dead-1']);
  });
});
