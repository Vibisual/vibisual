/**
 * §5.5 #17-17 ⑫(a)(b) — 무대 팔레트의 "배운 행동". 새 수집 없이 이미 세는 셋(스킬 사용수 · `bashHistory` · 사용자가 꽂은 단계)을 센다.
 * 순수(⑫(f)). 파생이라 저장하지 않는다 — `pinned` 만 체크포인트·identity 로 간다.
 */
import {
  GOAL_ACTION_LABEL_MAX,
  GOAL_ACTION_MAX,
  GOAL_ACTION_MIN_REPEAT,
  GOAL_ACTION_PAYLOAD_MAX,
  GOAL_ACTION_SKILL_MIN_REPEAT,
} from './constants.js';
import type { BashEntry, GoalActionCard, GoalActionSource, SessionGoal, VisualKindCard } from './types.js';

/** 집계에 넣는 것 — 전부 **이미 있는** 자료다(새 수집 ❌). */
export interface GoalActionInput {
  /** 스킬 이름 → 이 프로젝트에서 불린 누적 횟수(`projectGraph.skillUsageCounts`). */
  skillUsage?: Record<string, number>;
  /** agentId → 셸 명령 이력. 되풀이된 명령을 여기서 센다. */
  bashHistory?: Record<string, BashEntry[]>;
  /** 세션 목표들 — 사용자가 꽂은 단계(`authoredBy==='user'`)의 본문 빈도를 센다. */
  sessionGoals?: Record<string, SessionGoal>;
  /** 종류 카드 표 — 카드가 그림·색을 **빌릴** 대상. 여기 없는 `key` 는 가리키지 않는다. */
  visualKinds?: Record<string, VisualKindCard>;
  /** 사용자가 고정한 카드 id — 횟수가 0이어도 맨 앞에 남는다. */
  pinned?: string[];
}

/** 한 칸을 세는 동안의 누적. */
interface Tally {
  label: string;
  payload: string;
  source: GoalActionSource;
  count: number;
  lastUsedAt?: number;
  kind?: string;
}

/** 같은 명령으로 볼지 — 연속 공백만 접는다(`git status -s` 까지 뭉치면 팔레트 글과 실제 명령이 달라진다). */
function normalize(raw: string): string {
  return raw.replace(/\s+/gu, ' ').trim();
}

function clamp(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** 명령줄의 종류 — 빌릴 그림 카드를 고른다(이름만 본다 — ⑪(a) 문맥 판정은 단계 분류용). 표에 없는 종류는 가리키지 않는다(무채색 칸이 "종류 없음"과 안 갈린다). */
function kindForCommand(command: string, known: Record<string, VisualKindCard>): string | undefined {
  const head = command.toLowerCase();
  const guess = ((): string | undefined => {
    if (/^gh\s/u.test(head)) return 'github';
    if (/^git\s/u.test(head)) return 'git';
    if (/\b(build|tsc|webpack|vite build|cmake|msbuild)\b/u.test(head)) return 'build';
    if (/\b(test|vitest|jest|pytest|typecheck)\b/u.test(head)) return 'test';
    return undefined;
  })();
  return guess && known[guess] ? guess : undefined;
}

/** 스킬 이름과 같은 이름의 종류 카드가 있으면 그 그림을 빌린다(없으면 중립). */
function kindForSkill(name: string, known: Record<string, VisualKindCard>): string | undefined {
  return known[name] ? name : undefined;
}

/** 팔레트 순서 — 고정 → 횟수 내림차순 → 최근 → id(같은 입력이면 같은 답). */
export function buildGoalActions(input: GoalActionInput): GoalActionCard[] {
  const known = input.visualKinds ?? {};
  const pinned = new Set(input.pinned ?? []);
  const tally = new Map<string, Tally>();

  const bump = (id: string, next: Tally): void => {
    const cur = tally.get(id);
    if (!cur) {
      tally.set(id, next);
      return;
    }
    cur.count += next.count;
    if (next.lastUsedAt !== undefined && (cur.lastUsedAt === undefined || next.lastUsedAt > cur.lastUsedAt)) {
      cur.lastUsedAt = next.lastUsedAt;
    }
    if (!cur.kind && next.kind) cur.kind = next.kind;
  };

  // ⓐ 스킬 — 이름 자체가 이미 "이 프로젝트에서 하는 일"이라 문턱이 낮다.
  for (const [name, count] of Object.entries(input.skillUsage ?? {})) {
    const clean = normalize(name);
    if (!clean || count < GOAL_ACTION_SKILL_MIN_REPEAT) continue;
    bump(`skill:${clean}`, {
      label: clamp(`/${clean}`, GOAL_ACTION_LABEL_MAX),
      payload: clamp(`/${clean}`, GOAL_ACTION_PAYLOAD_MAX),
      source: 'skill',
      count,
      ...(kindForSkill(clean, known) ? { kind: kindForSkill(clean, known) } : {}),
    });
  }

  // ⓑ 되풀이된 셸 명령 — 에이전트가 실제로 몇 번이나 같은 것을 쳤나.
  for (const entries of Object.values(input.bashHistory ?? {})) {
    for (const entry of entries) {
      const clean = normalize(entry.command ?? '');
      if (!clean) continue;
      const payload = clamp(clean, GOAL_ACTION_PAYLOAD_MAX);
      bump(`cmd:${payload}`, {
        label: clamp(clean, GOAL_ACTION_LABEL_MAX),
        payload,
        source: 'command',
        count: 1,
        lastUsedAt: entry.timestamp,
        ...(kindForCommand(clean, known) ? { kind: kindForCommand(clean, known) } : {}),
      });
    }
  }

  // ⓒ 사용자가 되풀이해 꽂은 단계 — (d) 가 남긴 기록이 그대로 학습 재료다.
  for (const goal of Object.values(input.sessionGoals ?? {})) {
    for (const step of goal.steps ?? []) {
      if (step.authoredBy !== 'user') continue;
      const clean = normalize(step.text ?? '');
      if (!clean) continue;
      const payload = clamp(clean, GOAL_ACTION_PAYLOAD_MAX);
      bump(`step:${payload}`, {
        label: clamp(clean, GOAL_ACTION_LABEL_MAX),
        payload,
        source: 'step',
        count: 1,
        lastUsedAt: step.updatedAt,
        ...(step.kind && known[step.kind] ? { kind: step.kind } : {}),
      });
    }
  }

  const cards: GoalActionCard[] = [];
  for (const [id, t] of tally) {
    const isPinned = pinned.has(id);
    const floor = t.source === 'skill' ? GOAL_ACTION_SKILL_MIN_REPEAT : GOAL_ACTION_MIN_REPEAT;
    // 고정한 칸은 문턱 아래여도 남는다 — 사용자가 직접 고른 것을 우리 산식이 지우면 안 된다.
    if (!isPinned && t.count < floor) continue;
    cards.push({
      id,
      label: t.label,
      payload: t.payload,
      source: t.source,
      useCount: t.count,
      ...(t.kind ? { kind: t.kind } : {}),
      ...(t.lastUsedAt !== undefined ? { lastUsedAt: t.lastUsedAt } : {}),
      ...(isPinned ? { pinned: true } : {}),
    });
  }

  cards.sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    if (a.useCount !== b.useCount) return b.useCount - a.useCount;
    const at = a.lastUsedAt ?? 0;
    const bt = b.lastUsedAt ?? 0;
    if (at !== bt) return bt - at;
    return a.id.localeCompare(b.id);
  });

  return cards.slice(0, GOAL_ACTION_MAX);
}
