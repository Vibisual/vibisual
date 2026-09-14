/**
 * **도구 목록 템플릿** — 에이전트 설정 창 "도구" 칸 오른쪽의 선택기가 한 번에 채우는 목록들.
 *
 * **왜 필요한가.** 기본값이 공식 도구 표 전체(`AVAILABLE_AGENT_TOOLS`)라, "읽기만 하는 에이전트"를
 * 만들려면 칩 마흔 개를 하나씩 지워야 했다. 그 사이 하나를 빼먹으면 조용히 쓰기 권한이 남는다.
 *
 * **목록의 근거는 공개 우수 사례다** (2026-09-14 조사 — 추측으로 짓지 않는다):
 *  · 공식 서브에이전트 문서(code.claude.com/docs/en/sub-agents) — 읽기 전용·리뷰어는
 *    `Read, Grep, Glob`, 조사에 명령이 필요하면 `+ Bash`, 조율자는 `Agent, Read, Bash`.
 *    원칙은 **최소 권한** — 그 일에 꼭 필요한 도구만 준다.
 *  · 실사용 사례 모음(dev.to "12 subagents that earn their context") — 리뷰어 Read/Grep/Glob/Bash,
 *    디버거·구현 Read+Edit(+Write/Bash), 문서 Read+Write+Edit, 조율자 Agent+Read.
 *    "쓰기 권한은 꼭 써야 할 때만."
 *
 * **규약.**
 *  1. 목록은 `AVAILABLE_AGENT_TOOLS` 의 부분집합이며 그 순서를 따른다 — `--tools` 를 늘 명시하므로
 *     목록 밖 이름은 그 에이전트에게 존재하지 않는다(§4 CLI 사양 추종 (3)).
 *  2. **셸(`Bash`·`PowerShell`)은 쌍으로 싣는다.** 윈도우 설치본은 PowerShell 을 쓰고 맥·리눅스는
 *     Bash 를 쓴다 — 한쪽만 실으면 같은 템플릿이 OS 에 따라 명령을 못 돌린다.
 *  3. **`ToolSearch` 는 지연 로딩되는 도구(웹·작업 장부·위임)와 함께 싣는다.** 그 도구들은 스키마를
 *     불러와야 부를 수 있는 설치본이 있다 — 빼면 목록엔 있는데 부를 수 없는 도구가 된다. 읽기만 하는
 *     도구(Read·Glob·Grep·LSP)만 있는 템플릿에는 싣지 않는다.
 *  4. 선택 상태는 **저장하지 않는다.** 저장되는 것은 평범한 `tools` 배열뿐이고, 선택기는 그 배열이
 *     어느 템플릿과 같은지로 다시 계산한다 — 저장 필드를 늘리면 3층 해소·diff 표식·PUT 에 새 축이 생긴다.
 */
import { AVAILABLE_AGENT_TOOLS } from './constants.js';

/** 선택기 첫 칸 — 손으로 고른 목록. 템플릿 id 와 겹치지 않는다. */
export const AGENT_TOOL_TEMPLATE_CUSTOM = 'custom';

export interface AgentToolTemplate {
  /** i18n 키 조각이자 선택기 값. `custom` 은 쓰지 않는다. */
  id: string;
  /** `AVAILABLE_AGENT_TOOLS` 순서를 따르는 부분집합. */
  tools: readonly string[];
}

const SHELL = ['Bash', 'PowerShell'] as const;
const TASK_LEDGER = ['TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate', 'TodoWrite'] as const;

/** 공식 표 순서로 줄 세운다 — 칩이 템플릿마다 뒤섞여 보이지 않게. */
function inCatalogOrder(names: readonly string[]): readonly string[] {
  const want = new Set(names);
  return AVAILABLE_AGENT_TOOLS.filter((tool) => want.has(tool));
}

/**
 * 선택기 2번부터의 순서 그대로다. 권한이 좁은 것에서 넓은 것으로 — 마지막은 기본값과 같은 전체 목록이라,
 * 템플릿을 둘러본 뒤 원래대로 돌아가는 길이 한 번의 클릭으로 남는다.
 */
