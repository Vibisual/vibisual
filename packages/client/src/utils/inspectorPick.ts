/**
 * §5.4 #15 (C) — 그림 안쪽 집기 공급자. DOM 없이 그린 화면(캔버스 영상 미리보기 등)은 브라우저가 판 하나만 알아 Alt 인스펙터가 어디를 가리켜도 판이 통째로 집힌다.
 * 그래서 판을 그린 쪽이 판에 공급자를 단다 — 인스펙터는 집은 요소가 공급자를 단 판 자신일 때만 묻는다(판 위의 단추·입력칸은 DOM 으로 집힌다). 코어는 답의 모양만 안다(앱 이름 ❌ — §5.13 (P) 독립 규약).
 * 그린 것을 DOM 으로 품는 판(SVG — 브라우저는 안의 `<rect>` 를 집는다)은 `subtree` 로 단다. 안에 단추·입력칸을 두는 판에는 켜지 말 것(공급자가 가져간다).
 * 좌표는 판 안의 보이는 픽셀(왼쪽 위 (0,0), 보이는 크기). CSS `zoom` 보정(§5.4 #15 (B))은 코어가 한 번 한다 — 공급자는 자기 그림의 비율만 옮긴다.
 */

/** 공급자에게 묻는 자리 — 판 안의 보이는 픽셀과 판의 보이는 크기. */
export interface InspectorPickPoint {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 공급자가 답한 한 칸(예: 그 글자 · 그 글자가 속한 아이템). */
export interface InspectorPickLevel {
  /** 판 안의 보이는 픽셀 상자. */
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** 말풍선 첫 줄 · 복사 알림 — 태그 자리에 서는 짧은 이름. */
  readonly label: string;
  /** 말풍선 둘째 줄 — 그 자리의 글자. */
  readonly text: string;
  /** 누르면 복사할 글(받는 AI 가 그대로 읽는다). */
  readonly clipboard: string;
}

/**
 * 가장 안쪽이 0 — 휠을 위로 굴리면 다음 칸으로 오르고, 칸이 다하면 판(DOM)부터 부모로 이어 오른다.
 * 빈 배열이면 "여기엔 그린 것이 없다" — 판이 그대로 DOM 으로 집힌다.
 */
export type InspectorPickLevels = readonly InspectorPickLevel[];

export type InspectorPicker = (at: InspectorPickPoint) => InspectorPickLevels | PromiseLike<InspectorPickLevels>;

export interface InspectorPickerOptions {
  /** 판 안쪽 요소(SVG 도형)가 집혀도 이 공급자에게 묻는다. 기본은 판 자신일 때만. */
  readonly subtree?: boolean;
}

interface PickerEntry {
  readonly picker: InspectorPicker;
  readonly subtree: boolean;
}

const pickers = new WeakMap<Element, PickerEntry>();

/** 판에 공급자를 단다. 돌려준 함수로 뗀다(그사이 다른 공급자가 달렸으면 그것은 두고). */
export function registerInspectorPicker(host: Element, picker: InspectorPicker, options?: InspectorPickerOptions): () => void {
  const entry: PickerEntry = { picker, subtree: options?.subtree === true };
  pickers.set(host, entry);
  return () => {
    if (pickers.get(host) === entry) pickers.delete(host);
  };
}

/** 집은 요소에 답할 판과 그 공급자. */
export interface InspectorPickerHit {
  readonly host: Element;
  readonly picker: InspectorPicker;
}

/**
 * 브라우저가 집은 요소를 맡을 공급자 — 공급자를 단 판 자신이면 그 판, `subtree` 판의 안쪽이면 그 판이다. 가장 가까운
 * 판 하나만 본다: 그 판이 `subtree` 가 아니면 그 위의 요소(단추·입력칸)는 DOM 으로 집힌다(null).
 */
export function inspectorPickerAt(el: Element | null): InspectorPickerHit | null {
  if (!el) return null;
  const own = pickers.get(el);
  if (own) return { host: el, picker: own.picker };
  for (let cur = el.parentElement; cur; cur = cur.parentElement) {
    const entry = pickers.get(cur);
    if (entry) return entry.subtree ? { host: cur, picker: entry.picker } : null;
  }
  return null;
}

export function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}
