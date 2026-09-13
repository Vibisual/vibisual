import { useEffect } from 'react';
import { watchDetachedFollowRelease } from '../components/IDE/detachedFollowRelease.js';

// SCENARIO.md §5.5 #17-6 (H-23) — **메인 창 한정. 들어오는 판의 뗌을 메인 창이 함께 듣는다.**
//
// 독립 창의 타이틀바를 잡고 앱 안으로 들어오면, (H-12) 가 들어온 순간 그 창을 **숨긴다**(선이
// 그 자리를 이어받는다). 그런데 창이 숨는 순간 OS 는 그 창의 마우스 캡처를 걷으므로, **그 판의
// 뗌을 듣던 유일한 창이 함께 사라진다** — 들어오는 판의 손은 그 독립 창에서 눌렸고, 리스너도
// 전부 거기 달려 있었다(`AgentIDEOverlay` 의 `fullWindow` 갈래 · `OverlayShell` 의 매달림 그물).
//
// 그러면 `overlay:drag-end` 가 영영 안 나가 (H-17) ③ 이 합치는 자리로 모아 둔
// `finishOverlayFollow` 가 불리지 않는다: 선이 커서에 붙은 채 남고(사용자 보고 — "마우스를 때도
// 손에 붙어있는 버그"), 선마저 수명으로 걷히고 나면 숨은 창이 그대로 남아 그 IDE 가 화면
// 어디에도 없다(사용자 보고 — "다시 잡고 들어오는 순간 에러가나").
//
// (H-4) ⑥ 이 세운 "두 창이 함께 듣는다"를 들어오는 길에도 그대로 적용한다. 커서가 앱
// **깊숙이**(48px 안쪽) 들어와 있어야 창이 숨으므로((H-4) ④), 캡처가 걷힌 그 뗌이 닿는 곳은
// 늘 메인 창이다. 두 번 불려도 안전하다 — 이미 끝난 판은 main 이 조용히 지나간다.
//
// 거는 자리가 `App` 인 까닭: `AgentIDEOverlay` 에 두면 그 IDE 가 **앱 안에 열려 있을 때만**
// 듣는데, 이 판이 도는 동안 그 IDE 는 밖에 나가 있다(앱 안에는 없다).
//
// 메인 윈도우(App)에서만 사용 — 오버레이 창은 `OverlayShell` 이 자기 판을 따로 듣는다.
// dev/web 모드(window.api.overlay 없음)에선 no-op.

export function useDetachedFollowRelease(): void {
  useEffect(() => {
    const overlay = typeof window !== 'undefined' ? window.api?.overlay : undefined;
    if (!overlay?.onFollowDragState) return;
    // 판마다 하나 — 같은 에이전트의 신호가 두 번 오면(부팅을 마친 창이 다시 알린다) 앞 그물을
    //   먼저 걷는다. 그러지 않으면 리스너가 겹쳐 쌓여 한 번의 뗌이 여러 번 나간다.
    const watching = new Map<string, () => void>();
    const stop = (agentId: string): void => {
      const off = watching.get(agentId);
      if (!off) return;
      watching.delete(agentId);
      off();
    };
    const off = overlay.onFollowDragState(({ following, agentId }) => {
      // `agentId` 가 없는 신호는 구버전 preload 의 것이다 — 누구의 판인지 모르면 걸 수 없다.
      if (!agentId) return;
      stop(agentId);
      if (!following) return;
      watching.set(agentId, watchDetachedFollowRelease(agentId));
    });
    return () => {
      off();
      for (const detach of watching.values()) detach();
      watching.clear();
    };
  }, []);
}
