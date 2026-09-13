/**
 * §5.3 #9-1 (P) — **다음 명령 앞에 조용한 `/compact` 를 어디에 끼울 것인가** (순수 모듈).
 *
 * 종전에는 판정과 실행이 턴 경계에서 한 몸이었다 — 접어야 하면 그 자리에서 `/compact` 를 큐에
 * 얹었다. 그 자리는 **사용자가 결과를 받아 든 다음**이라, 아무도 기다리지 않는 시간에 화면이
 * 혼자 2~3분 더 도는 것으로 보였다(압축 1회 실측 평균 150초 정지 · 입력 평균 364,566 토큰).
 *
 * 이제 턴 경계는 "접어라"를 **적어 두기만** 하고, 실제 압축은 그 세션에 다음 명령이 나가기
 * 직전에 그 앞으로 끼어든다. 그 명령은 어차피 사용자가 기다리는 턴이라 압축이 그 대기 안으로
 * 숨고, 화면에는 자기가 방금 넣은 명령이 "생각 중"인 것만 보인다.
 *
 * 자리 판정을 여기 순수 함수로 두는 이유는 하나다 — 서버 클로저 안에 두면 **시험이 같은 함수를
 * 부를 수 없다.** 끼어드는 코드가 틀리면 사용자 명령 사이에 압축이 끼거나 두 벌로 끼는데,
 * 둘 다 조용히 일어나므로(화면에 안 보인다) 시험 말고는 잡을 자리가 없다.
 */

import { isInternalSlashCommand } from './constants.js';

/** 자리 판정에 필요한 사실만 — 서버 `QueuedCommand` 를 통째로 받지 않는다. */
export interface PreCompactQueueItem {
  id: string;
  text: string;
  status: 'queued' | 'executing' | 'completed' | 'error';
  subAgentId: string | null;
  /**
   * §5.5 #17-18 v4.68 — 이 명령의 dispatch 방식. `'immediate'` 면 **앞에 서지 않는다**:
   * 사용자가 도는 턴을 끊어 가며 "당장 이것"이라고 한 자리라, 그 앞에 압축이 끼면 그 명령은
   * 즉시가 아니게 된다(끊은 이유를 우리가 지우는 꼴이다). 표식은 **버리지 않고** 남겨,
   * 그 다음 일반 명령 앞에서 접는다.
   */
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
 * 큐와 "접기로 한 세션" 집합을 받아, 조용한 압축을 어디에 끼울지 정한다.
 *
 * 끼우지 않는 자리:
 *  - 그 세션이 **이미 돌고 있으면**(`executing`) — 지금 나갈 자리가 아니다. 표식은 그대로 두고,
 *    그 턴이 끝나면 같은 판정을 다시 지난다.
 *  - 그 세션에 **기다리는 명령이 하나도 없으면** — 끼울 앞자리가 없다. 표식은 그대로 남아
 *    다음 명령을 기다린다(사용자가 더 안 쓰면 압축도 안 돈다 — 그것이 이 축의 의도다).
 *  - 앞에 설 명령이 **우리 내부 슬래시 명령**이면 — `drop` 으로 간다(위 참조).
 *
 * 한 세션에 하나뿐이다 — 같은 세션의 뒤엣것 앞에도 끼우면 압축이 **사용자 명령 사이**에 낀다.
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
