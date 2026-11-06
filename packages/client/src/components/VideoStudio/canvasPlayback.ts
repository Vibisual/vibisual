/**
 * §5.4 #36 (J) ⑦ — 캔버스에서 동시에 도는 영상은 하나(창마다 한 벌). 재생을 시작하는 화면(라이브 무대 · 결과 파일 재생)이 자리를
 * 잡으면 앞 자리의 `stop` 이 불린다 — 앞 화면은 멈추고 포스터로 돌아간다. 라이브 무대는 무겁다(§5.13 40-11).
 */

interface Holder {
  readonly id: number;
  readonly stop: () => void;
}

let current: Holder | null = null;
let seq = 0;

/** 자리를 잡는다. 돌려받은 함수로 놓는다(이미 다른 화면이 잡았으면 아무 일 없다). */
export function claimCanvasPlayback(stop: () => void): () => void {
  seq += 1;
  const mine: Holder = { id: seq, stop };
  const prev = current;
  current = mine;
  if (prev) {
    try { prev.stop(); } catch { /* 앞 화면의 정리 실패가 새 재생을 막지 않는다 */ }
  }
  return () => {
    if (current?.id === mine.id) current = null;
  };
}

/** 지금 자리를 잡은 화면이 있는가(시험·진단). */
export function canvasPlaybackHeld(): boolean {
  return current !== null;
}

/** 시험 전용. */
export function __resetCanvasPlaybackForTest(): void {
  current = null;
  seq = 0;
}
