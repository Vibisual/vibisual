import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/**
 * 카드 안 고른 부분만 뽑는다("선택 복사"). ① 카드 경계에서 자른다 ② 블록 태그·`<br>` 에서 줄을 바꾼다(`Range.toString()` 은 블록을 무시)
 * — 버튼·글리프(svg)는 내용이 아니라 뺀다. ⚠ 쓰는 버튼은 `onMouseDown` 에서 `preventDefault()`(기본 동작이 선택 해제).
 * ⚠⚠ 선택은 누르기 전에도 풀린다(재렌더·재활용·앞 절단) — 고른 순간 떠 두고(`rememberSelection`) 카드 밖 모듈 Map 에 둔다.
 * ⚠⚠⚠ 체크박스로 고른 것도 원천이다(`CheckedSelection` — `decideSelectionCopy`·`getText` 양쪽).
 */

/** 화면에서 보이는 "덩어리" — 앞뒤로 줄을 바꿔야 붙여넣은 텍스트가 화면과 같은 모양이 된다. */
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION',
  'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN',
  'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TD', 'TH', 'TR', 'UL',
]);

/** 텍스트로 옮기면 안 되는 조각 — 조작용 컨트롤과 장식 글리프. */
function isNonContent(el: Element): boolean {
  const tag = el.tagName.toUpperCase();
  if (tag === 'BUTTON' || tag === 'SVG' || tag === 'INPUT' || tag === 'SELECT') return true;
  return el.getAttribute('aria-hidden') === 'true';
}

/** 선택 조각(fragment)을 화면에서 보이는 모양의 텍스트로. 블록 경계·`<br>` 에서 줄바꿈. */
function serializeFragment(frag: DocumentFragment): string {
  let out = '';
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) { out += node.textContent ?? ''; return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (isNonContent(el)) return;
    if (el.tagName.toUpperCase() === 'BR') { out += '\n'; return; }
    const block = BLOCK_TAGS.has(el.tagName.toUpperCase());
    if (block && out !== '' && !out.endsWith('\n')) out += '\n';
    el.childNodes.forEach(visit);
    if (block && out !== '' && !out.endsWith('\n')) out += '\n';
  };
  frag.childNodes.forEach(visit);
  return out;
}

/** 선택을 root 경계 안으로 자른 사본(안 겹치면 버린다). 선택은 그 카드가 사는 문서에서 읽는다 — 별창에서도 맞는 선택을 보게. */
function clippedRanges(root: HTMLElement): Range[] {
  const sel = root.ownerDocument.defaultView?.getSelection() ?? null;
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return [];
  const out: Range[] = [];
  try {
    const bounds = root.ownerDocument.createRange();
    bounds.selectNodeContents(root);
    for (let i = 0; i < sel.rangeCount; i++) {
      const r = sel.getRangeAt(i);
      if (r.collapsed) continue;
      try {
        if (!r.intersectsNode(root)) continue;
        const clipped = r.cloneRange();
        if (clipped.compareBoundaryPoints(Range.START_TO_START, bounds) < 0) {
          clipped.setStart(bounds.startContainer, bounds.startOffset);
        }
        if (clipped.compareBoundaryPoints(Range.END_TO_END, bounds) > 0) {
          clipped.setEnd(bounds.endContainer, bounds.endOffset);
        }
        if (!clipped.collapsed) out.push(clipped);
      } catch {
        // 선택이 걸린 노드가 방금 사라졌거나(스트림 리렌더) 다른 문서 — 그 조각만 건너뛴다.
      }
    }
  } catch {
    return [];
  }
  return out;
}

/** 입력칸의 선택은 DOM Range에 들어 있지 않으므로 활성 입력칸의 범위를 따로 읽는다. */
function activeTextSelection(doc: Document): { element: Element; text: string } | null {
  const element = doc.activeElement;
  if (!element || (element.tagName !== 'TEXTAREA' && element.tagName !== 'INPUT')) return null;
  const input = element as HTMLTextAreaElement | HTMLInputElement;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  if (start === null || end === null || start === end) return null;
  return { element, text: input.value.slice(start, end) };
}

