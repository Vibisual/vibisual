/**
 * §5.5 #17-32 ⑤ — "어느 훅 줄에 불이 켜지는가" 를 정하는 두 순수 함수 테스트.
 *
 * 발동 신호에는 (이벤트 · 도구 · 세션) 세 값밖에 없다. 그래서 불이 맞는 줄에 켜지는지는 전부
 * 이 둘이 정한다 — 여기가 틀리면 화면이 **엉뚱한 훅을 켜거나**(거짓 신고) **울린 훅을 안 켠다**
 * (기능이 죽은 것처럼 보인다). 둘 다 화면과 무관한 순수 함수라 여기서 고정한다.
 */
import { describe, expect, it } from 'vitest';

import { hookMatcherMatches, isWildcardHookMatcher } from '@vibisual/shared';
import type { HookFiredPayload } from '@vibisual/shared';

import { fireBelongsToSession } from '../../stores/hookFires.js';

function fire(over: Partial<HookFiredPayload> = {}): HookFiredPayload {
  return { agentId: 'agent-1', event: 'PreToolUse', at: Date.now(), ...over };
}

describe('isWildcardHookMatcher', () => {
  it('없음·빈 문자열·공백·별표는 전부 "모든 도구" 다', () => {
    expect(isWildcardHookMatcher(undefined)).toBe(true);
    expect(isWildcardHookMatcher('')).toBe(true);
    expect(isWildcardHookMatcher('   ')).toBe(true);
    expect(isWildcardHookMatcher('*')).toBe(true);
  });

  it('도구 이름이 적혀 있으면 와일드카드가 아니다', () => {
    expect(isWildcardHookMatcher('Bash')).toBe(false);
  });
});

describe('hookMatcherMatches', () => {
  it('와일드카드는 어떤 도구에도 걸린다', () => {
    expect(hookMatcherMatches('*', 'Bash')).toBe(true);
    expect(hookMatcherMatches('', 'Write')).toBe(true);
    expect(hookMatcherMatches(undefined, 'Read')).toBe(true);
  });

  it('도구 없는 이벤트(Stop·SessionStart)는 matcher 와 무관하게 걸린다', () => {
    // 이벤트 이름이 이미 같다는 전제로 불리므로, 대조할 도구가 없으면 걸린 것이다.
    expect(hookMatcherMatches('Bash', undefined)).toBe(true);
    expect(hookMatcherMatches(undefined, undefined)).toBe(true);
  });

  it('이름이 같으면 걸린다', () => {
    expect(hookMatcherMatches('Bash', 'Bash')).toBe(true);
  });

  it('부분 일치로 삼키지 않는다 — Edit 은 MultiEdit 이 아니다', () => {
    expect(hookMatcherMatches('Edit', 'MultiEdit')).toBe(false);
    expect(hookMatcherMatches('Edit', 'Edit')).toBe(true);
  });

  it('파이프 갈래는 양쪽 모두에 앵커가 걸린다', () => {
    expect(hookMatcherMatches('Edit|Write', 'Write')).toBe(true);
    expect(hookMatcherMatches('Edit|Write', 'Edit')).toBe(true);
    // 앵커를 그룹 밖에 걸면 여기서 MultiEdit 이 통과해 버린다.
    expect(hookMatcherMatches('Edit|Write', 'MultiEdit')).toBe(false);
    expect(hookMatcherMatches('Edit|Write', 'Bash')).toBe(false);
  });

  it('정규식 문법을 그대로 받는다', () => {
    expect(hookMatcherMatches('Notebook.*', 'NotebookEdit')).toBe(true);
    expect(hookMatcherMatches('mcp__.*', 'mcp__github__search')).toBe(true);
    expect(hookMatcherMatches('mcp__.*', 'Bash')).toBe(false);
  });

  it('깨진 정규식에도 던지지 않는다 — 문자열 비교로 떨어진다', () => {
    expect(() => hookMatcherMatches('Bash(', 'Bash')).not.toThrow();
    expect(hookMatcherMatches('Bash(', 'Bash')).toBe(false);
    expect(hookMatcherMatches('Bash(', 'Bash(')).toBe(true);
  });
});

describe('fireBelongsToSession', () => {
  it('다른 에이전트의 발동은 내 줄을 켜지 않는다', () => {
    expect(fireBelongsToSession(fire({ agentId: 'agent-2' }), 'agent-1', null)).toBe(false);
  });

  it('아직 보고 있는 에이전트를 모르면 아무것도 켜지 않는다', () => {
    expect(fireBelongsToSession(fire(), null, null)).toBe(false);
  });

  it('탭까지 같으면 켠다 — 옆 탭의 발동은 켜지 않는다(세션별 축)', () => {
    expect(fireBelongsToSession(fire({ subAgentId: 'sub-a' }), 'agent-1', 'sub-a')).toBe(true);
    expect(fireBelongsToSession(fire({ subAgentId: 'sub-b' }), 'agent-1', 'sub-a')).toBe(false);
  });

  it('탭을 알 수 없는 발동은 에이전트까지만 좁혀 켠다', () => {
    // 외부 에디터가 띄운 훅 세션은 탭이 없다 — 모른다는 이유로 불을 아예 안 켜면
    // 그 세션에서는 기능이 죽은 것처럼 보인다.
    expect(fireBelongsToSession(fire(), 'agent-1', 'sub-a')).toBe(true);
    expect(fireBelongsToSession(fire({ subAgentId: 'sub-a' }), 'agent-1', null)).toBe(true);
  });
});
