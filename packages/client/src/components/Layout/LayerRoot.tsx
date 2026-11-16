import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * 모달·전면 덮개의 뿌리 `div` — body 로 포털해 겹침 층 표(§4)의 층이 실제로 먹게 한다.
 * 부모 쌓임 맥락(IDE 판·헤더·`backdrop-filter`) 안에 그리면 `z-dialog` 여도 그 부모 높이에 갇혀 앱 안 창 뒤에 깔린다.
 */
export const LayerRoot = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(function LayerRoot(props, ref) {
  const node = <div ref={ref} {...props} />;
  // 실제 DOM 이 없는 곳(시험의 가짜 document)에서는 제자리에 그린다 — 포털은 진짜 Element 만 받는다.
  const body = typeof document !== 'undefined' && typeof Element !== 'undefined' && document.body instanceof Element ? document.body : null;
  return body ? createPortal(node, body) : node;
});
