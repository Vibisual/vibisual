import { useEffect } from 'react';
import { watchDetachedFollowRelease } from '../components/IDE/detachedFollowRelease.js';

// §5.5 #17-6 (H-23) — **들어오는 판의 뗌을 메인 창이 함께 듣는다.** 들어온 독립 창은 (H-12) 가 숨기고, 그 순간 OS 가 마우스 캡처를 걷어 뗌을 듣던 창이 사라진다 —
// 그러면 `overlay:drag-end` 가 안 나가 선이 커서에 붙어 남고 숨은 IDE 가 어디에도 없다. 창은 커서가 48px 안쪽이어야 숨으므로((H-4) ④) 그 뗌은 늘 메인 창에 닿는다.
// 두 번 불려도 안전하다. `App` 에 건다(`AgentIDEOverlay` 는 이 판 동안 밖에 있다).

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
