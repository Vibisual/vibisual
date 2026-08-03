/**
 * §5.11 v4.04 — 패널 카드 정렬·접힘 규칙 — 순수 함수.
 *
 * 규칙을 컴포넌트 안에 두면 "경고가 접혀 버리는" 종류의 회귀를 테스트로 잡을 수 없다. 정렬과 접힘의
 * 판단만 여기로 떼어 두고, 호스트는 결과를 그리기만 한다.
 *
 * 원칙 둘.
 *  ① **문제부터 위로** — 심각한 등급이 먼저. 무엇을 봐야 하는지가 스크롤 없이 보여야 한다.
 *  ② **경고는 절대 접지 않는다** — 접으면 보라고 만든 이유가 사라진다. 접히는 것은 조용한 카드뿐이다.
 */
import type { PluginSeverity } from '@vibisual/plugins';

/** 조용한 카드가 이 수를 넘으면 접는다. 서너 장까지는 접는 쪽이 오히려 성가시다. */
export const QUIET_COLLAPSE_THRESHOLD = 3;

const ORDER: Record<PluginSeverity, number> = { bad: 0, warn: 1, neutral: 2, good: 3 };

const isLoud = (severity: PluginSeverity): boolean => severity === 'bad' || severity === 'warn';

export interface OrderableSection {
  id: string;
  severity: PluginSeverity;
}

export interface OrderedPanelSections<T extends OrderableSection> {
  /** 지금 그릴 카드들 — 이미 정렬돼 있다. */
  shown: T[];
  /** 접혀서 안 보이는 수. 0 이면 펼치기 버튼을 내지 않는다. */
  hidden: number;
  /** 접을 것이 있는가 — 펼친 상태에서 "접기" 버튼을 낼지 판단한다. */
  collapsible: boolean;
}

export function orderPanelSections<T extends OrderableSection>(
  sections: T[],
  expanded: boolean,
): OrderedPanelSections<T> {
  // 같은 등급끼리는 원래 순서를 지킨다 — 켤 때마다 자리가 바뀌면 사용자가 카드를 못 찾는다.
  const sorted = sections
    .map((s, i) => ({ s, i }))
    .sort((a, b) => ORDER[a.s.severity] - ORDER[b.s.severity] || a.i - b.i)
    .map(({ s }) => s);

  const quiet = sorted.filter((s) => !isLoud(s.severity));
  const collapsible = quiet.length > QUIET_COLLAPSE_THRESHOLD;

  if (!collapsible || expanded) {
    return { shown: sorted, hidden: 0, collapsible };
  }

  const keptQuiet = new Set(quiet.slice(0, QUIET_COLLAPSE_THRESHOLD));
  const shown = sorted.filter((s) => isLoud(s.severity) || keptQuiet.has(s));
  return { shown, hidden: sorted.length - shown.length, collapsible };
}
