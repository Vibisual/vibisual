import { SPEC_RULES_BEGIN, SPEC_RULES_END } from '@vibisual/shared';

/**
 * §5.15 — `generate-tasks` 의 판정만 떼어 낸 순수 함수. 그래프를 건드리는 실행은 라우트가 한다.
 * 카드 버블이 지워진 항목은 "카드 없음"이다(남은 id 는 끊는다) — 그래야 지운 카드를 다시 만들 수 있고,
 * 사라진 에이전트를 사슬의 앞 고리로 쓰지 않는다.
 */

export interface SpecPlanItem {
  id: string;
  taskAgentId?: string;
}

export type SpecPlanStep =
  /** 살아 있는 카드 — 사슬 고리로만 쓴다. */
  | { kind: 'keep'; itemId: string; agentId: string }
  /** 살아 있는 카드를 지금 스펙으로 다시 맞춘다(규칙 섹션 교체 + 개정 번호 올림). 에이전트·대화는 그대로. */
  | { kind: 'refresh'; itemId: string; agentId: string }
  /** 카드가 없는 대상 항목 — 새로 만든다. */
  | { kind: 'create'; itemId: string; index: number };

export interface SpecTaskPlan {
  steps: SpecPlanStep[];
  /** 카드 버블이 사라져 연결만 남은 항목 — 실행 전에 끊는다. */
  detach: string[];
}

export function planSpecTasks(
  items: readonly SpecPlanItem[],
  opts: { wanted: ReadonlySet<string> | null; regenerate: boolean; agentExists: (agentId: string) => boolean },
): SpecTaskPlan {
  const steps: SpecPlanStep[] = [];
  const detach: string[] = [];
  items.forEach((item, index) => {
    const isTarget = opts.wanted ? opts.wanted.has(item.id) : true;
    const live = item.taskAgentId !== undefined && item.taskAgentId !== '' && opts.agentExists(item.taskAgentId);
    if (item.taskAgentId && !live) detach.push(item.id);
    if (live) {
      steps.push({ kind: isTarget && opts.regenerate ? 'refresh' : 'keep', itemId: item.id, agentId: item.taskAgentId! });
    } else if (isTarget) {
      steps.push({ kind: 'create', itemId: item.id, index });
    }
  });
  return { steps, detach };
}

/**
 * 사슬로 이을 쌍 — 항목 순서대로 이웃한 두 카드 중 하나라도 이번에 새로 생겼으면 잇는다.
 * 가운데 카드를 다시 만들면 앞→새 와 새→뒤 가 모두 나온다. 이미 있는 쌍은 호출처가 거른다.
 * `agentOf` 는 만들기에 실패한 항목에 null 을 돌려준다 — 그 자리는 사슬에서 빠진다.
 */
export function specChainLinks(
  steps: readonly SpecPlanStep[],
  agentOf: (step: SpecPlanStep) => string | null,
): { source: string; target: string }[] {
  const chain: { agentId: string; fresh: boolean }[] = [];
  for (const step of steps) {
    const agentId = agentOf(step);
    if (agentId) chain.push({ agentId, fresh: step.kind === 'create' });
  }
  const links: { source: string; target: string }[] = [];
  for (let i = 1; i < chain.length; i += 1) {
    const prev = chain[i - 1]!;
    const cur = chain[i]!;
    if (prev.fresh || cur.fresh) links.push({ source: prev.agentId, target: cur.agentId });
  }
  return links;
}

/** 에이전트 규칙에서 스펙 섹션만 새것으로 바꾸고 사람이 쓴 나머지는 그대로 둔다(스펙 섹션은 맨 앞). */
export function withSpecRules(existing: string | undefined, block: string): string {
  const rest = (existing ?? '')
    .replace(new RegExp(`${escapeRegExp(SPEC_RULES_BEGIN)}[\\s\\S]*?${escapeRegExp(SPEC_RULES_END)}\\n*`, 'g'), '')
    .trim();
  return rest ? `${block}\n\n${rest}` : block;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
