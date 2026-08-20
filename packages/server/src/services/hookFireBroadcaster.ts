/**
 * §5.5 #17-32 ⑤ — "그 훅이 방금 울렸다" 를 화면으로 흘려보내는 한 창구.
 *
 * **계측을 새로 만들지 않는다.** Vibisual 자신의 훅이 모든 이벤트에 함께 걸려 있으므로
 * (`hookInstaller.ts`), 우리 훅이 울렸다는 것은 그 이벤트에 걸린 **다른 훅들도 같은 순간에
 * 돌았다**는 뜻이다. 그래서 여기서는 이벤트 이름·도구 이름만 흘려보내고, 어느 줄에 불이
 * 켜질지는 화면이 `hookMatcherMatches`(shared 순수 함수)로 고른다.
 *
 * ⚠ 이 경로는 **도구를 쓸 때마다** 도착하는 폭주 경로다(§9 v3.45 가 훅마다 인라인 broadcast +
 * 동기 saveCheckpoint 로 프리즈를 냈던 바로 그 경로). 그래서 여기는 두 가지를 지킨다:
 *   ① `graph_snapshot` 을 밀지 않는다 — 자체 메시지(`hook_fired`)만 보낸다(체크포인트 미관여).
 *   ② 건건이 보내지 않는다 — 짧은 창(FLUSH_MS)으로 모아 배열 한 건으로 보내고, 같은
 *      (세션·이벤트·도구) 조합은 그 창 안에서 한 줄로 접는다.
 * 표시 전용이라 하나쯤 접혀도 잃는 것이 없다(불은 어차피 몇 초 켜져 있다).
 */
import type { HookFiredPayload } from '@vibisual/shared';

import { broadcast } from '../broadcastBus.js';

/** 모으는 창. 사람 눈에는 즉시로 보이면서 도구 폭주 때 메시지 수를 한 자릿수로 묶는 길이. */
const FLUSH_MS = 200;

/** 한 번에 보내는 상한 — 여러 에이전트가 동시에 돌아도 전선에 오르는 양을 묶어 둔다. */
const MAX_PER_FLUSH = 60;

/** 키 = 세션·이벤트·도구. 같은 창 안의 반복은 마지막 시각으로 접힌다. */
const pending = new Map<string, HookFiredPayload>();

let timer: NodeJS.Timeout | null = null;

function flush(): void {
  timer = null;
  if (pending.size === 0) return;
  const payload = [...pending.values()].slice(0, MAX_PER_FLUSH);
  pending.clear();
  broadcast({ type: 'hook_fired', payload, timestamp: Date.now() });
}

/**
 * 훅 이벤트 하나가 도착했다. 표시 전용이라 실패해도 조용히 넘긴다(훅 응답을 막지 않는다).
 *
 * @param agentId    그 세션이 속한 에이전트(버블) id. 모르면 신고하지 않는다 — 화면이
 *                   자기 것을 고를 수 없는 신호는 어느 줄도 켜지 못한다.
 * @param subAgentId 세션 탭(sub) id. 알 때만 실어 보내면 화면이 탭 단위까지 좁힌다.
 */
export function noteHookFired(
  agentId: string | undefined,
  subAgentId: string | undefined,
  event: string,
  toolName: string | undefined,
): void {
  if (!agentId) return;

  const key = `${agentId}|${subAgentId ?? ''}|${event}|${toolName ?? ''}`;
  pending.set(key, {
    agentId,
    ...(subAgentId ? { subAgentId } : {}),
    event,
    ...(toolName ? { toolName } : {}),
    at: Date.now(),
  });

  if (timer === null) {
    timer = setTimeout(flush, FLUSH_MS);
    // 이 타이머 하나 때문에 프로세스가 살아 있을 이유는 없다.
    timer.unref?.();
  }
}

/** 테스트용 — 창에 남아 있는 것을 즉시 비운다. */
export function flushHookFiresNow(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  flush();
}
