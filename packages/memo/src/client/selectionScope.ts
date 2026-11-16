import { useEffect, type RefObject } from 'react';

/** 끌어 고르는 글자가 넘지 못하는 경계. 대화상자는 표시가 없어도 한 영역이다. */
const SCOPE = '[data-select-scope], dialog, [role="dialog"]';
/** 입력칸은 브라우저가 이미 칸 안에 가둔다 — 건드리면 일부 브라우저에서 캐럿이 죽는다. */
const FIELD = 'input, textarea, select, [contenteditable="true"]';
const OFF = 'select-none'; const ON = 'select-text';

interface ClassHolder { classList: { add: (name: string) => void; remove: (name: string) => void } }
interface ScopeTarget { closest: (selector: string) => unknown }

/**
 * §5.13 MEMO M10 — 누른 영역 밖을 끄는 동안만 선택 불가로 만든다. 돌려주는 함수가 원래대로 되돌린다.
 * 영역 밖(머리줄·도구 줄)에서 시작한 끌기는 아무 글자도 고르지 않는다.
 */
export function beginSelectionScope(target: ScopeTarget, page: ClassHolder): (() => void) | null {
  if (target.closest(FIELD)) return null;
  const scope = target.closest(SCOPE) as ClassHolder | null;
  page.classList.add(OFF); scope?.classList.add(ON);
  return () => { page.classList.remove(OFF); scope?.classList.remove(ON); };
}

/** 메모 창 안에서 시작한 끌기 선택을 누른 영역(`data-select-scope`) 안에 가둔다. */
export function useSelectionScope(rootRef: RefObject<HTMLElement>): void {
  useEffect(() => {
    const root = rootRef.current; const doc = root?.ownerDocument; const view = doc?.defaultView;
    if (!root || !doc || !view) return;
    let release: (() => void) | null = null;
    const end = (): void => { release?.(); release = null; };
    // 선택은 mousedown 기본 동작에서 시작하므로 그보다 앞선 pointerdown 포착 단계에서 건다.
    const start = (event: PointerEvent): void => {
      end();
      if (event.button !== 0 || !(event.target instanceof view.Element)) return;
      release = beginSelectionScope(event.target, doc.body);
    };
    root.addEventListener('pointerdown', start, true);
    view.addEventListener('pointerup', end, true); view.addEventListener('pointercancel', end, true); view.addEventListener('blur', end);
    return () => {
      end(); root.removeEventListener('pointerdown', start, true);
      view.removeEventListener('pointerup', end, true); view.removeEventListener('pointercancel', end, true); view.removeEventListener('blur', end);
    };
  }, [rootRef]);
}
