import type { IDEViewType } from '../../stores/graphStore.js';

/**
 * §5.5 #16-1 — IDE 좌측 **활동바 항목의 정본 표**.
 *
 * 종전에는 항목이 두 벌로 살았다 — 앞의 넷은 `ACTIVITIES` 배열에서 `map` 으로, 나머지 열하나는
 * JSX 로 하나씩 손으로 적혀 있었다. 그래서 **순서를 바꾸거나 하나를 내려놓는 일이 구조적으로
 * 불가능했고**(배열 밖 항목은 코드 위치가 곧 순서다), 기억 정리 칸만 `mt-auto` 로 바닥에 떨어져
 * 나머지와 다른 규칙으로 살았다. 여기 한 벌로 모은 뒤에야 순서·제외가 데이터가 된다.
 *
 * 이 파일은 **아이콘도 스토어도 모른다**(순수 데이터 + 타입 하나). 아이콘은 `ideActivityIcons.tsx`,
 * 순서를 합치는 규칙은 shared `ideActivityBar.ts`, 배지·점등은 활동바 컴포넌트가 소유한다.
 */
export interface IDEActivityItem {
  view: IDEViewType;
  /** i18n 키. `subagents` 만 `{{count}}` 를 받는다(툴팁이 그 수를 말한다). */
  labelKey: string;
  /**
   * 활성일 때 왼쪽 테두리 색.
   *
   * Tailwind 는 `border-${x}-400` 같은 **동적 클래스명을 만들지 못한다**(빌드 때 문자열을 훑어
   * 만들 클래스를 정한다) — 그래서 전체 클래스명을 그대로 적는다.
   */
  accent: string;
}

/**
 * **기본 배치.** 사용자가 한 번도 활동바를 만지지 않았으면 이 순서 그대로 전부 보인다.
 *
 * 배열의 순서는 뜻이 있다 — 같은 결의 물음끼리 붙어 있다:
 * `mcp`·`hooks`·`plugins`(무엇이 이 세션에 실려 있나) · `files`·`context`·`skills`(무엇을 읽나) ·
 * `goal`·`autoGoal`·`loop`·`debug`(무엇을 하고 있나) · `verify`·`specReading`(제대로 했나) ·
 * `subagents`·`bookmarks`(무엇이 남았나). **`brain` 은 걷혔다**(§5.10 — 아래 주석).
 * shared `resolveActivityOrder` 가 **새 칸을 앞 이웃 뒤에 끼우는** 것도 이 짝을 지키기 위함이다.
 */
export const IDE_ACTIVITY_ITEMS: readonly IDEActivityItem[] = [
  // §5.5 #17-31 — 이 프로젝트에서 쓸 수 있는 MCP(무엇이 꽂혀 있나).
  { view: 'mcp', labelKey: 'ide.activityBar.mcp', accent: 'border-blue-400' },
  // §5.5 #17-32 — 이 세션에 적용되는 훅(무엇이 실제로 도는가).
  { view: 'hooks', labelKey: 'ide.activityBar.hooks', accent: 'border-amber-400' },
  // §5.5 #17-33 — Claude Code 자신의 플러그인 + 마켓플레이스.
  { view: 'plugins', labelKey: 'ide.activityBar.plugins', accent: 'border-indigo-400' },
  { view: 'files', labelKey: 'ide.activityBar.files', accent: 'border-blue-400' },
  // §5.5 #17-28 v4.96 — 이 프롬프트 앞에 무엇이 겹쳐 실리는가.
  { view: 'context', labelKey: 'ide.activityBar.context', accent: 'border-blue-400' },
  // §5.5 #17-4 — 스킬.
  { view: 'skills', labelKey: 'ide.activityBar.skills', accent: 'border-blue-400' },
  // §5.5 #17-17 — 세션 목표.
  { view: 'goal', labelKey: 'ide.activityBar.goal', accent: 'border-emerald-400' },
  // §5.10 (P) — 절차 감지(내부 식별자 `autoGoal`). 목표 **바로 뒤**다 — 둘은 묻는 물음이 다르지만
  //   같은 결("무엇을 하고 있나")이라 화면에서 떨어지면 안 된다.
  { view: 'autoGoal', labelKey: 'ide.activityBar.autoGoal', accent: 'border-violet-400' },
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
   * §5.10 — **`brain`(기억 정리) 칸은 걷었다.**
   *
   * 사용자 지시(전면 개편): "기억·메모리·브레인 이런 거 다 버리고 자동 목표라는 이름으로."
   * 그 자리가 하던 일 중 **살아남는 것은 "되풀이한 절차를 스킬로 굳히는 것" 하나**이고, 그것은
   * 위의 `autoGoal`(화면 이름 「절차 감지」) 칸이 이어받았다. 기억 카드·주제 축·리플렉션은
   * 되살리지 않는다 — 걷어낸 것은 걷어낸 채로 둔다.
   *
   * **(P) 되살리지 말아야 하는 것은 칸이 아니라 스위치가 둘이 되는 것이다.** 한때 이 자리에
   * "칸을 도로 세우지 마라"고 적혀 있었는데, 그 규율이 실제로 지키던 것은 **켜는 자리가 하나**라는
   * 약속이었다. 사용자 지시(2026-09-12)로 목표와 절차 감지는 칸이 갈렸고, 스위치는 여전히
   * `IDEAutoGoalView` 한 곳에만 있다 — 목표 뷰에 그 블록을 도로 얹으면 그때 약속이 깨진다
   * (#17-44 ⑧(d) 가 정독에서 이미 겪은 그 구멍).
   */
];

/** 기본 순서(뷰 이름만). shared `resolveActivityOrder` 의 두 번째 인자. */
export const DEFAULT_ACTIVITY_ORDER: readonly IDEViewType[] = IDE_ACTIVITY_ITEMS.map((i) => i.view);

const BY_VIEW = new Map<string, IDEActivityItem>(IDE_ACTIVITY_ITEMS.map((i) => [i.view, i]));

/** 그 뷰의 표 항목. 모르는 이름이면 `undefined`(저장된 옛 이름이 섞여 들어올 수 있다). */
export function activityItem(view: string): IDEActivityItem | undefined {
  return BY_VIEW.get(view);
}
