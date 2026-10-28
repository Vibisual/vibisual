/**
 * §5.5 #17-32 ⑤ — "훅이 방금 울렸다"를 화면으로 보낸다. 우리 훅이 모든 이벤트에 걸려 있어 같은 이벤트의 다른 훅도 돈 것 — 켤 줄은 화면이 `hookMatcherMatches` 로 고른다.
 * ⚠ 도구마다 오는 폭주 경로라(인라인 broadcast·동기 saveCheckpoint 는 프리즈, §9) `graph_snapshot` 대신 `hook_fired` 만, `FLUSH_MS` 로 모아 같은 (세션·이벤트·도구)는 접는다.
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
 * 표시 전용 — 실패는 조용히(훅 응답을 막지 않는다).
 * @param agentId 버블 id. 모르면 보내지 않는다(켤 줄이 없다).
 * @param subAgentId 세션 탭 id — 있으면 화면이 탭까지 좁힌다.
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
