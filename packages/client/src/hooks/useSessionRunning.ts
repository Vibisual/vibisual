/**
 * 이 세션 탭이 지금 도는가를 어디서든 **같은 답으로**(판정은 shared `isSessionRunning`, 여기선 재료만 — §3.1).
 * ⚠ **큐는 `displayCommands` 를 거치지 않은 원본을 읽는다** — 표시용 사본은 압축 중 `queued` 를 `executing` 으로 그려 세션이 "실행 중"으로 굳는다.
 */

import { useMemo } from 'react';
import { hasSessionWork, isSessionExecuting, isSessionRunning, isSessionWaiting } from '@vibisual/shared';
import type { SubAgent } from '@vibisual/shared';
import { useGraphStore } from '../stores/graphStore.js';
import { buildSessionRunInputs } from '../utils/sessionStatus.js';
import type { SessionRunInputSources } from '../utils/sessionStatus.js';
import { sessionCompactingSince, sessionHiddenTurnRunning, sessionLastActivityAt, sessionTurnStartedAt } from '../utils/sessionActivity.js';

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
      agentStatus: activeSessionId === null ? s.agents?.find((agent) => agent.id === agentId)?.status : undefined,
      commands: s.queuedCommands[agentId],
      runningTasks: s.runningSubagentTasks[agentId],
      acknowledged: activeSessionId !== null && !!s.acknowledgedSubAgents[activeSessionId],
    },
  };
}

/** @param activeSessionId 열린 세션 탭. `null`(메인 탭)이면 에이전트 전체를 본다(§5.5 #17-10 stop 범위와 같다). */
export function useSessionRunning(agentId: string, activeSessionId: string | null): boolean {
  return useGraphStore((s) => {
    const picked = pickSources(s, agentId, activeSessionId);
    if (!picked) return false;
    return isSessionRunning(buildSessionRunInputs(picked.sources));
  });
}

/** **낼 일이 남았는가**(도는 중 ∪ 줄 섬) — 원본 큐 + 세션 필터 + 공유 술어로만. `status` 를 손으로 견주지 마라 — 표시용 사본·필터 없는 목록이면 다른 세션의 좀비가 이 세션을 칠한다. */
export function useSessionWork(agentId: string, activeSessionId: string | null): boolean {
  return useGraphStore((s) => {
    const picked = pickSources(s, agentId, activeSessionId);
    if (!picked) return false;
    return hasSessionWork(buildSessionRunInputs(picked.sources));
  });
}

/** **이 세션이 소유한 `executing` 명령이 실제로 있는가** — 원본 큐와 서버 실행 상태를 함께 본다(`displayCommands` 사본이면 승격된 대기 명령이 섞인다). */
export function useSessionExecuting(agentId: string, activeSessionId: string | null): boolean {
  return useGraphStore((s) => {
    const picked = pickSources(s, agentId, activeSessionId);
    if (!picked) return false;
    return isSessionExecuting(buildSessionRunInputs(picked.sources));
  });
}

/** 생존 표시에 필요한 사실 묶음 — 시간 판정(`resolveSessionLiveness`)은 화면이 `now` 와 함께 한다. */
export interface SessionLivenessFacts {
  /** 지금 돌고 있는가(`isSessionRunning`). */
  running: boolean;
  /** 돌지는 않고 줄만 서 있는가(`isSessionWaiting`). */
  waiting: boolean;
  /** 마지막으로 움직인 시각(ms). 근거가 없으면 `null` — 0 으로 적지 않는다. 무응답 판정의 재료. */
  lastActivityAt: number | null;
  /** §5.3 #9-1 (P)(a) — 감춘 턴(조용한 사전 압축)이 도는 중. 그동안의 움직임은 클라에 오지 않는다. */
  hiddenTurn: boolean;
  /**
   * §5.5 #17-10 ⑥-6 (턴 시계) — 지금 보고 있는 일이 시작된 시각(ms). 라이브 1줄이 **평소** 적는
   * 경과의 시작점이다(`sessionTurnStartedAt`). 낼 일이 없거나 근거가 없으면 `null`.
   */
  turnStartedAt: number | null;
  /**
   * §5.5 #17-24 ⑥ — CLI 가 지금 접는 중이면 그 시작 시각(ms). 라이브 1줄의 넷째 모드(`압축 중`)와 그
   * 경과의 근거다(`sessionCompactingSince` — 감춘 턴의 압축은 거른다). 돌지 않으면 `null`.
   */
  compactingSince: number | null;
}

const EMPTY_FACTS: SessionLivenessFacts = {
  running: false, waiting: false, lastActivityAt: null, hiddenTurn: false, turnStartedAt: null, compactingSince: null,
};

/** §2.4 (무응답) — 생존 표시의 재료. **지문 문자열을 구독**하고 거기서 되짚는다 — 새 객체를 돌려주면 zustand 가 매번 바뀐 것으로 보아 끝없이 리렌더한다. */
export function useSessionLivenessFacts(agentId: string, activeSessionId: string | null): SessionLivenessFacts {
  const fingerprint = useGraphStore((s) => {
    const picked = pickSources(s, agentId, activeSessionId);
    if (!picked) return '';
    const inputs = buildSessionRunInputs(picked.sources);
    // Stream delivery does not require a new graph snapshot. Include its actual
    // event timestamps so a busy session cannot age behind an unchanged snapshot.
    const commands = s.queuedCommands[agentId] ?? [];
    const last = sessionLastActivityAt(s.subAgents[agentId] ?? [], s.subAgentStreams, commands, activeSessionId) ?? 0;
    const hidden = isSessionExecuting(inputs) && sessionHiddenTurnRunning(commands, activeSessionId);
    const running = isSessionRunning(inputs);
    const waiting = isSessionWaiting(inputs);
    // 턴 시계 — 낼 일이 있을 때만 잰다(보관분·백단 자식은 도는 명령이 없을 때만 읽힌다). 명령이
    //   나가거나 줄이 바뀔 때만 값이 바뀌므로, 줄이 올 때마다 지문이 흔들리지 않는다.
    const turnStart = running || waiting
      ? sessionTurnStartedAt(
        commands, s.completedCommands?.[agentId] ?? [], activeSessionId, waiting, s.runningSubagentTasks[agentId] ?? [],
      ) ?? 0
      : 0;
    // 압축 중 — 도는 동안만 본다(서버가 걷기 전에 끝난 세션이 "압축 중"으로 남지 않게). 서버가 세우고 걷을
    //   때만 값이 바뀌므로 지문이 줄마다 흔들리지 않는다.
    const compacting = running ? sessionCompactingSince(s.subAgents[agentId] ?? [], commands, activeSessionId) ?? 0 : 0;
    return `${inputs.subStatus ?? ''}|${running ? 1 : 0}|${waiting ? 1 : 0}|${last}|${hidden ? 1 : 0}|${turnStart}|${compacting}`;
  });
  return useMemo(() => {
    if (!fingerprint) return EMPTY_FACTS;
    const parts = fingerprint.split('|');
    const last = Number(parts[3]);
    const turnStart = Number(parts[5]);
    const compacting = Number(parts[6]);
    return {
      running: parts[1] === '1',
      waiting: parts[2] === '1',
      lastActivityAt: Number.isFinite(last) && last > 0 ? last : null,
      hiddenTurn: parts[4] === '1',
      turnStartedAt: Number.isFinite(turnStart) && turnStart > 0 ? turnStart : null,
      compactingSince: Number.isFinite(compacting) && compacting > 0 ? compacting : null,
    };
  }, [fingerprint]);
}