/** 지금 선택이 이 카드와 겹치는가 — DOM 조각 직렬화 없이 버튼 활성 여부만 판단한다. */
export function hasSelectionWithin(root: HTMLElement | null): boolean {
  if (!root) return false;
  const input = activeTextSelection(root.ownerDocument);
  if (input) return root.contains(input.element);
  return clippedRanges(root).length > 0;
}

/** 이 문서 어딘가에 살아 있는(펼쳐진) 선택이 있는가 — "고른 게 다른 카드 몫" 판정용. */
function hasLiveSelection(doc: Document): boolean {
  if (activeTextSelection(doc)) return true;
  const sel = doc.defaultView?.getSelection() ?? null;
  return sel !== null && sel.rangeCount > 0 && !sel.isCollapsed;
}

/** 이 카드 안쪽으로 자른 선택 텍스트. 선택이 없거나 카드 밖이면 빈 문자열. */
export function selectionTextWithin(root: HTMLElement | null): string {
  if (!root) return '';
  const input = activeTextSelection(root.ownerDocument);
  if (input) return root.contains(input.element) ? input.text : '';
  const parts = clippedRanges(root)
    .map((r) => serializeFragment(r.cloneContents()))
    .filter((s) => s.trim() !== '');
  return parts
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')   // 줄 끝 공백(들여쓰기 잔여) 제거
    .replace(/\n{3,}/g, '\n\n')   // 블록이 겹쳐 생긴 빈 줄 과다 정리
    .trim();
}

/* 떠 둔 선택은 모듈 스코프에 — useRef 면 선택을 죽이는 그 재마운트에 함께 죽는다. 키는 카드 id. ⚠ 키 개수 캡(§9) — 키를 무한히 받으면 용량이 폭증한다. */

/** 카드별로 떠 두는 최대 개수(가장 오래 안 쓴 것부터 버린다). */
export const REMEMBERED_SELECTION_MAX = 24;
/** 떠 두는 한 벌의 최대 길이 — 카드 하나를 통째로 골라도 이 안에서 끝난다. */
export const REMEMBERED_SELECTION_MAX_CHARS = 20000;

const REMEMBERED = new Map<string, string>();

/** 지금 고른 것을 그 카드 몫으로 떠 둔다. 빈 문자열은 기억을 지우지 않는다(선택이 풀린 것뿐). */
export function rememberSelection(key: string, text: string): void {
  if (key === '' || text === '') return;
  REMEMBERED.delete(key); // 다시 넣어 최신 순서로 (Map 은 삽입 순서 = LRU 꼬리)
  REMEMBERED.set(key, text.slice(0, REMEMBERED_SELECTION_MAX_CHARS));
  while (REMEMBERED.size > REMEMBERED_SELECTION_MAX) {
    const oldest = REMEMBERED.keys().next().value;
    if (oldest === undefined) break;
    REMEMBERED.delete(oldest);
  }
}

/** 그 카드에서 마지막으로 고른 것. 없으면 빈 문자열. */
export function recallSelection(key: string): string {
  return REMEMBERED.get(key) ?? '';
}

/** 테스트·초기화용 — 떠 둔 것을 전부 잊는다. */
export function forgetRememberedSelections(): void {
  REMEMBERED.clear();
}

/** 켜도 되는가: `live` 켬 · `checked` 켬(이 카드 몫이 확실해 `elsewhere` 보다 앞선다) · `elsewhere` 잠금(엉뚱한 대목 ❌) · `remembered` 켬(풀린 뒤에도 가져가게). */
export function decideSelectionCopy(input: {
  live: boolean;
  elsewhere: boolean;
  remembered: boolean;
  /** 체크박스 선택(질문 카드의 답지 체크). 없는 카드도 있어 선택 인자. */
  checked?: boolean;
}): boolean {
  if (input.live) return true;
  if (input.checked === true) return true;
  if (input.elsewhere) return false;
  return input.remembered;
}

export interface CardSelectionCopy {
  /** 버튼을 켜도 되는가. */
  enabled: boolean;
  /** 지금 복사할 텍스트 — 살아 있는 선택 → 체크박스 선택 → 떠 둔 것 순. */
  getText: () => string;
}

/** 드래그 말고 고른 것(답지 체크박스). 조립은 카드가 알고 이 훅은 있고 없음만 본다. */
export interface CheckedSelection {
  /** 지금 고른 것이 있는가(0개면 false). */
  present: boolean;
  /** 그 선택을 복사할 텍스트로. */
  getText: () => string;
}

