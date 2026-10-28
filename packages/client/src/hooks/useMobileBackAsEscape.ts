import { useEffect } from 'react';

// §4 모바일 웹 — 브라우저 뒤로가기를 앱 이탈이 아니라 ESC 한 번으로 바꾼다: history 센티넬로 back 을 가두고, popstate 때 합성 'Escape' keydown 을 보낸 뒤 센티넬을 다시 민다. `window.api` 가 있으면 no-op.

function dispatchEscape(): void {
  // 포커스된 요소에서 디스패치해 React onKeyDown(루트 컨테이너에서 위임) 과 window/document 전역
  // keydown 리스너 양쪽에 bubbling 으로 도달하게 한다.
  const target =
    document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
    }),
  );
}

export function useMobileBackAsEscape(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // 데스크톱 통합 앱(Electron preload) 에서는 적용하지 않는다 — 브라우저 back 버튼이 없다.
    if (window.api) return;

    const arm = (): void => {
      try {
        window.history.pushState({ vibiBackTrap: true }, '');
      } catch {
        // pushState 가 막힌 환경이면 조용히 포기(트랩 없이 기본 동작).
      }
    };

    // 첫 센티넬을 밀어 넣어 첫 back 이 페이지를 떠나지 않고 popstate 로 잡히게 한다.
    arm();

    const onPopState = (): void => {
      dispatchEscape();
      // 방금 소비한 센티넬을 다시 밀어 넣어 다음 back 도 계속 ESC 로 동작하게 한다.
      arm();
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
}
