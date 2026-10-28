/**
 * bootProgress.ts — §3.7 · §9 시작 화면(스플래시). **서버 코어 부팅 진척을 desktop main 에 넘긴다.**
 * 프로젝트 복원은 동기 반복이라 메인 스레드가 붙잡힌다(실측 부팅 한 번 2~4초) — main 이 메시지 포트로 스플래시에 흘려(포트 쓰기는 붙잡힌 스레드에서도 나간다) "몇 번째 복원 중"이 뜬다.
 * 표시 전용 — 받는 쪽이 없거나 던져도 부팅은 그대로 간다. 문장은 main 이 정한다(서버는 사실만 · `setBroadcastSink` 와 같은 주입).
 */
import type { BootProgress } from '@vibisual/shared';

let sink: ((progress: BootProgress) => void) | null = null;

/** desktop main 이 부팅 동안만 건다. `null` 이면 걷는다. */
export function setBootProgressSink(next: ((progress: BootProgress) => void) | null): void {
  sink = next;
}

/** 진척 한 칸. 받는 쪽이 없거나 실패해도 조용히 지나간다(부팅을 멈추게 하면 안 된다). */
export function reportBootProgress(progress: BootProgress): void {
  const target = sink;
  if (!target) return;
  try {
    target(progress);
  } catch {
    // 표시 전용 — 무시한다.
  }
}
