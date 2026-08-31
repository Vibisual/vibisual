import { spliceValue, type TextFieldMenuHandlers } from './textFieldContextMenu.js';

/**
 * textFieldActions.ts — 입력칸 우클릭 메뉴가 실제로 하는 일(DOM 조작).
 *
 * 항목 목록(`textFieldContextMenu.ts`)과 화면(`IDEContextMenu`)에서 떼어 둔 이유는, 이 파일만이
 * **브라우저마다 다르게 막히는 자리**이기 때문이다 — 클립보드 권한·`execCommand` 폐기·제어
 * 컴포넌트의 값 되감기 셋이 여기서 만난다. 한 곳에 모아 두면 막힌 길이 생겼을 때 고칠 자리가 하나다.
 */

export type TextFieldElement = HTMLInputElement | HTMLTextAreaElement;

/** 우클릭 순간의 선택 범위. 선택 API 를 안 주는 입력 유형(email·number)에서는 `null`. */
export interface FieldSelection {
  start: number | null;
  end: number | null;
}

/**
 * `type="email"`·`type="number"` 는 `selectionStart` 를 주지 않는다(브라우저가 `null` 을 주거나
 * 던진다 — 세 OS 공통 Chromium 규약). 그 유형에서도 메뉴는 떠야 하므로 "모른다"를 정상으로 다룬다.
 */
export function readFieldSelection(el: TextFieldElement): FieldSelection {
  try {
    return { start: el.selectionStart, end: el.selectionEnd };
  } catch {
    return { start: null, end: null };
  }
}

/** 선택 범위를 모르는 입력 유형에서는 "고른 글자가 있다"로 본다 — 자세한 까닭은 `TextFieldMenuState`. */
export function hasSelectionFrom(sel: FieldSelection): boolean {
  if (sel.start === null || sel.end === null) return true;
  return sel.end > sel.start;
}

/** 초점을 되돌리고 우클릭 순간의 선택도 복원한다 — 메뉴 버튼을 누르는 사이 초점이 옮겨가기 때문. */
export function focusWithSelection(el: TextFieldElement, sel: FieldSelection): void {
  el.focus();
  if (sel.start === null || sel.end === null) return;
  try {
    el.setSelectionRange(sel.start, sel.end);
  } catch {
    // 선택 API 를 안 주는 입력 유형 — 브라우저가 둔 caret 을 그대로 쓴다.
  }
}

/**
 * 입력칸 값을 **React 가 알아채게** 바꾼다.
 *
 * `el.value = next` 로 끝내면 안 된다 — React 는 제어 입력의 인스턴스 `value` 세터를 자기 것으로
 * 갈아 끼워 변화를 추적하므로, 그 자리에 직접 쓰면 다음 렌더에서 **옛 값으로 되감긴다**(붙여넣은
 * 글자가 한 프레임 뒤 사라진다). 그래서 **프로토타입의 원래 세터**로 쓰고 `input` 이벤트를 손수
 * 띄워 React 의 `onChange` 가 정상 경로로 값을 받아 가게 한다. 비제어 입력에도 무해하다.
 */
export function setFieldValue(el: TextFieldElement, next: string): void {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, next);
  else el.value = next;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * 선택 범위를 주어진 글자로 갈아 끼운다.
 *
 * `insertText` 를 먼저 쓰는 이유는 둘 — 브라우저의 **되돌리기 기록이 끊기지 않고**, 값 반영이
 * 정상 입력과 완전히 같은 길(네이티브 input 이벤트)을 탄다. 지원하지 않는 환경에서만 손계산으로 물러선다.
 */
export function replaceFieldSelection(
  el: TextFieldElement,
  sel: FieldSelection,
  insert: string,
): void {
  focusWithSelection(el, sel);
  if (document.execCommand('insertText', false, insert)) return;

  const start = sel.start ?? el.value.length;
  const end = sel.end ?? el.value.length;
  const next = spliceValue(el.value, start, end, insert);
  setFieldValue(el, next.value);
  requestAnimationFrame(() => {
    el.focus();
    try {
      el.setSelectionRange(next.caret, next.caret);
    } catch {
      // 선택 API 를 안 주는 입력 유형 — caret 은 브라우저가 정한다.
    }
  });
}

/**
 * 잘라내기·복사·붙여넣기·전체 선택의 실제 동작.
 *
 * **클립보드는 세 겹이다** — 어느 한 길이 막힌 환경(권한 거부·`execCommand` 폐기·구형 웹뷰)에서도
 * 남는 길이 있어야 한다. 사용자에게 "우클릭은 뜨는데 붙여넣기만 안 먹는다"는 더 나쁜 고장이다.
 *  1. 복사·잘라내기: `execCommand('copy'/'cut')` — 메뉴 클릭이 사용자 제스처라 세 OS 공통으로 먹는다.
 *  2. 막히면 `navigator.clipboard.writeText()`.
 *  3. 붙여넣기: `clipboard.readText()` → `insertText`, 그마저 막히면 `execCommand('paste')`.
 */
export function createTextFieldActions(
  el: TextFieldElement,
  sel: FieldSelection,
): TextFieldMenuHandlers {
  /** 우클릭 순간의 선택 글자. 범위를 모르는 입력 유형이면 `null`(→ `execCommand` 에 맡긴다). */
  const selectedText = (): string | null => {
    if (sel.start === null || sel.end === null) return null;
    return el.value.slice(sel.start, sel.end);
  };

  return {
    copy: (): void => {
      focusWithSelection(el, sel);
      if (document.execCommand('copy')) return;
      const text = selectedText();
      if (text) void navigator.clipboard?.writeText(text).catch(() => { /* 클립보드 거부는 조용히 */ });
    },
    cut: (): void => {
      focusWithSelection(el, sel);
      if (document.execCommand('cut')) return;
      const text = selectedText();
      if (text) void navigator.clipboard?.writeText(text).catch(() => { /* 클립보드 거부는 조용히 */ });
      replaceFieldSelection(el, sel, '');
    },
    paste: (): void => {
      focusWithSelection(el, sel);
      const read = navigator.clipboard?.readText?.();
      if (!read) {
        // 클립보드 읽기가 아예 없는 환경 — 브라우저 기본 붙여넣기에 맡긴다.
        document.execCommand('paste');
        return;
      }
      void read
        .then((clip) => { if (clip) replaceFieldSelection(el, sel, clip); })
        // 권한이 막혔을 때의 마지막 길. 실패해도 조용히 — 사용자는 Ctrl+V 로 갈 수 있다.
        .catch(() => { document.execCommand('paste'); });
    },
    selectAll: (): void => {
      el.focus();
      el.select();
    },
  };
}
