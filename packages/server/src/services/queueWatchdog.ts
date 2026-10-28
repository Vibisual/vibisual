import type { QueuedCommand } from '@vibisual/shared';

/**
 * §5.5 #17-18 ⑪ — 대기 워치독 판정: 나갈 수 있는데 안 나간 명령이 있는 세션인가.
 * `executing` 잠금(슬롯당 한 건)을 쥔 턴이 완료 콜백·토큰 절약 펌프·정지 라우트를 안 거치고 사라지면(좀비 봉합) 뒤에 선 덧말을 밀 곳이 없다.
 * 같은 슬롯이 진짜로 돌면 건드리지 않는다. 미는 것은 `processNextCommand` 재호출이라(게이트를 다시 본다) 반복해도 안전하다.
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
