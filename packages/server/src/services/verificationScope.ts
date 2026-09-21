import type { SubAgent, VerificationDemo } from '@vibisual/shared';

/** 검증 재료와 명령은 같은 세션의 것이다. ID 존재만 보면 다른 탭의 절차가 섞인다. */
export function verificationScopeError(input: {
  agentId: string;
  subAgentId: string;
  sub: Pick<SubAgent, 'id' | 'parentAgentId'> | undefined;
  demoId?: string;
  demo?: Pick<VerificationDemo, 'id' | 'agentId' | 'subAgentId'>;
}): 'session-not-found' | 'demo-not-found' | undefined {
  if (!input.sub || input.sub.id !== input.subAgentId || input.sub.parentAgentId !== input.agentId) {
    return 'session-not-found';
  }
  if (input.demoId && (!input.demo || input.demo.id !== input.demoId
    || input.demo.agentId !== input.agentId || input.demo.subAgentId !== input.subAgentId)) {
    return 'demo-not-found';
  }
  return undefined;
}
