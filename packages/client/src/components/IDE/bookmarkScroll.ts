/**
 * 북마크 "이동" 스크롤 유틸 — IDE 출력에서 보관 텍스트(또는 그 항목)로 정확히 이동.
 *
 * 설계 배경(§5.5 #17-7 v2.92): 종전 구현은 공백을 무시한 needle 을 단일 텍스트 노드에서 `indexOf`
 * 하고 `scrollIntoView` 로 옮겨, ① 마크다운으로 쪼개진 노드/공백 차이로 검색 실패(스크롤 무반응),
 * ② `scrollIntoView` 가 바깥 스크롤 조상까지 움직여 엉뚱한 곳으로 튐, ③ 가상화(Virtuoso)로 화면 밖
 * 항목은 DOM 에 없어 못 찾음 — 세 문제가 있었다. 그래서 (a) **출처 항목 id** 로 가상 리스트를 먼저
 * `scrollToIndex` 해 렌더시키고, (b) 컨테이너 한정 수동 스크롤로 중앙 정렬, (c) 보관 텍스트는
 * 공백 정규화 + 노드 경계를 넘는 매칭으로 찾아 하이라이트한다.
 */

/**
 * 컨테이너 안에서 보관 텍스트를 찾아 DOM Range 를 돌려준다. 공백을 정규화(연속 공백 1칸)하고
 * 텍스트 노드 경계를 넘어(마크다운 bold/link 로 쪼개진 경우) 매칭한다. 못 찾으면 null.
 */
export function findTextRangeInContainer(container: HTMLElement, raw: string): Range | null {
  const target = raw.replace(/\s+/g, ' ').trim();
  if (!target) return null;
  const needle = target.slice(0, 60); // 앞 60자 정규화 문자열로 매칭(충분히 유일)

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let normalized = '';
  const charNode: Text[] = []; // 정규화 인덱스 → 원본 텍스트 노드
  const charOffset: number[] = []; // 정규화 인덱스 → 그 노드 안 offset
  let prevWasSpace = true; // 선행 공백 collapse
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node as Text;
    const orig = text.textContent ?? '';
    for (let k = 0; k < orig.length; k++) {
      const ch = orig[k]!;
      if (/\s/.test(ch)) {
        if (prevWasSpace) continue;
        normalized += ' ';
        charNode.push(text);
        charOffset.push(k);
        prevWasSpace = true;
      } else {
        normalized += ch;
        charNode.push(text);
        charOffset.push(k);
        prevWasSpace = false;
      }
    }
  }

  const idx = normalized.indexOf(needle);
  if (idx < 0) return null;
  const startNode = charNode[idx];
  const startOff = charOffset[idx];
  const endI = Math.min(idx + needle.length, normalized.length) - 1;
  const endNode = charNode[endI];
  const endOff = (charOffset[endI] ?? 0) + 1;
  if (!startNode || !endNode || startOff === undefined) return null;
  try {
    const range = document.createRange();
    range.setStart(startNode, startOff);
    range.setEnd(endNode, Math.min(endOff, (endNode.textContent ?? '').length));
    return range;
  } catch {
    return null;
  }
}

/** 주어진 rect(뷰포트 좌표)을 컨테이너 뷰포트 중앙으로 — **그 컨테이너만** 스크롤(바깥 조상 무손상). */
function scrollRectIntoCenter(container: HTMLElement, rect: DOMRect): void {
  if (rect.height === 0 && rect.width === 0) return;
  const cRect = container.getBoundingClientRect();
  const delta = (rect.top - cRect.top) - container.clientHeight / 2 + rect.height / 2;
  container.scrollTo({ top: container.scrollTop + delta, behavior: 'smooth' });
}

/** 엘리먼트를 컨테이너 중앙으로 스크롤. */
export function scrollElementIntoCenter(container: HTMLElement, el: HTMLElement): void {
  scrollRectIntoCenter(container, el.getBoundingClientRect());
}

/** 인-페이지 검색이 찾은 텍스트를 칠하는 CSS Custom Highlight 이름(index.css 의 `::highlight()` 와 짝). */
const FIND_HIGHLIGHT_NAME = 'vibisual-find';

