/**
 * §5.11 — 훅으로 붙은 외부 세션의 집행 블록(`UserPromptSubmit` 의 `additionalContext` 가 유일한 길). 판정을 시험하려고 라우트 밖으로 뺐다.
 * 프로젝트 판정은 그래프가 권위(워크트리·하위 폴더의 `cwd` 는 켬/끔 키와 어긋난다) · 우리가 띄운 세션(`customCreated`)은 건너뛴다(두 번 실린다) · 어떤 실패도 프롬프트를 막지 않는다(빈 문자열).
 */

/** 이 판정이 세션에 대해 알아야 하는 전부 — 그래프 구현을 통째로 물지 않는다. */
export interface HookEnforcementDeps {
  /** 이 세션이 우리가 띄운 것인지 + 어느 에이전트인지. 모르면 `null`. */
  agentBySession: (sessionId: string) => { id: string; label: string; customCreated: boolean } | null;
  /** 그 에이전트가 매인 프로젝트 루트(= 켬/끔 키). 모르면 `null`. */
  projectPathForAgent: (agentId: string) => string | null;
  /** 세션이 실제로 돌고 있는 폴더. 그래프가 프로젝트를 모를 때만 쓴다. */
  agentCwd: (sessionId: string) => string | null;
  /** 집행 블록 조립(호스트). */
  buildSection: (req: {
    projectPath: string; cwd: string; agentId: string; agentLabel: string; customCreated: boolean;
  }) => string;
  log: (message: string, err: unknown) => void;
}

export interface HookEnforcementInput {
  session_id: string;
  cwd?: string;
}

export function buildHookEnforcementBlock(body: HookEnforcementInput, deps: HookEnforcementDeps): string {
  try {
    const agent = deps.agentBySession(body.session_id);
    if (agent?.customCreated) return '';
    const projectPath = (agent ? deps.projectPathForAgent(agent.id) : null)
      ?? deps.agentCwd(body.session_id)
      ?? body.cwd
      ?? '';
    if (!projectPath) return '';
    return deps.buildSection({
      projectPath,
      cwd: body.cwd ?? projectPath,
      agentId: agent?.id ?? '',
      agentLabel: agent?.label ?? '',
      customCreated: false,
    });
  } catch (err) {
    deps.log('[plugins] hook enforcement block failed', err);
    return '';
  }
}
