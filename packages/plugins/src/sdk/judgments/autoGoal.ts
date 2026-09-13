/**
 * §5.10 — **자동 목표 판정** (공용).
 *
 * 점검 카드 26장이 폐기된 브레인 수치(`cardCount`·`currentCount`·주입 이벤트…)를 읽고 있었다.
 * 저장고가 "되풀이해 온 절차"로 바뀌었으므로 카드도 그 축을 읽어야 하는데, 26곳에서 각자
 * `ctx.data.autoGoal?.skillCount ?? 0` 을 풀어 쓰면 뜻이 26벌로 갈린다 — 특히 **"이 자리에서
 * 실제로 도는가"** 는 3층을 접어야 나오는 값이라 카드마다 다르게 접으면 같은 화면에서 서로 다른
 * 답이 나온다. 그래서 접는 일을 여기 하나로 둔다.
 *
 * 세지 않는다(§3.1) — 숫자는 전부 서버가 낸 요약 그대로이고, 여기서는 **합치고 고르기만** 한다.
 * 그래야 카드가 말하는 수와 프롬프트에 실제로 실리는 수가 어긋나지 않는다.
 *
 * 순수 함수·부작용 0. 플러그인 폴더는 `../sdk/index.js` 하나로만 이것을 본다(§5.11 자립 규약).
 */
import type { PluginBubbleContext } from '../../types.js';

/** 카드가 읽는 한 벌 — 이름은 전부 "무엇을 묻는가"로 지었다(저장고 내부 이름 ❌). */
export interface AutoGoalReading {
  /**
   * 이 프로젝트에 자동 목표 축이 **있는가**. `false` 면 어느 층도 켜지 않았다는 뜻이고,
   * 그때 나머지 숫자는 전부 0 이다. 0 과 구분해야 카드가 "아직 없다"와 "안 쓴다"를 다르게 말한다.
   */
  present: boolean;
  /** 이 버블 자리에서 실제로 도는가 — 프로젝트 층 위에 에이전트 층을 얹어 접은 값. */
  activeHere: boolean;
  /** 굳어 파일로 선 절차 수. */
  skills: number;
  /** 아직 문턱을 못 넘은 되풀이 후보 수. */
  brewing: number;
  /** 저장고에 든 것 전부(굳은 것 + 아직인 것). */
  stored: number;
  /** 사용자가 물려 둔 수 — 지운 것이 아니라 덮은 것. */
  dismissed: number;
  /** 원본 파일로 되짚을 수 있는(앵커가 붙은) 절차 수. */
  anchored: number;
  /** 에이전트가 스스로 친 명령에서 자란 수. */
  fromCommand: number;
  /** 사용자가 무대에 꽂은 단계에서 자란 수. */
  fromStep: number;
  /** 훑은 행동 수 — 분석 표본 크기. */
  observed: number;
  /** 스킬이 되는 문턱(되풀이 횟수). */
  minRuns: number;
  /** 가장 많이 되풀이된 절차 하나의 횟수. */
  topRuns: number;
  /** 되풀이 횟수의 총합. */
  totalRuns: number;
  /** 최초 1 회를 뺀 **순 재발** 횟수 — "한 번 하고 만 일"과 "계속 다시 하는 일"을 가른다. */
  repeats: number;
  /**
   * 이 자리 프롬프트에 이름이 실리는 절차 수.
   *
   * 꺼진 자리는 0 이다 — 서버가 꺼진 자리에 **한 글자도 싣지 않기** 때문이고(`buildAutoGoalPromptBlock`),
   * 카드가 그것과 다른 수를 말하면 둘 중 하나는 거짓이 된다.
   */
  carried: number;
  /** 가장 최근에 굳은 절차 이름. 없으면 `null`. */
  recent: string | null;
}

const EMPTY: AutoGoalReading = {
  present: false, activeHere: false, skills: 0, brewing: 0, stored: 0, dismissed: 0, anchored: 0,
  fromCommand: 0, fromStep: 0, observed: 0, minRuns: 0, topRuns: 0, totalRuns: 0, repeats: 0,
  carried: 0, recent: null,
};

export function readAutoGoal(ctx: PluginBubbleContext): AutoGoalReading {
  const s = ctx.data.autoGoal;
  if (!s) return EMPTY;

  /*
   * 에이전트 층은 **적힌 자리만** 온다 — 없는 키는 프로젝트 층을 물려받는다. 서버가 그렇게 줄여
   * 보내므로(맵이 에이전트 수만큼 자라지 않게) 받는 쪽이 같은 규칙으로 편다.
   * 세션 층은 여기 없다: 카드는 버블 단위라 어느 세션을 보고 있는지 알 수 없고, 모르는 층을
   * 추측해 접으면 화면이 프롬프트와 다른 답을 낸다.
   */
  const activeHere = s.agentEnabled?.[ctx.bubbleId] ?? s.enabled;
  const stored = s.skillCount + s.candidateCount;

  return {
    present: true,
    activeHere,
    skills: s.skillCount,
    brewing: s.candidateCount,
    stored,
    dismissed: s.dismissedCount,
    anchored: s.anchoredCount,
    fromCommand: s.fromCommand,
    fromStep: s.fromStep,
    observed: s.observed,
    minRuns: s.minRuns,
    topRuns: s.topRuns,
    totalRuns: s.totalRuns,
    repeats: Math.max(0, s.totalRuns - stored),
    carried: activeHere ? s.skillCount : 0,
    recent: s.recentSkillName ?? null,
  };
}
