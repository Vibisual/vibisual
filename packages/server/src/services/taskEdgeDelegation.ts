/**
 * §5.3 #12 — 위임 엣지의 집행 축(순수 모듈). 배지와 실제 박탈이 같아야 한다.
 * 자식이 전체 도구면 박탈이 부모를 `--tools ""` 로 만들어 일도 위임(Bash heredoc curl)도 못 한다 — 안전선 둘:
 * ① 위임 수단(`DELEGATION_CHANNEL_TOOLS`)은 안 걷는다 ② 결과가 빈 배열이면 박탈을 통째로 취소한다(일부만 남기지 않는다).
 * 박탈 여부는 `resolveEdgeCommandMode` 한 곳 — 배지·strip 이 다른 축을 읽지 않게.
 */
import type { TaskEdgeCommandMode, TaskEdgeKind } from '@vibisual/shared';

/**
 * 위임에 쓰는 도구 — 박탈에서 늘 빠진다. Claude 소스의 dispatch 는 Bash heredoc curl(`buildOutboundEdgesRulesSection`)이다.
 * Codex 소스는 MCP 로 위임해 대상이 아니다(MCP 는 `AgentConfig.tools` 축에 없다).
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
 * **집행 축 해석 — 이 한 곳만 본다.** `commandMode` 없는 옛 엣지는 `delegationPolicy === 'strict'` 일 때만 `'tool-delegation'`(§5.3 #12).
 * 새 엣지는 생성 때 `'shared'` 가 들어간다.
 */
export function resolveEdgeCommandMode(edge: DelegationEdgeInput): ResolvedCommandMode {
  if ((edge.kind ?? 'command') !== 'command') return null;
  if (edge.commandMode !== undefined) return edge.commandMode;
  return (edge.delegationPolicy ?? 'strict') === 'strict' ? 'tool-delegation' : 'shared';
}

/** 배지의 실효 강제 정도 — `tool-delegation`·`mode-delegation` 은 정책이 `auto` 여도 의무 위임이다("판단 위임" 배지 아래 도구가 전멸하지 않게). */
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
 * 박탈 + 안전선(`computeStrictStripSet` 본체). **전멸 판정은 위임 수단을 빼기 전에** — 그래야 타겟이 전체 도구일 때 박탈이 취소되고
 * Codex 소스의 `restrictedTools` 도 비어 검증 수단이 남는다(Bash 만 남기면 Codex 소스를 못 구한다).
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
