// §5.5 #17-1 — 떠 있는 IDE 창들의 등록소(자석 밀기는 남의 창을 옮긴다 — 매 프레임 store 에 쓰면 전원이 다시 그려진다).
// ① 밀 수 있는지는 창이 답한다(`rect()` null — store `float` 만 보면 최대화 창을 옮긴다) ② 끄는 중 `move`(transform), 놓으면 `settle` ③ 기하는 `ideDockLayout.ts`.

import type { FloatGeom } from './ideDockLayout';

/** 밀릴 수 있는 창 하나가 등록소에 내놓는 손잡이. */
export interface FloatPushPane {
  /** 지금 이 창이 실제로 차지한 자리. **밀 수 없는 상태면 null** — 그러면 셈에서 통째로 빠진다. */
  rect: () => FloatGeom | null;
  /** 끄는 동안 실시간으로 옮긴다(레이아웃 없는 `transform` — 리렌더 ❌). */
  move: (dx: number, dy: number) => void;
  /** 손을 뗐다 — 지금 밀린 만큼을 **제 자리로 삼는다**(상태 + 슬롯에 기록). */
  settle: (dx: number, dy: number) => void;
}

/** 팬 키 → 그 창의 손잡이. 창이 사라지면 등록 해제로 함께 빠진다(유령 목표 ❌). */
const panes = new Map<string, FloatPushPane>();

/** 이 창을 밀림 대상으로 등록한다. 돌려받은 함수를 부르면 해제된다(언마운트 정리용). */
export function registerFloatPushPane(key: string, pane: FloatPushPane): () => void {
  panes.set(key, pane);
  return () => {
    // 이미 다른 창이 같은 키로 덮어썼으면 남의 등록을 지우지 않는다(키 재사용 경합).
    if (panes.get(key) === pane) panes.delete(key);
  };
}

/** 지금 밀 수 있는 창들 — 자기 자신과 "못 민다"고 답한 창은 빠진다. */
export function listFloatPushPanes(exceptKey: string | null): { key: string; geom: FloatGeom }[] {
  const out: { key: string; geom: FloatGeom }[] = [];
  for (const [key, pane] of panes) {
    if (key === exceptKey) continue;
    const geom = pane.rect();
    if (!geom) continue;
    out.push({ key, geom });
  }
  return out;
}

/** 끄는 동안 그 창을 이만큼 밀어 둔다(등록이 사라졌으면 조용히 넘어간다). */
export function moveFloatPushPane(key: string, dx: number, dy: number): void {
  panes.get(key)?.move(dx, dy);
}

/** 손을 뗐다 — 밀어 둔 만큼을 그 창의 제 자리로 굳힌다. */
export function settleFloatPushPane(key: string, dx: number, dy: number): void {
  panes.get(key)?.settle(dx, dy);
}

/** 테스트 전용 — 등록소를 비운다(모듈 전역이라 테스트 사이에 새어 나가지 않게). */
export function resetFloatPushPanes(): void {
  panes.clear();
}
