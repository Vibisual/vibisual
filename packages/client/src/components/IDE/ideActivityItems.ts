import type { IDEViewType } from '../../stores/graphStore.js';

/** §5.5 #16-1 — 활동바 항목 정본 표(한 벌 — 표 밖 칸은 순서·제외가 안 된다). 아이콘은 `ideActivityIcons.tsx`, 순서 합치기는 shared `ideActivityBar.ts`, 배지·점등은 컴포넌트. */
export interface IDEActivityItem {
  view: IDEViewType;
  /** i18n 키. `subagents` 만 `{{count}}` 를 받는다(툴팁이 그 수를 말한다). */
  labelKey: string;
  /** 활성일 때 왼쪽 테두리 색 — Tailwind 는 동적 클래스명(`border-${x}-400`)을 못 만드니 전체 이름을 적는다. */
  accent: string;
}

/** 기본 배치(안 만졌으면 이대로). 같은 결끼리 붙어 있다(실린 것 · 읽는 것 · 하는 일 · 검증 · 남은 것) — `resolveActivityOrder` 가 새 칸을 앞 이웃 뒤에 끼우는 것도 이 짝 때문. `brain` 은 없다(§5.10). */
export const IDE_ACTIVITY_ITEMS: readonly IDEActivityItem[] = [
  // §5.5 #17-31 — 이 프로젝트에서 쓸 수 있는 MCP(무엇이 꽂혀 있나).
  { view: 'mcp', labelKey: 'ide.activityBar.mcp', accent: 'border-blue-400' },
  // §5.5 #17-32 — 이 세션에 적용되는 훅(무엇이 실제로 도는가).
  { view: 'hooks', labelKey: 'ide.activityBar.hooks', accent: 'border-amber-400' },
  // §5.5 #17-33 — Claude Code 자신의 플러그인 + 마켓플레이스.
  { view: 'plugins', labelKey: 'ide.activityBar.plugins', accent: 'border-indigo-400' },
  { view: 'files', labelKey: 'ide.activityBar.files', accent: 'border-blue-400' },
  // §5.5 #17-28 — 이 프롬프트 앞에 무엇이 겹쳐 실리는가.
  { view: 'context', labelKey: 'ide.activityBar.context', accent: 'border-blue-400' },
  // §5.5 #17-4 — 스킬.
  { view: 'skills', labelKey: 'ide.activityBar.skills', accent: 'border-blue-400' },
  // §5.5 #17-17 — 세션 목표.
  { view: 'goal', labelKey: 'ide.activityBar.goal', accent: 'border-emerald-400' },
  // §5.10 (P) — 절차 감지(내부 식별자 `autoGoal`). 목표 **바로 뒤**다 — 둘은 묻는 물음이 다르지만
  //   같은 결("무엇을 하고 있나")이라 화면에서 떨어지면 안 된다.
  { view: 'autoGoal', labelKey: 'ide.activityBar.autoGoal', accent: 'border-violet-400' },
  // §5.3 #10-4 · §5.5 #16-1 (H) — 오케스트라(지휘 모드). 절차 감지 **바로 뒤**다 — 같은 결("무엇을 하고
  //   있나 — 누가 일을 나누나")이고, 새 칸이라 저장된 순서에도 앞 이웃(`autoGoal`) 뒤에 끼워진다.
  { view: 'orchestra', labelKey: 'ide.activityBar.orchestra', accent: 'border-amber-400' },
  // §5.3 #10-5 — 설정 덜어내기. 오케스트라 **바로 뒤**다 — 둘 다 "이 턴을 어떤 모양으로 돌릴까"를
  //   정하는 칸이고, 새 칸이라 저장된 순서에도 앞 이웃(`orchestra`) 뒤에 끼워진다.
  { view: 'configTrim', labelKey: 'ide.activityBar.configTrim', accent: 'border-rose-400' },
  // §5.5 #17-11 — 세션 반복 실행(루프).
  { view: 'loop', labelKey: 'ide.activityBar.loop', accent: 'border-amber-400' },
  // §5.5 #17-20 — 디버그·실행 런처.
  { view: 'debug', labelKey: 'ide.activityBar.debug', accent: 'border-emerald-400' },
  // §5.5 #17-35 — 검증. 바로 옆에 정독이 선다(만든 것이 도는가 ↔ 기획대로 만들었는가).
  { view: 'verify', labelKey: 'ide.activityBar.verify', accent: 'border-sky-400' },
  // §5.11 정독 게이트.
  { view: 'specReading', labelKey: 'ide.activityBar.specReading', accent: 'border-sky-400' },
  // §5.5 #17-9 ⑤ — 실행 중 서브에이전트.
  { view: 'subagents', labelKey: 'ide.activityBar.runningSubagents', accent: 'border-sky-400' },
  // §5.5 #17-7 — 북마크.
  { view: 'bookmarks', labelKey: 'ide.activityBar.bookmarks', accent: 'border-blue-400' },
  /*
   * §5.10 — `brain` 칸은 없다(되풀이 절차 → 스킬은 `autoGoal` 「절차 감지」가 잇고, 기억 카드·주제 축·리플렉션은 되살리지 않는다).
   * (P) 스위치는 `IDEAutoGoalView` 한 곳 — 목표 뷰에 그 블록을 얹으면 켜는 자리가 둘이 된다(#17-44 ⑧(d)).
   */
];

/** 기본 순서(뷰 이름만). shared `resolveActivityOrder` 의 두 번째 인자. */
export const DEFAULT_ACTIVITY_ORDER: readonly IDEViewType[] = IDE_ACTIVITY_ITEMS.map((i) => i.view);

const BY_VIEW = new Map<string, IDEActivityItem>(IDE_ACTIVITY_ITEMS.map((i) => [i.view, i]));

/** 그 뷰의 표 항목. 모르는 이름이면 `undefined`(저장된 옛 이름이 섞여 들어올 수 있다). */
export function activityItem(view: string): IDEActivityItem | undefined {
  return BY_VIEW.get(view);
}
