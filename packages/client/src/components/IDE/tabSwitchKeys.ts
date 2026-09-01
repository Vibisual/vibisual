/**
 * tabSwitchKeys.ts — **§5.5 #17-37 세션 탭 전환 단축키의 판정 한 곳.**
 *
 * 키를 뜻으로 바꾸는 일(`resolveTabSwitchIntent`)과, 그 뜻을 탭 순서에 적용해 갈 곳을 고르는
 * 일(`applyTabSwitch`)만 한다. DOM·스토어·React 를 모르는 순수 함수라 실기(mac·리눅스) 없이도
 * 세 OS 의 조합을 단위 테스트로 전부 확인할 수 있다 — 우리에게는 이것이 규칙을 지켰는지 확인하는
 * 유일한 방법이다([docs/rules/multiplatform.md] "플랫폼 분기는 인자로 받는다").
 *
 * 배정(#17-37 ①): `Ctrl+Tab`/`Ctrl+Shift+Tab` 순환 · `Ctrl+PageDown`/`Ctrl+PageUp` 같은 동작의
 * 별칭 · `Ctrl+1`~`Ctrl+9` N번째 탭 직행(**9 는 언제나 마지막 탭**).
 */

/** 탭 하나를 가리키는 값. `null` = 메인(에이전트 전체) 탭 — 훅 에이전트에만 있다. */
export type TabKey = string | null;

/** 키가 말한 뜻. `cycle` = 옆으로 한 칸, `index` = N번째(0-based), `last` = 마지막 탭. */
export type TabSwitchIntent =
  | { kind: 'cycle'; delta: 1 | -1 }
  | { kind: 'index'; index: number }
  | { kind: 'last' };

/** `KeyboardEvent` 중 판정에 쓰는 것만. 테스트가 이벤트를 만들지 않아도 되게 좁게 받는다. */
export interface TabSwitchKeyLike {
  /** 자판 배열과 무관한 물리 키(`Tab`·`PageDown`·`Digit3`·`Numpad3`). */
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** `Ctrl+숫자` 로 받는 자리 — `Digit1`~`Digit9` 와 숫자패드 둘 다. */
const DIGIT_CODE = /^(?:Digit|Numpad)([1-9])$/;

/**
 * 키 → 뜻. 우리 것이 아니면 `null`(그 자리에서 손을 뗀다).
 *
 * ⚠ **Tab 계열만 `ctrlKey` 를 곧이곧대로 본다.** 이 저장소의 다른 단축키는 전부
 * `ctrlKey || metaKey` 지만(mac 은 ⌘), **`⌘Tab` 은 macOS 의 앱 전환**이라 애초에 우리에게
 * 도달하지 않는다 — VS Code 가 mac 에서만 `⌃Tab` 을 쓰는 이유이고 그래서 mac 에서도 진짜
 * Control 로 못 박는다(#17-37 ③). PageUp/PageDown·숫자는 종전 규약대로 `ctrlKey || metaKey`.
 *
 * `Alt` 가 눌린 조합은 통째로 비켜선다 — `Alt+숫자` 는 §5.4 #30 북마크 지정의 것이고,
 * `Ctrl+Alt` 는 일부 유럽 자판에서 AltGr 이라 글자 입력을 가로챌 수 있다(#17-1 과 같은 규율).
 */
export function resolveTabSwitchIntent(e: TabSwitchKeyLike): TabSwitchIntent | null {
  if (e.altKey) return null;

  if (e.code === 'Tab') {
    if (!e.ctrlKey) return null;
    return { kind: 'cycle', delta: e.shiftKey ? -1 : 1 };
  }

  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return null;
  // 아래 둘은 Shift 를 쓰지 않는다 — 브라우저에서 `Ctrl+Shift+PageDown` 은 "탭을 옮기는" 뜻이라
  //   같은 손짓이 우리에게서 다른 일을 하면 안 된다(지금은 옮기기가 없으므로 그냥 비켜선다).
  if (e.shiftKey) return null;

  if (e.code === 'PageDown') return { kind: 'cycle', delta: 1 };
  if (e.code === 'PageUp') return { kind: 'cycle', delta: -1 };

  const digit = DIGIT_CODE.exec(e.code);
  if (digit) {
    const n = Number(digit[1]);
    // 9 는 "아홉 번째"가 아니라 **마지막**이다(브라우저 관례) — 탭이 셋이면 `Ctrl+9` 는 세 번째다.
    return n === 9 ? { kind: 'last' } : { kind: 'index', index: n - 1 };
  }
  return null;
}

/**
 * 뜻 + 지금 탭 순서 → 갈 탭. 갈 곳이 없거나 **이미 거기 있으면** `null`(아무 일도 하지 않는다).
 *
 * 돌려주는 값을 `TabKey` 로 두면 "메인 탭(`null`)으로 가라"와 "갈 곳 없음"이 같은 값이 된다 —
 * 그래서 감싼 객체로 돌려준다(§ 두 뜻을 한 값에 담지 않는다).
 */
export function applyTabSwitch(
  order: readonly TabKey[],
  current: TabKey,
  intent: TabSwitchIntent,
): { target: TabKey } | null {
  if (order.length === 0) return null;

  let target: TabKey;
  if (intent.kind === 'cycle') {
    // 탭이 하나뿐이면 순환은 제자리다 — 아래 "제자리면 no-op" 에도 걸리지만 뜻을 먼저 밝혀 둔다.
    if (order.length < 2) return null;
    const at = order.indexOf(current);
    // 지금 탭이 목록에 없으면(닫히는 중 등) 끝에서 시작한다 — 다음은 첫 탭, 이전은 마지막 탭.
    const from = at < 0 ? (intent.delta > 0 ? -1 : 0) : at;
    const next = (from + intent.delta + order.length) % order.length;
    target = order[next] as TabKey;
  } else if (intent.kind === 'last') {
    target = order[order.length - 1] as TabKey;
  } else {
    // 없는 자리로의 직행은 아무 일도 하지 않는다 — 탭이 셋인데 `Ctrl+5` 를 눌러도 화면은 그대로.
    if (intent.index >= order.length) return null;
    target = order[intent.index] as TabKey;
  }

  if (target === current) return null;
  return { target };
}
