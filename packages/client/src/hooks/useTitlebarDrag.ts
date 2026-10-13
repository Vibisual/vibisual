import { useCallback, useEffect } from 'react';
import { beginTitlebarDrag, endTitlebarDrag } from '../utils/titlebarPress.js';

/**
 * 헤더 로고 덮개의 누름. 덮개는 `app-nodrag` 라 OS 캡션이 아니므로 언제나 우리가 창을 옮긴다.
 * 손짓 자체는 `utils/titlebarPress.ts` 의 `beginTitlebarDrag` 하나다 — 페이지까지 온 제목줄 누름도
 * 같은 길을 탄다(§3.7). 이 훅은 React 이벤트에 그것을 잇고, 손잡이가 사라질 때 손짓을 끝낸다.
 */
export function useTitlebarDrag(): React.MouseEventHandler<HTMLElement> {
  useEffect(() => () => { endTitlebarDrag(); }, []);

  return useCallback((event: React.MouseEvent<HTMLElement>): void => {
    if (!beginTitlebarDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
  }, []);
}
