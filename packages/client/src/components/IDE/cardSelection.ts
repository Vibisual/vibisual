import { useEffect, useState, type RefObject } from 'react';

/**
 * 카드 안에서 **드래그로 고른 부분만** 뽑아내는 유틸("선택 복사").
 *
 * 배경: 카드의 복사 버튼은 전부 **통짜**였다(카드 전체 / 질문 전부). 사용자가 답을 쓰다가 "이 문단
 * 한 줄만 인용하고 싶다"는 순간에 쓸 손잡이가 없어, 카드를 통째로 복사한 뒤 지우거나 손으로 옮겨
 * 적어야 했다. 브라우저 기본 Ctrl+C 가 있긴 하지만, 복사 버튼이 나란히 놓인 자리에 그 선택지가
 * 없으면 "이 카드는 통째로만 복사된다"로 읽힌다 — 그래서 같은 자리에 버튼으로 세운다.
 *
 * 두 가지를 직접 해결한다:
 *
 * ① **선택은 카드 경계에서 자른다** — 선택이 카드 밖(옆 항목·다른 카드)까지 흘러도 이 카드 몫만
 *    가져온다. 버튼이 "이 카드의 선택 복사"라고 말하고 있으니 그 약속을 지킨다.
 * ② **줄바꿈을 살린다** — `Range.toString()` 은 textContent 기반이라 블록 경계를 무시해서 질문과
 *    답지가 `질문본문답지본문` 으로 이어 붙는다. 블록 태그·`<br>` 에서 줄을 바꿔 화면에서 보이는
 *    모양 그대로 만든다. 버튼(복사/즉시 전송)과 글리프(svg)는 **내용이 아니므로** 빼낸다 —
 *    안 그러면 답지를 드래그할 때마다 `즉시 전송` 이 따라붙는다.
 *
 * ⚠ 버튼을 누르는 순간 선택이 풀리면 안 되므로, 이 유틸을 쓰는 버튼은 `onMouseDown` 에서
 *   `preventDefault()` 를 해야 한다(mousedown 기본 동작 = 선택 해제 + 포커스 이동).
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

/**
 * 선택 Range 들을 root 경계 안으로 자른 사본. root 와 안 겹치는 것은 버린다.
 * 선택은 **그 카드가 사는 문서**에서 읽는다 — 별창(분리된 창)에서도 같은 코드가 맞는 선택을 본다.
 */
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

/** 지금 선택이 이 카드와 겹치는가 — 버튼 활성 판정용(문자열을 만들지 않아 드래그 중에도 싸다). */
export function hasSelectionWithin(root: HTMLElement | null): boolean {
  if (!root) return false;
  return clippedRanges(root).length > 0;
}

/** 이 카드 안쪽으로 자른 선택 텍스트. 선택이 없거나 카드 밖이면 빈 문자열. */
export function selectionTextWithin(root: HTMLElement | null): string {
  if (!root) return '';
  const parts = clippedRanges(root)
    .map((r) => serializeFragment(r.cloneContents()))
    .filter((s) => s.trim() !== '');
  return parts
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')   // 줄 끝 공백(들여쓰기 잔여) 제거
    .replace(/\n{3,}/g, '\n\n')   // 블록이 겹쳐 생긴 빈 줄 과다 정리
    .trim();
}

/**
 * 이 카드에 살아 있는 선택이 있는지 구독한다(`selectionchange`). 드래그 중 계속 불리므로
 * 문자열 조립 없이 겹침만 본다. 값이 안 바뀌면 setState 가 리렌더를 만들지 않는다.
 */
export function useSelectionWithin(ref: RefObject<HTMLElement | null>): boolean {
  const [has, setHas] = useState(false);
  useEffect(() => {
    const sync = (): void => setHas(hasSelectionWithin(ref.current));
    sync();
    const doc = ref.current?.ownerDocument ?? document;
    doc.addEventListener('selectionchange', sync);
    return () => doc.removeEventListener('selectionchange', sync);
  }, [ref]);
  return has;
}
