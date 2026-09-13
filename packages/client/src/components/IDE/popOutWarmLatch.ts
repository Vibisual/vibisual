/**
 * popOutWarmLatch.ts — §5.5 #17-6 (H-25) ⑤ **한 판에 한 번만 짓고, 끝나는 자리에서 운명을 정한다.**
 *
 * 밖으로 꺼내는 창을 미리 지어 두는 것이 (H-25) 인데, 지을 자리(`armed` 가 켜지는 순간)는 손짓에
 * 따라 켜졌다 꺼졌다 한다. 그때마다 짓고 닫으면 예열이 되레 부담이 되므로 **걸쇠**가 필요하고,
 * 판이 끝나는 자리는 여럿이다(나갔다 · 앱 안에 놓았다 · 끌지도 않았다 · 언마운트로 끊겼다).
 * 그 네 자리가 각자 판단하면 한쪽만 고쳐지는 날이 온다((H-16) 이 활성화 갈래에서 겪은 그 일).
 * 그래서 "짓는가 / 거두는가"는 이 걸쇠 하나가 쥔다.
 *
 * 컴포넌트에서 빼낸 까닭은 클라 테스트에 DOM 이 없어서다 — 이 모양이면 걸쇠를 실제로 돌려 볼 수
 * 있다(드래그 클로저 안에 두면 소스 문자열로 짐작할 수밖에 없다).
 */

export interface PopOutWarmLatch {
  /**
   * 나갈 뜻이 분명해졌다 — 아직 안 지었으면 짓는다. 두 번째부터는 그냥 지나간다.
   */
  arm(): void;
  /**
   * 판이 끝났다 — 미리 지어 둔 창의 운명을 여기서 한 번에 정한다.
   *
   * @param used 그 창을 실제로 썼는가(밖으로 나갔다). 참이면 거두지 않는다 — 그 창이 곧
   *   사용자가 보는 창이다. 거짓이면 거둔다(쓰지도 않을 창을 남기지 않는다).
   *
   * 여러 번 불려도 안전하다: 걸쇠를 먼저 내리므로 두 번째 호출은 아무 일도 하지 않는다.
   * 짓지 않은 판에서 불러도 아무 일도 없다(거둘 것이 없다).
   */
  settle(used: boolean): void;
  /** 지금 지어 둔 창이 있는가(테스트·진단용). */
  readonly warmed: boolean;
}

export function createPopOutWarmLatch(io: {
  /** 창을 미리 짓는다(main 의 `overlay:warm`). */
  build: () => void;
  /** 미리 지은 창을 거둔다(main 의 `overlay:warm-cancel`). */
  discard: () => void;
}): PopOutWarmLatch {
  let warmed = false;
  return {
    arm(): void {
      if (warmed) return;
      warmed = true;
      io.build();
    },
    settle(used: boolean): void {
      if (!warmed) return;
      warmed = false;
      if (!used) io.discard();
    },
    get warmed(): boolean {
      return warmed;
    },
  };
}