/** 겹침 판정은 매번, 텍스트 뜨기는 rAF 로 프레임당 한 번. `checked` 는 리액트 상태라 구독 없이 ref 로 최신 값만 든다 — `getText` 정체성이 바뀌면 헤더 복사 버튼 `memo` 가 깨진다. */
export function useCardSelectionCopy(
  ref: RefObject<HTMLElement | null>,
  key: string,
  checked?: CheckedSelection,
): CardSelectionCopy {
  const [state, setState] = useState<{ live: boolean; elsewhere: boolean; remembered: boolean }>(
    () => ({ live: false, elsewhere: false, remembered: recallSelection(key) !== '' }),
  );
  const checkedRef = useRef<CheckedSelection | undefined>(checked);
  checkedRef.current = checked;

  useEffect(() => {
    const doc = ref.current?.ownerDocument ?? document;
    // rAF 는 **그 카드가 사는 창**의 것으로 — 별창(분리된 창)은 자기 프레임 타이밍을 쓴다.
    const view = doc.defaultView ?? window;
    let raf: number | null = null;

    const snapshot = (): void => {
      raf = null;
      const text = selectionTextWithin(ref.current);
      if (text === '') return;
      rememberSelection(key, text);
      setState((prev) => (prev.remembered ? prev : { ...prev, remembered: true }));
    };

    const sync = (): void => {
      const live = hasSelectionWithin(ref.current);
      const elsewhere = !live && hasLiveSelection(doc);
      setState((prev) => {
        const remembered = prev.remembered || recallSelection(key) !== '';
        if (prev.live === live && prev.elsewhere === elsewhere && prev.remembered === remembered) return prev;
        return { live, elsewhere, remembered };
      });
      if (live && raf === null) raf = view.requestAnimationFrame(snapshot);
    };

    sync();
    doc.addEventListener('selectionchange', sync);
    // 입력칸의 select 이벤트는 버블하지 않는다. 키보드 선택과 다른 카드로의 포커스 이동도 반영한다.
    doc.addEventListener('select', sync, true);
    doc.addEventListener('focusin', sync);
    // 드래그가 끝나는 순간을 **따로** 한 번 더 본다. `selectionchange` 하나에만 매달리면 그 이벤트가
    // 한 번이라도 새면(창 전환·포인터 취소 등) 버튼이 회색인 채로 남고, 사용자는 분명히 골랐는데
    // 누를 수가 없다 — 같은 계산을 두 신호로 받는 값싼 보험이다(같은 값이면 setState 가 멈춘다).
    doc.addEventListener('mouseup', sync, { passive: true });
    doc.addEventListener('touchend', sync, { passive: true });
    return () => {
      doc.removeEventListener('selectionchange', sync);
      doc.removeEventListener('select', sync, true);
      doc.removeEventListener('focusin', sync);
      doc.removeEventListener('mouseup', sync);
      doc.removeEventListener('touchend', sync);
      if (raf !== null) view.cancelAnimationFrame(raf);
    };
  }, [ref, key]);

  const getText = useCallback((): string => {
    const liveText = selectionTextWithin(ref.current);
    if (liveText !== '') {
      // 살아 있는 선택이 곧 최신 — 기억도 여기서 함께 갱신한다(rAF 가 못 돈 경우의 안전망).
      rememberSelection(key, liveText);
      return liveText;
    }
    // 체크박스로 고른 것은 **화면에 그대로 남아 있는 선택**이라, 이미 풀려 보이지 않는 드래그
    // 기억보다 먼저다(사용자가 보고 있는 것과 붙여넣은 것이 어긋나면 안 된다).
    const checkedText = checkedRef.current?.present === true ? checkedRef.current.getText() : '';
    if (checkedText !== '') return checkedText;
    // 다른 카드의 입력칸을 고른 상태에서 이전 카드의 기억을 복사하지 않는다.
    const doc = ref.current?.ownerDocument;
    if (doc && hasLiveSelection(doc)) return '';
    return recallSelection(key);
  }, [ref, key]);

  return {
    enabled: decideSelectionCopy({ ...state, checked: checked?.present === true }),
    getText,
  };
}
