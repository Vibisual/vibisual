/**
 * §5.19 (H) 권한 모드 → 도구 처리. **CLI 가 대신 해 주던 몫을 우리가 진다.**
 *
 * 클로드 경로는 `plan` 과 `auto` 를 통과시킨다 — 실행 차단은 CLI 가, 분류는 CLI 모델이 하기
 * 때문이다. 로컬에는 그 CLI 가 없다. 같은 표를 그대로 베끼면 **아무도 안 막는** 구멍이 된다.
 *
 * 조건은 셋 — **읽기는 묻지 않을 것**, **plan 은 바꾸는 것을 막을 것**(계획 모드인데 파일이
 * 바뀌면 그건 사고다), **모르는 도구를 안전한 쪽으로 넘겨짚지 말 것**(가변으로 본다).
 */
import { describe, it, expect } from 'vitest';
import { resolveLocalToolGate, LOCAL_READ_ONLY_TOOLS, LOCAL_TOOL_NAMES } from '@vibisual/shared';

describe('읽기 전용 도구는 어떤 모드에서도 묻지 않는다', () => {
  it('모든 모드에서 allow', () => {
    for (const tool of LOCAL_READ_ONLY_TOOLS) {
      for (const mode of ['default', 'acceptEdits', 'bypassPermissions', 'dontAsk', 'auto', 'plan', undefined]) {
        expect(resolveLocalToolGate(mode, tool)).toBe('allow');
      }
    }
  });
});

describe('가변 도구 — 모드가 판정한다', () => {
  it('default 는 묻는다', () => {
    expect(resolveLocalToolGate('default', 'Write')).toBe('ask');
    expect(resolveLocalToolGate(undefined, 'Bash')).toBe('ask');
  });

  it('bypassPermissions 는 묻지 않는다', () => {
    expect(resolveLocalToolGate('bypassPermissions', 'Write')).toBe('allow');
    expect(resolveLocalToolGate('bypassPermissions', 'Bash')).toBe('allow');
  });

  it('plan 은 바꾸는 것을 막는다 — CLI 가 하던 차단을 우리가 한다', () => {
    expect(resolveLocalToolGate('plan', 'Write')).toBe('deny');
    expect(resolveLocalToolGate('plan', 'Edit')).toBe('deny');
    expect(resolveLocalToolGate('plan', 'Bash')).toBe('deny');
    // 다만 읽기는 계획을 세우는 데 필요하다.
    expect(resolveLocalToolGate('plan', 'Read')).toBe('allow');
  });

  it('dontAsk 는 묻지 않고 거절한다 — 사람 없는 무인 실행', () => {
    expect(resolveLocalToolGate('dontAsk', 'Write')).toBe('deny');
  });

  it('acceptEdits 는 편집만 자동 승인하고 나머지는 묻는다', () => {
    expect(resolveLocalToolGate('acceptEdits', 'Write')).toBe('allow');
    expect(resolveLocalToolGate('acceptEdits', 'Edit')).toBe('allow');
    expect(resolveLocalToolGate('acceptEdits', 'Bash')).toBe('ask');
  });

  it('auto 는 로컬에 분류기가 없으므로 사람에게 묻는다 — 통과시키면 아무도 안 막는다', () => {
    expect(resolveLocalToolGate('auto', 'Write')).toBe('ask');
    expect(resolveLocalToolGate('auto', 'Bash')).toBe('ask');
  });
});

describe('모르는 것은 안전한 쪽으로 넘겨짚지 않는다', () => {
  it('목록에 없는 도구는 가변으로 본다', () => {
    expect(resolveLocalToolGate('default', 'DropDatabase')).toBe('ask');
    expect(resolveLocalToolGate('plan', 'DropDatabase')).toBe('deny');
  });

  it('모르는 모드는 default 처럼 묻는다', () => {
    expect(resolveLocalToolGate('someFutureMode', 'Write')).toBe('ask');
  });

  it('우리가 주는 도구는 전부 판정이 난다 — 판정 없는 도구를 주지 않는다', () => {
    for (const tool of LOCAL_TOOL_NAMES) {
      expect(['allow', 'ask', 'deny']).toContain(resolveLocalToolGate('default', tool));
    }
  });
});
