/**
 * bootProgress.ts — §3.7 · §9 「시작 화면(스플래시)」. **서버 코어가 부팅하는 동안의 진척을 desktop main 에 넘긴다.**
 *
 * 열어 둔 프로젝트의 복원은 동기 반복이라 그동안 메인 스레드가 붙잡힌다(실측: 부팅 한 번에 2~4초). 그 사이
 * 화면에 아무 말도 없으면 사용자는 앱이 멎은 것인지 일하는 것인지 알 수 없다. desktop main 은 여기서 받은 값을
 * 메시지 포트로 스플래시에 흘려보내므로(포트 쓰기는 붙잡힌 스레드에서도 곧바로 나간다) "몇 번째를 복원하는 중"이
 * 그대로 뜬다.
 *
 * 표시 전용이다 — 받는 쪽이 없으면 아무것도 하지 않고, 받는 쪽이 던져도 부팅은 그대로 간다.
 * 무엇을 어떤 문장으로 적을지는 main 이 정한다(서버는 사실만 넘긴다 · `setBroadcastSink` 와 같은 주입).
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
