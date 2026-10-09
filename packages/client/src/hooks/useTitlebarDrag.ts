import { useCallback, useEffect, useRef } from 'react';

/**
 * 로고처럼 직접 처리하는 제목줄의 창 이동. 최대화 해제가 pointercancel / 캡처 상실을
 * 일으켜도 손은 아직 눌려 있다. DetachedShell 과 같이 창의 mouseup 을 끝으로 삼는다.
 * 나머지 app-drag 영역은 계속 OS 캡션이므로 이 훅을 붙이지 않는다.
 */
export function useTitlebarDrag(): React.MouseEventHandler<HTMLElement> {
  const endRef = useRef<(() => void) | null>(null);

  useEffect(() => () => { endRef.current?.(); }, []);

  return useCallback((event: React.MouseEvent<HTMLElement>): void => {
    if (event.button !== 0) return;
    const api = window.api?.window;
    if (!api?.moveSelf) return;
    const moveSelf = api.moveSelf.bind(api);

    event.preventDefault();
    event.stopPropagation();
    endRef.current?.();

    const end = (): void => {
      if (endRef.current !== end) return;
      endRef.current = null;
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      window.removeEventListener('blur', end, true);
      window.removeEventListener('pagehide', end, true);
      try { void moveSelf('end').catch(() => { /* 종료 중인 창은 IPC 가 이미 닫혔을 수 있다. */ }); }
      catch { /* preload 가 종료된 경우에도 리스너는 위에서 먼저 걷었다. */ }
    };

    const send = (phase: 'start' | 'move'): void => {
      // 호출 순서는 즉시 start → move → end 로 보낸다. 응답을 기다렸다가 이어 보내면
      // 이미 손을 뗀 뒤의 늦은 성공이 끝난 드래그를 되살리거나 다음 드래그를 덮는다.
      const failed = (): void => { if (endRef.current === end) end(); };
      try {
        void moveSelf(phase).then((accepted) => { if (!accepted) failed(); }, failed);
      } catch { failed(); }
    };

    const onMove = (move: MouseEvent): void => {
      // 창 밖에서 뗀 mouseup 을 놓쳤더라도 다음 움직임에서 멈춘다.
      if ((move.buttons & 1) === 0) { end(); return; }
      send('move');
    };
    const onUp = (up: MouseEvent): void => {
      // 왼쪽을 쥔 채 다른 버튼만 떼는 동작은 드래그 종료가 아니다.
      if (up.button === 0 || (up.buttons & 1) === 0) end();
    };

    endRef.current = end;
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
    window.addEventListener('blur', end, true);
    window.addEventListener('pagehide', end, true);
    send('start');
  }, []);
}
