import type { ContextMenuItem } from '../components/IDE/IDEContextMenu.js';
// 단축키 라벨은 플랫폼이 정한다 — mac 에서 실제로 눌리는 키는 Ctrl 이 아니라 Command 다.
import { shortcutLabel } from '../utils/platform.js';

/**
 * textFieldContextMenu.ts — 한 줄 입력칸(`input`/`textarea`) 우클릭 **메뉴 항목 목록**(순수 로직).
 *
 * Electron 패키지 빌드에는 브라우저 기본 우클릭 메뉴가 없다. IDE 입력창·편집창은 그래서 각자
 * 메뉴를 그려 뒀지만, 그 밖의 평범한 입력칸(로그인 창의 인증 코드 등)은 우클릭이 아무 것도
 * 하지 않아 **붙여넣기 자체가 불가능**했다. 이 파일은 그 입력칸들이 공유할 항목 목록이다.
 *
 * 무엇이 흐려지는지는 화면을 띄우지 않고도 답이 나와야 한다 — 고른 글자가 없으면 잘라내기·복사가
 * 흐려지고, 읽기 전용이면 잘라내기·붙여넣기가 흐려진다. 그래서 목록 만들기를 컴포넌트에서 떼어
 * 여기 두고 `textFieldContextMenu.test.ts` 로 못 박는다.
 *
 * i18n 은 호출부가 넘긴 `t` 로만 만든다(모듈 레벨 하드코딩 문자열 ❌ — 언어 전환이 안 따라온다).
 * 키는 편집창이 쓰던 `ide.editor.ctx.*` 를 그대로 쓴다 — "잘라내기/복사/붙여넣기/전체 선택" 은
 * 같은 낱말이라 번역을 두 벌 들 이유가 없다.
 */

/** `useTranslation()` 의 `t` 중 우리가 쓰는 모양만. */
export type MenuText = (key: string, opts?: Record<string, unknown>) => string;

export interface TextFieldMenuState {
  /**
   * 고른 글자가 있는가.
   *
   * `type="email"`·`type="number"` 처럼 선택 API 를 안 주는 입력 유형에서는 알 방법이 없다 —
   * 그때는 `true` 로 두는 쪽이 맞다. **고른 글자가 있는데 복사가 흐려진 것**이 그 반대보다
   * 훨씬 나쁜 고장이기 때문이다(눌러도 아무 일이 없는 쪽은 최소한 되돌릴 게 없다).
   */
  hasSelection: boolean;
  /** 읽기 전용·비활성 입력칸 — 글자를 바꾸는 항목이 흐려진다. */
  readOnly: boolean;
}

export interface TextFieldMenuHandlers {
  cut: () => void;
  copy: () => void;
  paste: () => void;
  selectAll: () => void;
}

/**
 * 잘라내기 · 복사 · 붙여넣기 · 전체 선택.
 *
 * `readOnlyTitle` 은 읽기 전용이라 흐려진 항목의 툴팁이다. 안 주면 툴팁 없이 흐려진다 —
 * 입력칸마다 "왜 읽기 전용인지"가 달라 공용 문구를 만들어 둘 수 없다(호출부가 안다).
 */
export function buildTextFieldMenuItems(
  state: TextFieldMenuState,
  h: TextFieldMenuHandlers,
  t: MenuText,
  readOnlyTitle?: string,
): ContextMenuItem[] {
  const needSelection = t('ide.editor.ctx.needSelection');

  return [
    {
      id: 'cut',
      label: t('ide.editor.ctx.cut'),
      hint: shortcutLabel('Ctrl+X'),
      disabled: state.readOnly || !state.hasSelection,
      disabledTitle: state.readOnly ? readOnlyTitle : needSelection,
      onClick: h.cut,
    },
    {
      id: 'copy',
      label: t('ide.editor.ctx.copy'),
      hint: shortcutLabel('Ctrl+C'),
      disabled: !state.hasSelection,
      disabledTitle: needSelection,
      onClick: h.copy,
    },
    {
      id: 'paste',
      label: t('ide.editor.ctx.paste'),
      hint: shortcutLabel('Ctrl+V'),
      disabled: state.readOnly,
      disabledTitle: readOnlyTitle,
      onClick: h.paste,
    },
    {
      id: 'selectAll',
      label: t('ide.editor.ctx.selectAll'),
      hint: shortcutLabel('Ctrl+A'),
      separatorBefore: true,
      onClick: h.selectAll,
    },
  ];
}

/**
 * 우클릭 메뉴가 아무 값어치도 없는 `input` 유형 — 글자를 치는 칸이 아니다.
 * (`disabled` 는 별도 판정: 브라우저가 마우스 이벤트조차 안 주지만 그물은 쳐 둔다.)
 */
const NON_TEXT_INPUT_TYPES = new Set([
  'checkbox', 'radio', 'color', 'file', 'range', 'hidden', 'button', 'submit', 'reset', 'image',
]);

/** 전역 우클릭이 판정에 쓰는 것만 추린 대상 모양(DOM 없이 시험할 수 있게). */
export interface TextFieldTargetShape {
  /** 태그명. 대소문자는 상관없다. */
  tagName: string;
  /** `input` 의 `type`. `textarea` 에는 없다. */
  type?: string | undefined;
  disabled?: boolean;
  /**
   * **이미 자기 우클릭 메뉴를 가진 자리**인가(IDE 입력창·편집창·터미널).
   * 전역이 가로채면 그쪽의 풍부한 항목(웹에서 검색·되돌리기·저장…)이 통째로 죽는다.
   */
  ownsMenu?: boolean;
}

/**
 * 이 자리에 전역 입력칸 메뉴를 띄울 것인가.
 *
 * 전역 하나로 앱의 모든 입력칸을 덮는 대신, **끄는 자리를 셀 수 있게** 만든 것이 이 함수다 —
 * 예외를 코드 곳곳의 조건문에 흩어 두면 다음 사람이 그 목록을 다시 모을 방법이 없다.
 */
export function shouldOpenTextFieldMenu(shape: TextFieldTargetShape): boolean {
  if (shape.ownsMenu === true) return false;
  if (shape.disabled === true) return false;
  const tag = shape.tagName.toUpperCase();
  if (tag === 'TEXTAREA') return true;
  if (tag !== 'INPUT') return false;
  // 경로가 아니라 **입력 유형 이름**이라 접어도 안전하다(§ 멀티플랫폼 1번의 경로 규칙과 무관).
  return !NON_TEXT_INPUT_TYPES.has((shape.type ?? 'text').toLowerCase());
}

/**
 * `[start, end)` 를 `insert` 로 갈아 끼운 값과 그 뒤 caret 위치.
 *
 * 브라우저의 `insertText` 가 막힌 환경에서만 쓰는 **되돌아갈 자리**라, 범위가 뒤집혀 있거나
 * 값 밖으로 나가 있어도 조용히 바로잡는다(우클릭 시점과 실행 시점 사이에 값이 짧아질 수 있다).
 */
export function spliceValue(
  value: string,
  start: number,
  end: number,
  insert: string,
): { value: string; caret: number } {
  const lo = Math.max(0, Math.min(value.length, Math.min(start, end)));
  const hi = Math.max(0, Math.min(value.length, Math.max(start, end)));
  return { value: value.slice(0, lo) + insert + value.slice(hi), caret: lo + insert.length };
}
