/**
 * useSessionRunning — "이 세션 탭이 지금 돌고 있는가"를 **화면 어디서든 같은 답으로** 얻는 훅.
 *
 * 판정 자체는 `@vibisual/shared` 의 `isSessionRunning` 이 하고(서버·클라 공용 규약), 이 훅은 그
 * 판정에 필요한 조각을 store 에서 집어 오는 일만 한다. IDE 본문(하단 상태바)과 입력창([중지] 토글)이
 * **같은 값**을 봐야 하므로 두 곳이 각자 store 를 뒤지지 않고 여기로 모인다.
 *
 * ⚠ **여기서 읽는 명령 큐는 `displayCommands` 를 거치지 않은 원본이다.** 그 함수는 조용한 압축이
 * 도는 동안 뒤에 선 `queued` 한 건을 `executing` 으로 **그려 주는** 표시용 사본을 만든다(버블 표시
 * 전용). 그 사본이 생존 판정에 새면 아무것도 돌지 않는 세션이 영영 "실행 중"으로 굳는다 —
 * `constants.ts` 의 `displayCommands` 주석이 경고하는 바로 그 사고다.
 *
 * §3.1 서버 = SSOT — 여기서 상태를 만들거나 전이시키지 않는다. 서버가 준 값의 조합일 뿐이다.
 */

import { useMemo } from 'react';
import { hasSessionWork, isSessionRunning, isSessionWaiting } from '@vibisual/shared';
import type { SubAgent } from '@vibisual/shared';
import { useGraphStore } from '../stores/graphStore.js';
import { buildSessionRunInputs } from '../utils/sessionStatus.js';
import type { SessionRunInputSources } from '../utils/sessionStatus.js';
import { sessionLastActivityAt } from '../utils/sessionActivity.js';

/** store 전체 모양 — `GraphState` 는 스토어 밖으로 내보내지 않으므로 여기서 되짚는다. */
type GraphSnapshot = ReturnType<typeof useGraphStore.getState>;

/**
 * store 에서 판정 재료를 집는 **한 곳**. 세션 탭이면 그 세션, 메인 탭이면 에이전트 전체.
 * 세션 탭인데 그 sub 를 아직 못 받았으면(스냅샷 지연) `null` — 판단 근거가 없다는 뜻이다.
 */
function pickSources(
  s: GraphSnapshot,
  agentId: string,
  activeSessionId: string | null,
): { sources: SessionRunInputSources; sub: SubAgent | null } | null {
  const sub = activeSessionId === null
    ? null
    : s.subAgents[agentId]?.find((x) => x.id === activeSessionId) ?? null;
  if (activeSessionId !== null && !sub) return null;
  return {
    sub,
    sources: {
      sub,
      commands: s.queuedCommands[agentId],
      runningTasks: s.runningSubagentTasks[agentId],
      acknowledged: activeSessionId !== null && !!s.acknowledgedSubAgents[activeSessionId],
    },
  };
}

/**
 * @param agentId          이 IDE 가 보고 있는 에이전트.
 * @param activeSessionId  열린 세션 탭. `null`(메인 탭)이면 스코프를 좁힐 세션이 없으므로
 *                         **에이전트 전체**를 본다(§5.5 #17-10 의 stop 범위 규칙과 같은 감각).
 */
export function useSessionRunning(agentId: string, activeSessionId: string | null): boolean {
  return useGraphStore((s) => {
    const picked = pickSources(s, agentId, activeSessionId);
    if (!picked) return false;
    return isSessionRunning(buildSessionRunInputs(picked.sources));
  });
}

/**
 * **낼 일이 남았는가**(도는 중 ∪ 줄 서 있음) — 종전에 화면 곳곳이
 * `commands.some((c) => c.status === 'executing' || c.status === 'queued')` 로 손수 적던 판정.
 *
 * 그 손글씨가 곧 두 번째 술어 벌이었고, 게다가 **표시용 사본**(`displayCommands`)과
 * **세션 필터 없는 목록** 위에서 돌아 다른 세션의 좀비가 이 세션을 "작업 중"으로 칠했다.
 * 이제 원본 큐 + 세션 필터 + 공유 술어 한 벌로만 답한다.
 */
