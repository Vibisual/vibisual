import { describe, expect, it } from 'vitest';
import { verificationScopeError } from './verificationScope.js';

const session = {
  agentId: 'agent-a',
  subAgentId: 'sub-a',
  sub: { id: 'sub-a', parentAgentId: 'agent-a' },
};
const demo = { id: 'demo-a', agentId: 'agent-a', subAgentId: 'sub-a' };

describe('verificationScopeError — 검증·시연·재작업의 세션 소유권', () => {
  it('같은 세션은 시연 없이도 검증하거나 시연을 저장할 수 있다', () => {
    expect(verificationScopeError(session)).toBeUndefined();
  });

  it('없는 세션에는 검증과 시연을 만들지 않는다', () => {
    expect(verificationScopeError({ ...session, sub: undefined })).toBe('session-not-found');
  });

  it('존재하는 다른 에이전트 세션을 넣어도 자기 명령 큐로 보내지 않는다', () => {
    expect(verificationScopeError({
      ...session, sub: { id: 'sub-a', parentAgentId: 'agent-b' },
    })).toBe('session-not-found');
  });

  it('조회된 세션과 요청된 세션 ID가 다르면 거절한다', () => {
    expect(verificationScopeError({ ...session, subAgentId: 'sub-b' })).toBe('session-not-found');
  });

  it('선택한 시연이 사라졌으면 절차 없이 조용히 시작하지 않는다', () => {
    expect(verificationScopeError({ ...session, demoId: 'demo-deleted' })).toBe('demo-not-found');
  });

  it('같은 에이전트여도 다른 탭의 시연을 섞지 않는다', () => {
    expect(verificationScopeError({
      ...session, demoId: demo.id, demo: { ...demo, subAgentId: 'sub-b' },
    })).toBe('demo-not-found');
  });

  it('다른 에이전트의 시연을 현재 탭에 싣지 않는다', () => {
    expect(verificationScopeError({
      ...session, demoId: demo.id, demo: { ...demo, agentId: 'agent-b' },
    })).toBe('demo-not-found');
  });

  it('선택한 시연 ID와 조회 결과가 다르면 거절한다', () => {
    expect(verificationScopeError({ ...session, demoId: 'demo-other', demo })).toBe('demo-not-found');
  });

  it('같은 에이전트·같은 세션의 선택한 시연은 그대로 사용할 수 있다', () => {
    expect(verificationScopeError({ ...session, demoId: demo.id, demo })).toBeUndefined();
  });
});