/** CSS Custom Highlight 레지스트리 — 미지원 환경(jsdom 등)이면 null. */
function highlightRegistry(): HighlightRegistry | null {
  if (typeof CSS === 'undefined' || typeof Highlight === 'undefined') return null;
  return CSS.highlights ?? null;
}

/** 검색 하이라이트 지우기 — 검색을 닫거나 매칭이 하나도 없을 때. */
export function clearFindHighlight(): void {
  highlightRegistry()?.delete(FIND_HIGHLIGHT_NAME);
}

/**
 * 찾은 range 를 화면에 표시한다.
 *  - `preserveFocus`(인-페이지 검색): **document selection 을 건드리지 않고** CSS Custom Highlight 로 칠한다.
 *    selection 을 본문으로 옮기면 브라우저가 포커스를 쥔 검색 입력창의 caret 을 함께 지워, 한 번 검색한
 *    뒤로는 그 입력창에 이어서 타이핑을 못 한다(사용자 보고: "한번 검색하면 포커싱이 꺼진다").
 *    미지원 환경이면 아무것도 칠하지 않는다 — selection 폴백은 그 포커스 유실을 되살리므로 두지 않는다.
 *  - 그 외(북마크 "이동"): 종전대로 selection 으로 잡아 준다(도착 즉시 복사할 수 있게).
 */
export function markRange(range: Range, preserveFocus = false): void {
  if (preserveFocus) {
    const reg = highlightRegistry();
    if (!reg) return;
    reg.set(FIND_HIGHLIGHT_NAME, new Highlight(range));
    return;
  }
  const sel = window.getSelection();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

/** Range 를 컨테이너 중앙으로 스크롤 + 텍스트 표시(선택 또는 검색 하이라이트 — `markRange` 참고). */
export function scrollRangeIntoCenter(container: HTMLElement, range: Range, preserveFocus = false): void {
  scrollRectIntoCenter(container, range.getBoundingClientRect());
  markRange(range, preserveFocus);
}

/** 엘리먼트에 잠깐 파란 외곽선(outline — layout 영향 ❌)을 줘 "여기로 왔다" 표식. */
export function flashElement(el: HTMLElement): void {
  const prevOutline = el.style.outline;
  const prevOffset = el.style.outlineOffset;
  const prevTransition = el.style.transition;
  const prevRadius = el.style.borderRadius;
  el.style.transition = 'outline-color 0.4s ease';
  el.style.outline = '2px solid rgba(96,165,250,0.9)';
  el.style.outlineOffset = '2px';
  el.style.borderRadius = el.style.borderRadius || '6px';
  window.setTimeout(() => {
    el.style.outline = 'rgba(96,165,250,0) solid 2px';
    window.setTimeout(() => {
      el.style.outline = prevOutline;
      el.style.outlineOffset = prevOffset;
      el.style.transition = prevTransition;
      el.style.borderRadius = prevRadius;
    }, 420);
  }, 1400);
}

/** anchorId 로 컨테이너에서 출처 항목 엘리먼트 찾기. */
export function findItemElement(container: HTMLElement, anchorId: string): HTMLElement | null {
  try {
    return container.querySelector<HTMLElement>(`[data-stream-item-id="${CSS.escape(anchorId)}"]`);
  } catch {
    return null;
  }
}

/**
 * 선택(selection)의 시작 노드에서 위로 올라가 가장 가까운 `[data-stream-item-id]` 의 id 를 찾는다.
 * 북마크 생성 시 출처 항목을 기록하기 위함. 없으면 undefined.
 */
export function resolveAnchorIdFromSelection(): string | undefined {
  const sel = typeof window !== 'undefined' ? window.getSelection() : null;
  const anchor = sel?.anchorNode ?? null;
  let el: HTMLElement | null = anchor
    ? (anchor.nodeType === Node.ELEMENT_NODE ? (anchor as HTMLElement) : anchor.parentElement)
    : null;
  while (el) {
    const id = el.getAttribute('data-stream-item-id');
    if (id) return id;
    el = el.parentElement;
  }
  return undefined;
}
