import { useEffect, useRef, type RefObject } from 'react';

import { registerInspectorPicker, type InspectorPicker, type InspectorPickerOptions } from '../utils/inspectorPick.js';

/**
 * §5.4 #15 (C) — 그린 화면의 판(`ref`)에 Alt 인스펙터 공급자를 단다. 공급자는 매 렌더 바뀌어도 되고(최신 것을 부른다),
 * `null` 이면 판이 그대로 DOM 으로 집힌다. 판이 SVG 처럼 그린 것을 요소로 품으면 `{ subtree: true }`.
 */
export function useInspectorPicker(
  ref: RefObject<Element | null>,
  picker: InspectorPicker | null,
  options?: InspectorPickerOptions,
): void {
  const latest = useRef(picker);
  latest.current = picker;
  const subtree = options?.subtree === true;
  useEffect(() => {
    const host = ref.current;
    if (!host) return undefined;
    return registerInspectorPicker(host, (at) => latest.current?.(at) ?? [], { subtree });
  }, [ref, subtree]);
}
