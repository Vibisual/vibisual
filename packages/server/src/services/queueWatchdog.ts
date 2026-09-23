import type { QueuedCommand } from '@vibisual/shared';

/**
 * §5.5 #17-18 ⑪ — **대기 워치독의 판정 한 줄.**
 *
 * 큐에 든 명령은 전부 `queued` 로 태어나고, 슬롯(`subAgentId`)당 한 건만 `executing` 으로
 * 올라간다. 그 잠금을 쥔 턴이 **턴 종료 콜백·토큰 절약 펌프·정지 라우트** 셋 중 어느 것도
 * 거치지 않고 사라지면(좀비 봉합으로 걷힌 경우가 대표적이다) 뒤에 선 덧말을 다시 밀어 주는
 * 곳이 없다 — 사용자 보고 "완료 표시를 믿고 추가 작업을 시켰는데 대기로 빠지고 «작업 중» 만
 * 뜬 채 일을 안 한다"가 정확히 그 상태다.
 *
 * 그래서 묻는 것은 하나다: **나갈 수 있는데 안 나간 명령이 있는 세션인가.**
 * 같은 슬롯이 *진짜로* 돌고 있으면 건드리지 않는다 — 그 턴이 끝나면 완료 콜백이 민다.
 * 여기서 "민다"는 곧 `processNextCommand` 재호출인데, 그 함수는 게이트(에이전트·cwd·토큰
 * 절약)를 전부 다시 보므로 반복 호출이 안전하다. 이 함수는 부작용이 없고, 그래서 시험할 수 있다.
 */
export function sessionsNeedingKick(
  queues: ReadonlyMap<string, readonly QueuedCommand[]>,
): string[] {
  const out: string[] = [];
  for (const [sessionId, queue] of queues) {
    if (queue.length === 0) continue;
    const running = new Set<string | null>();
    for (const cmd of queue) if (cmd.status === 'executing') running.add(cmd.subAgentId);
    if (queue.some((cmd) => cmd.status === 'queued' && !running.has(cmd.subAgentId))) {
      out.push(sessionId);
    }
  }
  return out;
}
