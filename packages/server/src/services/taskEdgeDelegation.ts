/**
 * §5.3 #12 — **위임 엣지의 집행 축 하나.** 배지가 말하는 것과 실제로 박탈되는 것이 같아야 한다.
 *
 * v1.44 의 도구 박탈(strip)은 "자식 도구 ⊃ 부모 도구 매칭 부분"을 부모에게서 걷는다. 그런데
 * 자식이 **기본값(전체 도구)** 이면 그 합집합이 부모 도구를 통째로 덮는다. 그러면 부모는
 * `--tools ""` 로, 즉 **도구 0개**로 스폰된다(subAgentManager 의 "빈 배열은 전부 disable").
 * 그 상태의 부모는 직접 일할 수도 없고 — Claude 소스의 dispatch 프로토콜이 Bash heredoc curl 이라 —
 * **위임조차 할 수 없다.** 감독(Codex)→개발(Claude) 편성이 한 시간을 돌고도 파일 하나 못 바꾸던
 * 원인이 여기였다.
 *
 * 그래서 이 모듈은 박탈에 안전선 둘을 건다.
 *  1. **위임 수단 불가침** — 소스가 위임에 쓰는 도구(`DELEGATION_CHANNEL_TOOLS`)는 절대 걷지 않는다.
 *  2. **전멸 방지** — 박탈 결과 소스 도구가 빈 배열이 되면 **그 박탈을 통째로 적용하지 않는다.**
 *     일부만 남기는 식으로 깎지 않는다 — 어느 도구를 남길지는 사용자 의도가 아니다.
 *
 * 그리고 박탈 여부를 정하는 **해석 함수를 하나로** 둔다(`resolveEdgeCommandMode`). 프롬프트 배지와
 * 실제 strip 이 각각 다른 축(`delegationPolicy` vs `commandMode`)을 읽던 어긋남을 구조적으로 막는다.
 *
 * 순수 함수 모듈(그래프·디스크 접근 ❌)이라 단위 테스트로 고정한다.
 */
import type { TaskEdgeCommandMode, TaskEdgeKind } from '@vibisual/shared';

/**
 * 소스가 **위임을 실행하는 데** 쓰는 도구. 박탈 집합에서 항상 빠진다.
 *
 * Claude 소스의 dispatch 프로토콜은 `buildOutboundEdgesRulesSection` 이 주입하는
 * **Bash heredoc curl** 이다 — `Bash` 가 없으면 위임 자체가 불가능하다.
 * Codex 소스는 MCP(`vibisual_edges` dispatch/status)로 위임하므로 애초에 이 도구 목록의
 * 대상이 아니다(MCP 는 `AgentConfig.tools` 축에 없다).
 */
export const DELEGATION_CHANNEL_TOOLS: readonly string[] = ['Bash'];

/** 박탈 판정에 필요한 엣지 속성만. 그래프 타입 전체에 의존하지 않는다(테스트 용이). */
export interface DelegationEdgeInput {
  id: string;
  targetAgentId: string;
  kind?: TaskEdgeKind;
  commandMode?: TaskEdgeCommandMode;
  delegationPolicy?: 'strict' | 'auto';
}

/** `kind !== 'command'` 엣지는 commandMode 축 자체가 없다 → `null`. */
export type ResolvedCommandMode = TaskEdgeCommandMode | null;

/**
 * **집행 축 해석 — 이 한 곳만 본다.**
 *
 * 후방호환(SSOT §5.3 #12): `commandMode === undefined` 인 엣지는 **v1.44 이전에 저장된 것**으로 보고
 * `delegationPolicy === 'strict'` 일 때만 `'tool-delegation'` 으로 읽는다. 신규 엣지는 생성 시점에
 * `'shared'` 가 박히므로(`POST /api/task-edges`) 이 폴백을 타지 않는다.
 */
export function resolveEdgeCommandMode(edge: DelegationEdgeInput): ResolvedCommandMode {
  if ((edge.kind ?? 'command') !== 'command') return null;
  if (edge.commandMode !== undefined) return edge.commandMode;
  return (edge.delegationPolicy ?? 'strict') === 'strict' ? 'tool-delegation' : 'shared';
}

/**
 * 프롬프트 배지가 써야 할 **실효 강제 정도**. `delegationPolicy` 단독이 아니다.
 *
 * `tool-delegation`(도구가 실제로 걷힘)·`mode-delegation`(시스템 프롬프트로 위임 강제) 은
 * 저장된 정책이 `auto` 여도 사실상 의무 위임이다. 사용자 엣지 `policy=auto + mode=tool-delegation`
 * 이 "판단 위임"으로 표시되면서 도구는 전멸하던 어긋남을 여기서 없앤다.
 */
export function resolveEffectiveDelegationPolicy(edge: DelegationEdgeInput): 'strict' | 'auto' {
  const mode = resolveEdgeCommandMode(edge);
  if (mode === 'tool-delegation' || mode === 'mode-delegation') return 'strict';
  return edge.delegationPolicy ?? 'strict';
}

