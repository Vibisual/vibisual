/**
 * §5.5 #17-17 ⑫(a)(b) — **무대 팔레트에 설 "배운 행동"을 짓는다.**
 *
 * 사용자가 원한 것은 단계를 매번 치는 것이 아니라 **자기가 반복해 온 일을 끌어다 놓는 것**이다.
 * 그러려면 먼저 "무엇을 반복했는가"를 알아야 하는데, 그 답은 **이미 우리가 세고 있다** —
 * 스킬 사용수(`skillUsageCounts`) · 셸 명령 이력(`bashHistory`) · 사용자가 꽂은 단계
 * (`SessionGoalStep.authoredBy==='user'`). 새 수집 경로를 내지 않고 이 셋을 센다.
 *
 * **순수 함수다.** 클라 테스트에는 DOM 이 없고 서버 집계는 화면 없이 시험해야 하므로, 판정은
 * 컴포넌트나 서비스 클래스가 아니라 여기 한 곳에 둔다(⑫(f)).
 *
 * 저장하지 않는다 — 팔레트는 **파생**이라 스냅샷마다 다시 짓는다(⑪(f) 좌표와 같은 규칙).
 * 예외는 사용자가 고른 `pinned` 뿐이고, 그것만 체크포인트·identity 로 간다.
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

/**
 * 명령·본문을 **같은 것으로 볼지** 정하는 정규화.
 *
 * 연속 공백만 접고 그 밖은 건드리지 않는다 — `git status` 와 `git status -s` 를 같은 것으로 뭉치면
 * 팔레트에 뜨는 글과 실제로 돌던 명령이 달라지고, 사용자는 자기가 시킨 적 없는 줄을 끌게 된다.
 */
function normalize(raw: string): string {
  return raw.replace(/\s+/gu, ' ').trim();
}

function clamp(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * 명령줄이 **어느 종류의 일인가** — 그림을 빌릴 카드를 고른다.
 *
 * ⑪(a) 가 "판정은 도구 이름이 아니라 문맥이다"라고 못 박은 것은 **단계의 자동 분류** 얘기다.
 * 여기서 고르는 것은 팔레트 한 칸이 **어떤 그림을 빌릴까**이므로 이름만 봐도 된다. 다만 표에 없는
 * 종류는 가리키지 않는다 — 없는 카드를 가리키면 그 칸만 무채색으로 서는데, 그것은 "종류가 없다"와
 * 화면에서 구분되지 않는다.
 */
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

/**
 * 배운 행동을 모아 팔레트 순서대로 돌려준다.
 *
 * 정렬 — **고정이 먼저**(사용자가 고른 것은 횟수와 무관하게 맨 앞), 그다음 횟수 내림차순,
 * 동률이면 최근에 있었던 것, 그래도 같으면 id 순(같은 입력이면 항상 같은 답이 나와야 한다).
 */
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
