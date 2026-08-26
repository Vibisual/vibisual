import { useCallback, useEffect, useState, type RefObject } from 'react';

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
 *
 * ⚠⚠ 그것만으로는 모자랐다 (판올림 번호 발급 대기) — **선택은 누르기 전에도 풀린다.** 스트림은
 *   살아 있는 동안 계속 다시 그려지고, 가상 리스트가 항목을 재활용하거나 버퍼 앞을 자르면 카드
 *   DOM 자체가 갈린다. 그 순간 document 선택은 **소리 없이 사라지고**, 종전 구현은 (a) 버튼을
 *   회색으로 되돌리고 (b) 클릭 시점에 선택을 **다시 읽어** 빈 문자열을 얻었다 — 사용자는 분명히
 *   드래그를 했는데 버튼이 잠겨 있거나, 눌러도 아무 일도 안 일어난다. 그래서 **고른 그 순간에
 *   텍스트를 떠 두고**(`rememberSelection`) 그 기억을 카드 밖(모듈 스코프 Map)에 둔다 — 카드가
 *   잠깐 언마운트됐다 돌아와도 방금 고른 것은 그대로 복사할 수 있어야 한다.
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

/** 이 문서 어딘가에 살아 있는(펼쳐진) 선택이 있는가 — "고른 게 다른 카드 몫" 판정용. */
function hasLiveSelection(doc: Document): boolean {
  const sel = doc.defaultView?.getSelection() ?? null;
  return sel !== null && sel.rangeCount > 0 && !sel.isCollapsed;
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

/* ─────────────────────────────────────────────────────────────────────────────
 * 떠 둔 선택 — 카드 바깥(모듈 스코프)에 둔다.
 *
 * 카드 컴포넌트 안(useRef)에 두면 **가상 리스트가 카드를 재활용하는 순간 같이 죽는다.** 선택을
 * 죽이는 것도 그 재마운트라, 기억이 같은 사건에 함께 날아가면 애초에 기억한 뜻이 없다.
 * 키는 카드 id — 다른 카드의 선택이 서로를 덮지 않게.
 * ⚠ 키 개수에 캡을 둔다(§9) — 값 길이만 제한하고 키를 무한히 받는 자리가 용량 폭증의 자리였다.
 * ───────────────────────────────────────────────────────────────────────────── */

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

/**
 * 선택 복사 버튼을 켜도 되는가 — 순수 판정(DOM 없이 검증한다).
 *
 * - `live`      : 지금 이 카드 안에 살아 있는 선택이 있다 → 당연히 켠다.
 * - `elsewhere` : 살아 있는 선택이 **다른 곳** 몫이다 → 잠근다(엉뚱한 대목을 복사하지 않게).
 * - `remembered`: 살아 있는 선택은 없지만 이 카드에서 고른 것을 떠 뒀다 → 켠다.
 *   리렌더·재마운트로 선택이 풀린 뒤에도 방금 고른 것을 가져갈 수 있어야 하기 때문이다.
 */
export function decideSelectionCopy(input: {
  live: boolean;
  elsewhere: boolean;
  remembered: boolean;
}): boolean {
  if (input.live) return true;
  if (input.elsewhere) return false;
  return input.remembered;
}

export interface CardSelectionCopy {
  /** 버튼을 켜도 되는가. */
  enabled: boolean;
  /** 지금 복사할 텍스트 — 살아 있는 선택이 우선, 없으면 떠 둔 것. */
  getText: () => string;
}

/**
 * 이 카드의 "선택 복사" 상태를 구독한다(`selectionchange`).
 *
 * - 겹침 판정은 매번(문자열 조립 ❌ — 드래그 중 계속 불린다).
 * - **텍스트 뜨기는 프레임당 한 번**으로 묶는다(rAF) — 드래그 한 번에 selectionchange 가 수십 번
 *   오지만 직렬화는 그 프레임의 마지막 상태 한 벌이면 된다.
 * - 값이 안 바뀌면 setState 가 리렌더를 만들지 않는다.
 */
export function useCardSelectionCopy(ref: RefObject<HTMLElement | null>, key: string): CardSelectionCopy {
  const [state, setState] = useState<{ live: boolean; elsewhere: boolean; remembered: boolean }>(
    () => ({ live: false, elsewhere: false, remembered: recallSelection(key) !== '' }),
  );

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
    // 드래그가 끝나는 순간을 **따로** 한 번 더 본다. `selectionchange` 하나에만 매달리면 그 이벤트가
    // 한 번이라도 새면(창 전환·포인터 취소 등) 버튼이 회색인 채로 남고, 사용자는 분명히 골랐는데
    // 누를 수가 없다 — 같은 계산을 두 신호로 받는 값싼 보험이다(같은 값이면 setState 가 멈춘다).
    doc.addEventListener('mouseup', sync, { passive: true });
    doc.addEventListener('touchend', sync, { passive: true });
    return () => {
      doc.removeEventListener('selectionchange', sync);
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
    return recallSelection(key);
  }, [ref, key]);

  return { enabled: decideSelectionCopy(state), getText };
}
