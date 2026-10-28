/**
 * §5.5 #17-6 (H-25) ⑤ — 밖으로 꺼낼 창을 미리 짓는 걸쇠. `armed` 가 켜졌다 꺼졌다 해도 한 판에 한 번만 짓는다.
 * 끝나는 네 자리(나갔다·앱 안에 놓았다·안 끌었다·언마운트)가 각자 판단하면 한쪽만 고쳐지므로 "짓는가/거두는가"는 이것이 쥔다.
 */

export interface PopOutWarmLatch {
  /**
   * 나갈 뜻이 분명해졌다 — 아직 안 지었으면 짓는다. 두 번째부터는 그냥 지나간다.
   */
  arm(): void;
  /**
   * 판이 끝났다 — 미리 지은 창의 운명을 정한다(여러 번·짓지 않은 판에서 불러도 안전).
   * @param used 밖으로 나가 그 창을 썼는가 — 참이면 남기고(곧 보이는 창) 거짓이면 거둔다.
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
