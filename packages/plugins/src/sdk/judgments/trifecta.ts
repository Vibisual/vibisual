/**
 * §5.11 v3.88 — 치명적 3요소(Lethal Trifecta) 판정 — **순수 함수**.
 *
 * 인젝션이 실제 유출로 바뀌는 조건은 ⓐ 민감 데이터 접근 · ⓑ 미신뢰 콘텐츠 노출 · ⓒ 외부 통신
 * **세 가지가 동시에 성립할 때뿐**이다. 그래서 처방이 바로 나온다 — 다리 하나만 끊으면 경로가 무너진다.
 *
 * ── 왜 이진이 아니라 3단인가 (구현 중 실측으로 드러난 것) ──
 * `Bash` 는 `LOCKED_AGENT_TOOLS` 라 UI 에서 뺄 수 없고(위임 dispatch 가 의존), 그 하나가 ⓑ와 ⓒ를 동시에
 * 켠다. 즉 "도구가 있나/없나"로만 보면 **거의 모든 에이전트가 항상 3/3** 이라 배지가 상시 점등돼 신호가
 * 죽는다. 그래서 각 다리를 `closed`(도구 없음 — 경로 끊김) / `gated`(있지만 Vibisual 승인 팝업이 가로막음)
 * / `open`(무확인 통과) 3단으로 본다. **경고는 셋이 전부 `open` 일 때만** 뜬다.
 *
 * 승인 여부는 도구가 아니라 `permissionMode` 가 정하므로(§5.3 #12-1), permissionMode 는
 * **다리 수를 늘리지 않고 각 다리의 등급만** 바꾼다. `isolation` 은 판정에 섞지 않는다 — 별도 방패 표시.
 */
import type { AgentConfig } from '@vibisual/shared';
import { LOCKED_AGENT_TOOLS } from '@vibisual/shared';

export type TrifectaLeg = 'data' | 'untrusted' | 'egress';

/** 다리 하나의 성립 등급. `closed` 가 하나라도 있으면 유출 경로 자체가 성립하지 않는다. */
export type TrifectaLegState = 'closed' | 'gated' | 'open';

export type TrifectaLevel = 'safe' | 'caution' | 'critical';

export interface TrifectaLegResult {
  state: TrifectaLegState;
  /** 이 다리를 켠 실효 도구들(사용자에게 "무엇 때문에 켜졌는지" 보여주기 위함). */
  tools: string[];
}

export interface TrifectaVerdict {
  legs: Record<TrifectaLeg, TrifectaLegResult>;
  /** `closed` 가 아닌 다리 수 (0~3) — 배지 채움 칸 수. */
  count: number;
  /** 셋 다 `open` = 무확인으로 유출까지 갈 수 있는 상태. */
  level: TrifectaLevel;
  /** 격리 사본에서 도는가 — **판정과 분리된 별도 표시**(방패). */
  isolated: boolean;
  /** 승인 팝업이 아예 뜨지 않는 설정인가(`bypassPermissions`). */
  unattended: boolean;
  /** 가장 싸게 끊을 수 있는 다리 — 패널의 처방. 이미 안전하면 null. */
  cheapestCut: TrifectaLeg | null;
}

/** ⓐ 민감 데이터 접근 — 프로젝트 파일을 읽을 수 있는 도구. */
const DATA_TOOLS = ['Read', 'Grep', 'Glob'] as const;
/** ⓑ 미신뢰 콘텐츠 노출 — 외부에서 온 텍스트를 컨텍스트로 끌어들이는 도구(도구가 돌려준 출력 포함). */
const UNTRUSTED_TOOLS = ['WebFetch', 'WebSearch', 'Bash'] as const;
/** ⓒ 외부 통신 — 데이터를 바깥으로 내보낼 수 있는 도구(curl·git push 가 Bash 안에 있다). */
const EGRESS_TOOLS = ['WebFetch', 'Bash'] as const;

export const TRIFECTA_LEG_TOOLS: Record<TrifectaLeg, readonly string[]> = {
  data: DATA_TOOLS,
  untrusted: UNTRUSTED_TOOLS,
  egress: EGRESS_TOOLS,
};

/**
 * 실효 도구 집합 = (tools ∪ LOCKED) − disallowedTools.
 *
 * LOCKED(`Bash`)를 더하는 이유: 서버 `PUT /api/agent-config/:id` 가 payload 에 없어도 자동 포함하므로
 * "UI 에서 뺐다"고 없는 것으로 보면 실제보다 안전하게 오판한다. 반대로 `disallowedTools` 는 CLI 가
 * 실제로 차단하므로 마지막에 뺀다.
 */
export function effectiveTools(config: AgentConfig | undefined): Set<string> {
  const set = new Set<string>(config?.tools ?? []);
  for (const locked of LOCKED_AGENT_TOOLS) set.add(locked);
  for (const denied of config?.disallowedTools ?? []) set.delete(denied);
  return set;
}

/**
 * permissionMode 가 정하는 "실행계 도구"의 기본 등급.
 * - `plan` — 실행 자체가 없다 → 경로 끊김.
 * - `bypassPermissions` — 승인 팝업 없음 → 그대로 열림.
 * - 그 외(`default`/`acceptEdits`) — 가변 도구는 승인 팝업이 가로막음(acceptEdits 는 편집만 자동).
 */
function gateOf(permissionMode: string | undefined): TrifectaLegState {
  if (permissionMode === 'plan') return 'closed';
  if (permissionMode === 'bypassPermissions') return 'open';
  return 'gated';
}

function legResult(present: string[], gate: TrifectaLegState): TrifectaLegResult {
  if (present.length === 0) return { state: 'closed', tools: [] };
  return { state: gate, tools: present };
}

export function judgeTrifecta(config: AgentConfig | undefined): TrifectaVerdict {
  const tools = effectiveTools(config);
  const pick = (candidates: readonly string[]): string[] => candidates.filter((tool) => tools.has(tool));

  const gate = gateOf(config?.permissionMode);

  // ⓐ 읽기는 승인 대상이 아니다 — 있으면 그대로 열린 것으로 본다(plan 모드에서도 읽기는 된다).
  const dataTools = pick(DATA_TOOLS);
  const data: TrifectaLegResult = dataTools.length > 0
    ? { state: 'open', tools: dataTools }
    : { state: 'closed', tools: [] };

  const untrusted = legResult(pick(UNTRUSTED_TOOLS), gate);
  const egress = legResult(pick(EGRESS_TOOLS), gate);

  const legs: Record<TrifectaLeg, TrifectaLegResult> = { data, untrusted, egress };
  const states = [data.state, untrusted.state, egress.state];
  const count = states.filter((s) => s !== 'closed').length;

  let level: TrifectaLevel;
  if (states.some((s) => s === 'closed')) level = 'safe';
  else if (states.every((s) => s === 'open')) level = 'critical';
  else level = 'caution';

  // 처방 — 이미 끊긴 다리가 있으면 제안하지 않는다. 셋 다 서 있으면 ⓒ(외부 통신)가 가장 싸게 끊긴다.
  //   ⓐ를 끊으면 에이전트가 코드를 못 읽어 쓸모가 없어지고, ⓑ는 도구 출력까지 포함이라 실질적으로 못 끊는다.
  const cheapestCut: TrifectaLeg | null = level === 'safe' ? null : 'egress';

  return {
    legs,
    count,
    level,
    isolated: config?.isolation === 'worktree',
    unattended: config?.permissionMode === 'bypassPermissions',
    cheapestCut,
  };
}