/**
 * 한 엔드포인트가 도구를 쥐고 있는가. 저장된 설정이 **명시적 빈 배열**이면 "모든 도구 제거"라
 * 그 엔드포인트는 아무것도 못 한다. 설정 자체가 없으면(`undefined`) CLI 기본 툴셋 상속이라 정상.
 */
export function hasUsableTools(cfg: { tools: readonly string[] } | undefined | null): boolean {
  if (!cfg) return true;
  return cfg.tools.length > 0;
}

/** 박탈을 적용하지 않은 사유. `'applied'` 만 실제 박탈이 걸린 상태다. */
export type StripSkipReason =
  | 'applied'
  /** 박탈 모드 엣지가 하나도 없음(= 평소 상태). */
  | 'no-stripping-edge'
  /** 타겟들이 도구를 하나도 안 내놓음(설정 미저장 → CLI 기본 상속). */
  | 'no-target-tools'
  /** 박탈하면 소스 도구가 빈 배열이 된다 → 통째로 취소(안전선 2). */
  | 'would-strip-all';

export interface DelegationStripDecision {
  /** 소스 `AgentConfig.tools` 에서 실제로 걷을 도구. 미적용이면 빈 집합. */
  strip: Set<string>;
  /** 박탈이 실제로 걸렸는가. 배지·`restrictedTools` 가 이 값을 따른다. */
  applied: boolean;
  reason: StripSkipReason;
  /** 박탈 모드로 판정된 엣지 id (미적용이어도 채워진다 — 왜 취소됐는지 보고용). */
  strippingEdgeIds: string[];
  /** 안전선 1로 지켜낸 위임 수단. */
  preservedTools: string[];
}

export interface DelegationStripArgs {
  /** 소스의 outbound 엣지 전부(아직 viability 로 거르지 않은 것). */
  edges: readonly DelegationEdgeInput[];
  /** 소스가 이 턴에 쓸 도구 목록. 설정 미저장이면 호출부가 CLI 기본 목록을 넣는다. */
  sourceTools: readonly string[];
  /** 타겟의 저장된 도구 목록. 설정 미저장이면 `undefined`(박탈 대상 없음). */
  targetToolsOf: (agentId: string) => readonly string[] | undefined;
  /** 양끝 대칭 viability. 무효 엣지는 박탈에서 빠진다. */
  isEdgeViable: (edge: DelegationEdgeInput) => boolean;
}

/**
 * 박탈 집합 계산 + 안전선 둘 적용. `computeStrictStripSet` 의 순수 본체.
 *
 * 순서가 중요하다 — **전멸 판정은 위임 수단을 빼기 전(raw 합집합)에** 한다. 그래야
 * "타겟이 전체 도구를 가졌다"(= 소스와 완전히 겹친다)는 상황에서 박탈이 통째로 취소되고,
 * Codex 소스로 넘어가는 `restrictedTools` 도 함께 비어 감독이 결과를 검증할 수단(shell/web)이
 * 살아남는다. Bash 만 남기고 나머지를 걷는 것은 Claude 소스는 구제하지만 Codex 소스는 구제하지 못한다.
 */
export function computeDelegationStrip(args: DelegationStripArgs): DelegationStripDecision {
  const preserved: string[] = [];
  const stripping = args.edges.filter((e) => {
    if (!args.isEdgeViable(e)) return false;
    return resolveEdgeCommandMode(e) === 'tool-delegation';
  });
  const strippingEdgeIds = stripping.map((e) => e.id);
  if (stripping.length === 0) {
    return { strip: new Set(), applied: false, reason: 'no-stripping-edge', strippingEdgeIds, preservedTools: preserved };
  }

  const raw = new Set<string>();
  for (const edge of stripping) {
    for (const t of args.targetToolsOf(edge.targetAgentId) ?? []) raw.add(t);
  }
  if (raw.size === 0) {
    return { strip: new Set(), applied: false, reason: 'no-target-tools', strippingEdgeIds, preservedTools: preserved };
  }

  // 안전선 2 — 소스가 가진 것을 남김없이 덮으면 그 박탈은 "위임 강제"가 아니라 무력화다.
  const survives = args.sourceTools.filter((t) => !raw.has(t));
  if (args.sourceTools.length > 0 && survives.length === 0) {
    return { strip: new Set(), applied: false, reason: 'would-strip-all', strippingEdgeIds, preservedTools: preserved };
  }

  // 안전선 1 — 위임 수단은 부분 박탈에서도 남긴다.
  const strip = new Set<string>();
  for (const t of raw) {
    if (DELEGATION_CHANNEL_TOOLS.includes(t)) { preserved.push(t); continue; }
    strip.add(t);
  }
  if (strip.size === 0) {
    return { strip, applied: false, reason: 'no-target-tools', strippingEdgeIds, preservedTools: preserved };
  }
  return { strip, applied: true, reason: 'applied', strippingEdgeIds, preservedTools: preserved };
}

/** 소스에 실제로 실릴 도구 목록. 박탈 미적용이면 원본 그대로. */
export function applyDelegationStrip(sourceTools: readonly string[], decision: DelegationStripDecision): string[] {
  if (!decision.applied) return [...sourceTools];
  return sourceTools.filter((t) => !decision.strip.has(t));
}
