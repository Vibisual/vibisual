import { useCallback, useEffect } from 'react';
import { beginTitlebarDrag, endTitlebarDrag } from '../utils/titlebarPress.js';

/** 수동 손잡이의 누름을 창 이동에 잇는다(OS 제목줄은 installTitlebarPressCatch). 손짓은 `beginTitlebarDrag` 하나다(§3.7 — 페이지까지 온 제목줄 누름도 같은 길). 손잡이가 사라지면 손짓을 끝낸다. */
export function useTitlebarDrag(): React.MouseEventHandler<HTMLElement> {
  useEffect(() => () => { endTitlebarDrag(); }, []);

  return useCallback((event: React.MouseEvent<HTMLElement>): void => {
    if (!beginTitlebarDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
  }, []);
}
