/**
 * §5.11 v4.67 — 훅으로 붙은 **외부 세션**에 실을 집행 블록.
 *
 * 집행 주입 지점은 넷이다(첫 스폰 · 이어지는 턴 · CMD 세션 · 훅 세션). 앞의 셋은 우리가 띄운 세션이라
 * 프롬프트를 우리가 직접 만들지만, 네 번째 — 사용자가 자기 에디터에서 돌리는 Claude Code 세션 — 에는
 * `UserPromptSubmit` 응답의 `additionalContext` 말고는 닿을 길이 없다.
 *
 * **왜 이 파일로 뺐나.** 이 판정은 `index.ts` 의 라우트 클로저 안에 있어서 테스트가 닿지 못했고,
 * 그래서 배선 검사(`mounted.test.ts`)가 소스에 이름이 있는지만 확인하고 있었다. 그 검사는 함수가
 * **호출되기만 하면** 통과하므로, 프로젝트 판정이 어긋나 늘 빈 문자열을 돌려줘도 초록이다. 판정을 여기로
 * 옮기고 필요한 것만 인자로 받게 하면 네 가지 행동을 그대로 못 박을 수 있다.
 *
 * 규율은 옮기기 전과 같다.
 *  · 프로젝트 판정은 **그래프가 권위** — 워크트리·하위 폴더에서 돌면 `cwd` 는 켬/끔 키와 어긋난다.
 *  · 우리가 띄운 세션(`customCreated`)은 **건너뛴다** — 그쪽은 프롬프트에 이미 실려 있어 두 번 실린다.
 *  · 어떤 실패도 프롬프트를 막지 않는다(빈 문자열 = 종전과 동일한 응답).
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
