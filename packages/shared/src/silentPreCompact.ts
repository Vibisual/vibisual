/**
 * §5.3 #9-1 (P) — 조용한 `/compact` 를 어디에 끼우나(순수). 턴 경계는 "접어라"만 적고, 압축은 그 세션의 다음 명령 직전에 끼워
 * 사용자가 기다리는 턴 안에 숨긴다(턴 경계에서 바로 돌리면 화면이 2~3분 더 돈다 — 실측 평균 150초 · 입력 364,566 토큰).
 * 순수 함수여야 시험이 부른다 — 명령 사이에 끼거나 두 번 끼는 오류는 화면에 안 보인다.
 */

import { isInternalSlashCommand } from './constants.js';

/** 자리 판정에 필요한 사실만 — 서버 `QueuedCommand` 를 통째로 받지 않는다. */
export interface PreCompactQueueItem {
  id: string;
  text: string;
  status: 'queued' | 'executing' | 'completed' | 'error';
  subAgentId: string | null;
  /** §5.5 #17-18 — `'immediate'` 면 앞에 서지 않는다(턴을 끊고 "당장"이라 한 명령이 즉시가 아니게 된다). 표식은 남겨 다음 일반 명령 앞에서 접는다. */
  dispatchMode?: string;
}

/** 한 세션에 끼울 자리 하나. */
export interface PreCompactSlot {
  /** **원본 큐 기준** 삽입 자리(이 자리의 명령 바로 앞에 선다). */
  index: number;
  subAgentId: string;
  /** 뒤에 서게 될 명령 — 로그와 시험이 "무엇 앞에 섰나"를 말할 때 쓴다. */
  beforeCommandId: string;
}

export interface PreCompactPlan {
  /**
   * 끼울 자리들 — **`index` 내림차순**이다. 앞에서부터 넣으면 뒤 자리가 하나씩 밀려 엉뚱한
   * 명령 앞에 서므로, 부르는 쪽은 이 순서 그대로 `splice` 하면 된다.
   */
  slots: PreCompactSlot[];
  /**
   * 끼우지 않고 **표식만 버릴** 세션. 앞에 설 명령이 이미 우리 내부 슬래시 명령(`/compact`·
   * `/clear`)이라 압축을 한 번 더 얹는 것이 낭비인 자리다 — 표식을 남겨 두면 그 명령이 끝난 뒤
   * 다음 명령 앞에 또 끼어 결국 두 번 접는다.
   */
  drop: string[];
}

/**
 * 조용한 압축을 끼울 자리를 정한다 — 세션당 하나(뒤에도 끼우면 사용자 명령 사이에 낀다). 안 끼우는 곳: 이미 `executing`(표식 유지, 턴 끝에 다시 판정)
 * · 기다리는 명령 없음(표식 유지 — 안 쓰면 압축도 안 돈다) · 앞 명령이 내부 슬래시 명령(`drop`).
 */
export function planSilentPreCompact(
  queue: readonly PreCompactQueueItem[],
  pending: ReadonlySet<string>,
): PreCompactPlan {
  const slots: PreCompactSlot[] = [];
  const drop: string[] = [];
  if (pending.size === 0 || queue.length === 0) return { slots, drop };

  const busy = new Set<string>();
  for (const cmd of queue) {
    if (cmd.status === 'executing' && cmd.subAgentId) busy.add(cmd.subAgentId);
  }

  // 같은 세션의 **첫** 대기 명령만 앞자리다.
  const seen = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const cmd = queue[i]!;
    const subAgentId = cmd.subAgentId;
    if (!subAgentId || cmd.status !== 'queued') continue;
    if (seen.has(subAgentId)) continue;
    seen.add(subAgentId);
    if (!pending.has(subAgentId) || busy.has(subAgentId)) continue;
    // '즉시'는 사용자가 도는 턴을 끊어 가며 당장 돌리려는 명령이다 — 앞에 서지 않는다(표식은 남는다).
    if (cmd.dispatchMode === 'immediate') continue;
    if (isInternalSlashCommand(cmd.text)) { drop.push(subAgentId); continue; }
    slots.push({ index: i, subAgentId, beforeCommandId: cmd.id });
  }

  // 뒤에서부터 넣도록 내림차순으로 돌려준다(앞에서 넣으면 뒤 자리가 밀린다).
  slots.sort((a, b) => b.index - a.index);
  return { slots, drop };
}
