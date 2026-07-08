import { useEffect } from 'react';

// SCENARIO.md §4 v3.16 — 모바일 웹 접속 모드 전용 UX 보정.
// 모바일 브라우저의 하드웨어/제스처 "뒤로가기(back)" 는 기본적으로 페이지를 이탈시켜(홈으로 나가버림)
// Vibisual 을 벗어나게 만든다. 데스크톱의 ESC 처럼 "열려 있는 오버레이·팝업·메뉴를 하나 닫는" 동작으로
// 바꿔, back 이 앱을 떠나지 않고 컨텍스트만 되짚게 한다.
//
// 방식: history 에 센티넬 엔트리를 하나 밀어 넣어 back 을 가둔다. back 이 눌리면 popstate 가 뜨는데,
// 이때 실제로 페이지를 떠나지 않고 (1) 전역에 걸린 ESC 핸들러들이 반응하도록 합성 'Escape' keydown 을
// 디스패치하고 (2) 센티넬을 다시 밀어 넣어 트랩을 재무장한다. 결과적으로 back 은 항상 "ESC 한 번"이 된다.
//
// 데스크톱 Electron(`window.api` 존재)에는 브라우저 back 개념이 없으므로 no-op — 기존 동작 불변.

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