export function useSessionWork(agentId: string, activeSessionId: string | null): boolean {
  return useGraphStore((s) => {
    const picked = pickSources(s, agentId, activeSessionId);
    if (!picked) return false;
    return hasSessionWork(buildSessionRunInputs(picked.sources));
  });
}

/**
 * **이 세션이 소유한 `executing` 명령이 실제로 있는가** — 오직 원본 큐만 본다.
 *
 * 화면 몇 곳이 `commands.some((c) => c.status === 'executing')` 를 손으로 적었는데, 그 `commands` 가
 * `displayCommands` 를 거친 **표시용 사본**이라 승격된 대기 명령이 실행 중으로 섞여 들어갔다.
 * "진짜 도는 명령이 있는가"는 표시와 무관한 사실이므로 여기서 한 번만 판정한다.
 */
export function useSessionExecuting(agentId: string, activeSessionId: string | null): boolean {
  return useGraphStore((s) => {
    const picked = pickSources(s, agentId, activeSessionId);
    if (!picked) return false;
    return buildSessionRunInputs(picked.sources).hasExecutingCommand;
  });
}

/**
 * §5.5 #17-9 ⑰ — **이 탭 뒤에서 도는 백단 셸이 몇 개인가**(실행 축과 직교하는 표시 축).
 *
 * `useSessionRunning` 과 **반드시 짝으로 읽어야 한다.** 셸은 실행 축에서 빠졌으므로 이 훅이 없으면
 * 그 셸들은 화면에서 통째로 사라진다 — 그러면 이번엔 "내가 띄운 `npm run dev` 가 아직 도는지"를
 * 알 길이 없어진다. 축을 가르는 일은 한쪽을 지우는 일이 아니라 **각자 제자리에 놓는 일**이다.
 *
 * 원시값(number)을 구독하므로 파생 선택자 함정에 걸리지 않는다.
 */
export function useBackgroundShellCount(agentId: string, activeSessionId: string | null): number {
  return useGraphStore((s) => {
    const picked = pickSources(s, agentId, activeSessionId);
    if (!picked) return 0;
    return buildSessionRunInputs(picked.sources).backgroundShellCount;
  });
}

/** 생존 표시에 필요한 사실 묶음 — 시간 판정(`resolveSessionLiveness`)은 화면이 `now` 와 함께 한다. */
export interface SessionLivenessFacts {
  /** 지금 돌고 있는가(`isSessionRunning`). */
  running: boolean;
  /** 돌지는 않고 줄만 서 있는가(`isSessionWaiting`). */
  waiting: boolean;
  /** 마지막으로 움직인 시각(ms). 근거가 없으면 `null` — 0 으로 적지 않는다. */
  lastActivityAt: number | null;
}

const EMPTY_FACTS: SessionLivenessFacts = { running: false, waiting: false, lastActivityAt: null };

/**
 * §2.4 (무응답) — 생존 표시의 재료. **객체가 아니라 지문 문자열을 구독**하고 그 문자열에서
 * 되짚는다 — 매 스냅샷마다 새 객체를 돌려주면 zustand 가 매번 바뀐 것으로 보아 끝없이 리렌더한다
 * (파생 선택자 함정). 지문은 원시값 셋이라 실제로 달라질 때만 바뀐다.
 */
export function useSessionLivenessFacts(agentId: string, activeSessionId: string | null): SessionLivenessFacts {
  const fingerprint = useGraphStore((s) => {
    const picked = pickSources(s, agentId, activeSessionId);
    if (!picked) return '';
    const inputs = buildSessionRunInputs(picked.sources);
    // Stream delivery does not require a new graph snapshot. Include its actual
    // event timestamps so a busy session cannot age behind an unchanged snapshot.
    const last = sessionLastActivityAt(
      s.subAgents[agentId] ?? [], s.subAgentStreams, s.queuedCommands[agentId] ?? [], activeSessionId,
    ) ?? 0;
    return `${inputs.subStatus ?? ''}|${isSessionRunning(inputs) ? 1 : 0}|${isSessionWaiting(inputs) ? 1 : 0}|${last}`;
  });
  return useMemo(() => {
    if (!fingerprint) return EMPTY_FACTS;
    const parts = fingerprint.split('|');
    const last = Number(parts[3]);
    return {
      running: parts[1] === '1',
      waiting: parts[2] === '1',
      lastActivityAt: Number.isFinite(last) && last > 0 ? last : null,
    };
  }, [fingerprint]);
}
