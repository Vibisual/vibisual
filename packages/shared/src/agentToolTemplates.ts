/**
 * 도구 목록 템플릿 — "도구" 칸 선택기가 한 번에 채운다(칩을 하나씩 지우다 빠뜨리면 쓰기 권한이 남는다). 근거는 공식 서브에이전트 문서의 최소 권한 구성(2026-09-14 조사).
 * ① `AVAILABLE_AGENT_TOOLS` 의 부분집합·그 순서(`--tools` 를 늘 명시 — §4 CLI 사양 추종 (3)) ② `Bash`·`PowerShell` 은 쌍으로(OS 마다 셸이 다르다)
 * ③ `ToolSearch` 는 지연 로딩 도구와 함께(빼면 못 부른다), 읽기 전용 템플릿엔 없음 ④ 선택은 저장하지 않고 `tools` 로 다시 계산한다(저장 필드가 늘면 3층·diff·PUT 에 새 축).
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

/** 선택기 2번부터의 순서 — 좁은 권한 → 넓은 권한. 마지막이 기본값과 같은 전체 목록이라 한 번에 되돌아간다. */
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
 * 선택기에 보일 값(`pick` = 이번 창에서 고른 것, `undefined` = 안 고름). 커스텀을 골랐으면 목록이 우연히 같아도 커스텀,
 * 템플릿을 고른 뒤 칩을 고치면·안 골랐으면 목록으로 다시 계산한다.
 */
export function resolveAgentToolTemplate(tools: readonly string[], pick: string | undefined): string {
  if (pick === AGENT_TOOL_TEMPLATE_CUSTOM) return AGENT_TOOL_TEMPLATE_CUSTOM;
  if (pick !== undefined) {
    const picked = findAgentToolTemplate(pick);
    if (picked && sameToolSet(picked.tools, tools)) return picked.id;
  }
  return matchAgentToolTemplate(tools) ?? AGENT_TOOL_TEMPLATE_CUSTOM;
}
