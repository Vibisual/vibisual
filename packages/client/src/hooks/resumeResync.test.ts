import { describe, expect, it } from 'vitest';

import {
  installResumeWatch,
  RESUME_RESYNC_DEBOUNCE_MS,
  RESUME_RESYNC_HIDDEN_MS,
  shouldResyncOnResume,
  type ResumeResyncInput,
} from './resumeResync.js';

/**
 * §4 v3.16 모바일 웹 — 폰 화면을 껐다 켰을 때 **다시 붙을지** 판정을 못 박는다.
 *
 * 화면이 꺼진 사이 소켓은 `onclose` 없이 죽은 채 OPEN 으로 남는다. 그래서 오래 숨어 있었으면 OPEN 이라도
 * 믿지 않고 새로 붙어야 하고, 반대로 잠깐 가렸다 돌아온 경우·통합 앱(IPC 전송)은 전체 스냅샷을 다시 받을
 * 까닭이 없다.
 */

function input(over: Partial<ResumeResyncInput> = {}): ResumeResyncInput {
  return {
    trigger: 'visible',
    packaged: false,
    hiddenForMs: 10 * 60_000,
    socketState: 'open',
    sinceLastResyncMs: Number.MAX_SAFE_INTEGER,
    ...over,
  };
}

describe('화면 복귀 새로고침 판정 (§4 v3.16)', () => {
  it('오래 숨어 있다 돌아오면 소켓이 OPEN 이라도 다시 붙는다', () => {
    // 사용자 보고의 그 경우 — 화면을 끄고 10분 뒤. 소켓은 OPEN 으로 적혀 있지만 죽어 있다.
    expect(shouldResyncOnResume(input())).toBe(true);
  });

  it('잠깐 가렸다 돌아오면 살아 있는 소켓을 그대로 둔다', () => {
    expect(shouldResyncOnResume(input({ hiddenForMs: 5_000 }))).toBe(false);
    expect(shouldResyncOnResume(input({ hiddenForMs: RESUME_RESYNC_HIDDEN_MS - 1 }))).toBe(false);
  });

  it('문턱과 같은 시간이면 다시 붙는다', () => {
    expect(shouldResyncOnResume(input({ hiddenForMs: RESUME_RESYNC_HIDDEN_MS }))).toBe(true);
  });

  it('잠깐이라도 이미 끊겨 있으면 지금 붙는다 — 늘어난 backoff 나 다 쓴 재시도를 기다리지 않는다', () => {
    expect(shouldResyncOnResume(input({ hiddenForMs: 1_000, socketState: 'closed' }))).toBe(true);
  });

  it('붙는 중인 소켓은 짧게 가렸다 돌아왔을 때 건드리지 않는다', () => {
    expect(shouldResyncOnResume(input({ hiddenForMs: 1_000, socketState: 'connecting' }))).toBe(false);
  });

  it('얼었다 풀림·캐시 복귀·망 복귀는 숨은 시간과 무관하게 다시 붙는다', () => {
    for (const trigger of ['frozen-resumed', 'pageshow-restored', 'online'] as const) {
      expect(shouldResyncOnResume(input({ trigger, hiddenForMs: 0 }))).toBe(true);
    }
  });

  it('통합 앱(IPC 전송)은 어떤 신호에도 다시 붙지 않는다', () => {
    for (const trigger of ['visible', 'frozen-resumed', 'pageshow-restored', 'online'] as const) {
      expect(shouldResyncOnResume(input({ trigger, packaged: true, socketState: 'closed' }))).toBe(false);
    }
  });

  it('복귀 신호가 한꺼번에 여럿 와도 한 번만 붙는다', () => {
    expect(shouldResyncOnResume(input({ trigger: 'online', sinceLastResyncMs: 300 }))).toBe(false);
    expect(shouldResyncOnResume(input({ sinceLastResyncMs: RESUME_RESYNC_DEBOUNCE_MS - 1 }))).toBe(false);
    expect(shouldResyncOnResume(input({ sinceLastResyncMs: RESUME_RESYNC_DEBOUNCE_MS }))).toBe(true);
  });

  it('DOM 이 없는 곳에서는 아무것도 걸지 않고 해제 함수만 돌려준다', () => {
    const off = installResumeWatch(() => {
      throw new Error('불리면 안 된다');
    });
    expect(typeof off).toBe('function');
    off();
  });
});
