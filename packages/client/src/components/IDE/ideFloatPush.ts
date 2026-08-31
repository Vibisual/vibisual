// (판올림 번호 발급 대기) §5.5 #17-1 — **떠 있는 IDE 창들이 서로를 찾는 자리.**
//
// 자석 밀기(`pushFloatGeoms`)는 끄는 창 하나가 **다른 창들을 움직이는** 일이라, 계산만으로는 끝나지
// 않는다: 끄는 쪽 컴포넌트가 남의 창을 옮겨야 한다. 그렇다고 매 프레임 store 에 쓰면 창 전원이
// 다시 그려진다(#17-6 (H-6) ② 가 걷어낸 바로 그 버벅임) — 그래서 store 가 아니라 **컴포넌트 밖
// 등록소**를 둔다. 창은 자기 자신을 여기 등록하고, 끄는 창은 이 목록에게만 말을 건다.
//
// 규약 셋:
//   ① **밀 수 있는지는 창 자신이 답한다**(`rect()` 가 null 이면 못 민다) — 붙어 있거나·최대화·모달·
//      접힌 창은 옮길 자리가 아니다. store 의 `float` 만 보고 판정하면 최대화된 창(로컬 상태)을
//      옮기려 들어 풀스크린 창이 통째로 어긋난다.
//   ② **끄는 동안은 `move`(transform 한 줄)**, 손을 떼면 `settle`(그 자리를 제 자리로 삼기). 두 갈래를
//      가르지 않으면 끄는 내내 리렌더가 붙거나, 손을 뗀 뒤 창이 옛 자리로 튄다.
//   ③ 전역 `window` 참조 ❌ — 이 파일은 배선만 하고 기하는 `ideDockLayout.ts` 가 한다.

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
