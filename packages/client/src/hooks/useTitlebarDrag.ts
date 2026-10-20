import { useCallback, useEffect } from 'react';
import { beginTitlebarDrag, endTitlebarDrag } from '../utils/titlebarPress.js';

/**
 * 명시적인 수동 손잡이의 누름을 창 이동에 연결한다. OS 제목줄은 installTitlebarPressCatch 를 쓴다.
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