export const AGENT_TOOL_TEMPLATES: readonly AgentToolTemplate[] = [
  // 코드를 읽고 찾기만 한다. 파일 수정·명령 실행 없음 — 공식 문서의 읽기 전용·리뷰어 구성 + LSP(읽기 전용 코드 탐색).
  { id: 'readOnly', tools: inCatalogOrder(['Read', 'Glob', 'Grep', 'LSP']) },
  // 읽고 명령을 돌려 확인한다(git diff·테스트 실행). Write·Edit 는 없다 — 공식 code-reviewer 구성.
  { id: 'review', tools: inCatalogOrder(['Read', 'Glob', 'Grep', 'LSP', ...SHELL]) },
  // 웹을 찾아 읽고 코드와 대조한다. 수정·실행 없음.
  { id: 'research', tools: inCatalogOrder(['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'ToolSearch']) },
  // 문서를 읽고 쓴다. 명령 실행 없음 — 사례 모음의 문서 작성자 구성.
  { id: 'docs', tools: inCatalogOrder(['Read', 'Write', 'Edit', 'Glob', 'Grep']) },
  // 읽기·쓰기·실행 + 작업 장부 + 스킬. 위임·웹·예약은 뺀다.
  {
    id: 'implement',
    tools: inCatalogOrder([
      'Read', 'Write', 'Edit', 'Glob', 'Grep', 'NotebookEdit', 'LSP', ...SHELL,
      ...TASK_LEDGER, 'Skill', 'ToolSearch',
    ]),
  },
  // 일을 나눠 맡기고 결과를 모은다. 직접 고치지 않는다 — 공식 조율자 구성(Agent, Read, Bash) + 위임 도구 한 벌.
  {
    id: 'orchestrate',
    tools: inCatalogOrder([
      'Read', 'Glob', 'Grep', ...SHELL,
      'Agent', 'ListAgents', 'SendMessage', 'TaskOutput', 'TaskStop',
      ...TASK_LEDGER, 'Skill', 'ToolSearch',
    ]),
  },
  // 공식 표 전체 — 새 에이전트의 기본값과 같다.
  { id: 'all', tools: [...AVAILABLE_AGENT_TOOLS] },
];

function sameToolSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const tool of left) if (!right.has(tool)) return false;
  return true;
}

export function findAgentToolTemplate(id: string): AgentToolTemplate | undefined {
  return AGENT_TOOL_TEMPLATES.find((tmpl) => tmpl.id === id);
}

/** 이 목록과 **같은 집합**인 템플릿의 id. 순서·중복은 보지 않는다. 없으면 `null`. */
export function matchAgentToolTemplate(tools: readonly string[]): string | null {
  return AGENT_TOOL_TEMPLATES.find((tmpl) => sameToolSet(tmpl.tools, tools))?.id ?? null;
}

/**
 * 선택기에 **지금 보일 값**.
 *
 * `pick` 은 이번 창에서 사용자가 선택기로 고른 값이다(`undefined` = 아직 안 고름).
 *  · 커스텀을 골랐으면 목록이 우연히 어느 템플릿과 같아져도 커스텀으로 남는다 — 고른 것이 도로 바뀌어
 *    보이면 선택이 먹지 않은 것으로 읽힌다.
 *  · 템플릿을 고른 뒤 칩을 하나라도 고치면 그 템플릿이 아니다 → 목록으로 다시 계산한다.
 *  · 안 골랐으면 목록만 보고 계산한다(창을 열 때 저장된 목록이 어느 템플릿인지 알아본다).
 */
export function resolveAgentToolTemplate(tools: readonly string[], pick: string | undefined): string {
  if (pick === AGENT_TOOL_TEMPLATE_CUSTOM) return AGENT_TOOL_TEMPLATE_CUSTOM;
  if (pick !== undefined) {
    const picked = findAgentToolTemplate(pick);
    if (picked && sameToolSet(picked.tools, tools)) return picked.id;
  }
  return matchAgentToolTemplate(tools) ?? AGENT_TOOL_TEMPLATE_CUSTOM;
}
