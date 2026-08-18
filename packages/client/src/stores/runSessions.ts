/**
 * §5.5 #17-20 ④ v4.74 — 실행 런처의 런타임 상태.
 *
 * PTY 는 렌더러에 부착돼 사는 것이라(§4 v2.63) 실행 상태도 서버 스냅샷이 아니라 여기 산다 —
 * `canvasVisibility`·`captureBubbleRuntime` 과 같은 결의 **비영속 런타임 스토어**다.
 *
 * 출력 바이트는 고빈도라 **스토어에 넣지 않는다**. 화면 전체 출력은 xterm 이 PTY 재부착 시
 * scrollback 을 replay 해 그리고(즉 진짜 버퍼는 main 이 갖고 있다), 여기서는 "실패했을 때
 * 에이전트에게 넘길 꼬리"와 곁눈 미리보기용으로 **줄 단위 링버퍼**만 모듈 지역에 둔다.
 */
import { create } from 'zustand';

import { RUN_FAILURE_TAIL_LINES, RUN_OUTPUT_BUFFER_LINES, RUN_OUTPUT_FLUSH_MS } from '@vibisual/shared';
import type { AgentConfig, RunConfig } from '@vibisual/shared';

import { getTerminalTransport } from '../transport/terminalTransport.js';

export type RunSessionStatus = 'starting' | 'running' | 'exited';

export interface RunSession {
  /** = termId. `run:<agentId>:<configId>` */
  runId: string;
  agentId: string;
  configId: string;
  /** 목록에 보이는 이름(RunConfig.name). */
  name: string;
  /** 실제로 실행된 명령(디버그 모드면 인자가 얹힌 뒤의 것) — 화면에 원문 그대로 보인다. */
  command: string;
  debugMode: boolean;
  debugPort?: number;
  /** 디버그 인자를 실제로 얹었는지. false 면 화면이 "얹지 못했다"고 적는다. */
  debugApplied: boolean;
  /** 런타임별 안내 i18n 키(있으면). */
  noteKey?: string | null;
  status: RunSessionStatus;
  exitCode?: number;
  startedAt: number;
  endedAt?: number;
}

interface RunSessionsState {
  sessions: Record<string, RunSession>;
  /** 출력 패널이 열려 있는 실행 id(없으면 닫힘). */
  outputRunId: string | null;
  /**
   * 출력이 갱신될 때마다 오르는 값. 출력 본문은 스토어 밖(모듈 지역 링버퍼)에 있으므로
   * 화면은 이 숫자를 구독해 "다시 읽을 때"만 안다 — 바이트마다 리렌더하지 않기 위한 목이다.
   */
  outputVersion: number;
  upsert: (session: RunSession) => void;
  patch: (runId: string, patch: Partial<RunSession>) => void;
  remove: (runId: string) => void;
  openOutput: (runId: string | null) => void;
  bumpOutput: () => void;
}

export const useRunSessions = create<RunSessionsState>((set) => ({
  sessions: {},
  outputRunId: null,
  outputVersion: 0,
  bumpOutput: () => set((s) => ({ outputVersion: s.outputVersion + 1 })),
  upsert: (session) => set((s) => ({ sessions: { ...s.sessions, [session.runId]: session } })),
  patch: (runId, patch) =>
    set((s) => {
      const prev = s.sessions[runId];
      if (!prev) return s;
      return { sessions: { ...s.sessions, [runId]: { ...prev, ...patch } } };
    }),
  remove: (runId) =>
    set((s) => {
      if (!s.sessions[runId]) return s;
      const next = { ...s.sessions };
      delete next[runId];
      return { sessions: next, outputRunId: s.outputRunId === runId ? null : s.outputRunId };
    }),
  openOutput: (runId) => set({ outputRunId: runId }),
}));

// ─── 출력 꼬리(모듈 지역 — 리렌더를 일으키지 않는다) ─────────────────────────

/** runId → 최근 줄들. 상한은 실패 신고에 싣는 줄 수와 같다(그 이상은 쓸 곳이 없다). */
const tails = new Map<string, string[]>();
/** 아직 개행을 못 만난 조각. */
const partials = new Map<string, string>();

/**
 * ANSI 이스케이프·캐리지리턴 정리 — 에이전트에게 보낼 때 제어문자가 섞이면 읽히지 않고,
 * 출력 패널도 고정폭 텍스트로 그리므로 색 시퀀스가 그대로 남으면 글자가 깨져 보인다.
 * (제어문자 정규식은 의도된 것이다 — 걷어내는 것이 이 함수의 일이다.)
 */
function stripAnsi(text: string): string {
  return text
    // OSC(제목 설정 등) — BEL 또는 ST 로 끝난다.
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    // CSI(색·커서 이동).
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    // 남은 제어문자(개행·탭은 살린다).
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

function appendTail(runId: string, chunk: string): void {
  const merged = (partials.get(runId) ?? '') + stripAnsi(chunk).replace(/\r\n?/g, '\n');
  const parts = merged.split('\n');
  partials.set(runId, parts.pop() ?? '');
  if (parts.length === 0) return;
  const buf = tails.get(runId) ?? [];
  buf.push(...parts);
  if (buf.length > RUN_OUTPUT_BUFFER_LINES) buf.splice(0, buf.length - RUN_OUTPUT_BUFFER_LINES);
  tails.set(runId, buf);
}

/** 그 실행의 최근 출력 줄들(빈 줄은 앞뒤로 다듬는다). */
export function getRunTail(runId: string, maxLines = RUN_FAILURE_TAIL_LINES): string[] {
  const buf = [...(tails.get(runId) ?? [])];
  const partial = partials.get(runId);
  if (partial) buf.push(partial);
  while (buf.length > 0 && (buf[0] ?? '').trim() === '') buf.shift();
  while (buf.length > 0 && (buf[buf.length - 1] ?? '').trim() === '') buf.pop();
  return buf.slice(-maxLines);
}

function clearTail(runId: string): void {
  tails.delete(runId);
  partials.delete(runId);
}

// ─── transport 다리(한 번만 붙인다) ────────────────────────────────────────

let bridged = false;

/**
 * PTY 출력/종료를 이 스토어에 연결한다. `IDETerminalView` 도 같은 이벤트를 듣지만 각자
 * 자기 termId 만 고르므로 서로 방해하지 않는다. 실행 런처는 `run:` 접두사만 본다.
 */
function ensureBridge(): void {
  if (bridged) return;
  const transport = getTerminalTransport();
  if (!transport) return;
  bridged = true;

  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleFlush = (): void => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      useRunSessions.getState().bumpOutput();
    }, RUN_OUTPUT_FLUSH_MS);
  };

  transport.onData(({ termId, data }) => {
    if (!termId.startsWith('run:')) return;
    appendTail(termId, data);
    scheduleFlush();
    // 첫 바이트가 오면 "실행 중" 으로 올린다(셸이 살아 명령을 뱉기 시작했다는 뜻).
    const s = useRunSessions.getState().sessions[termId];
    if (s && s.status === 'starting') useRunSessions.getState().patch(termId, { status: 'running' });
  });

  transport.onExit(({ termId, exitCode }) => {
    if (!termId.startsWith('run:')) return;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    useRunSessions.getState().bumpOutput();
    useRunSessions.getState().patch(termId, { status: 'exited', exitCode, endedAt: Date.now() });
  });
}

// ─── 조작 ────────────────────────────────────────────────────────────────

export interface StartRunOptions {
  agentId: string;
  cwd: string;
  config: AgentConfig;
  runConfig: RunConfig;
  /** 실제로 실행할 명령(디버그 모드면 변환된 것). */
  command: string;
  env?: Record<string, string>;
  debugMode: boolean;
  debugPort?: number;
  debugApplied: boolean;
  noteKey?: string | null;
}

export function runIdFor(agentId: string, configId: string): string {
  return `run:${agentId}:${configId}`;
}

/**
 * 실행 시작. 이미 같은 구성이 돌고 있으면 **먼저 죽이고** 새로 띄운다(=재시작) — 같은 termId 로
 * create 를 다시 부르면 PTY 매니저가 재부착으로 받아 명령이 두 번 실행되지 않기 때문이다.
 */
export async function startRun(opts: StartRunOptions): Promise<{ ok: boolean; error?: string }> {
  const transport = getTerminalTransport();
  if (!transport) return { ok: false, error: 'no-transport' };
  ensureBridge();

  const runId = runIdFor(opts.agentId, opts.runConfig.id);
  const existing = useRunSessions.getState().sessions[runId];
  if (existing && existing.status !== 'exited') {
    try {
      await transport.kill(runId);
    } catch {
      /* 이미 죽었으면 그대로 진행 */
    }
  }
  clearTail(runId);

  useRunSessions.getState().upsert({
    runId,
    agentId: opts.agentId,
    configId: opts.runConfig.id,
    name: opts.runConfig.name,
    command: opts.command,
    debugMode: opts.debugMode,
    ...(opts.debugPort ? { debugPort: opts.debugPort } : {}),
    debugApplied: opts.debugApplied,
    noteKey: opts.noteKey ?? null,
    status: 'starting',
    startedAt: Date.now(),
  });

  // 구성 자체의 env 위에 디버그 모드가 얹는 env 를 덮어쓴다(디버그 쪽이 나중이자 우선).
  const mergedEnv = { ...(opts.runConfig.env ?? {}), ...(opts.env ?? {}) };
  const result = await transport.create({
    termId: runId,
    cwd: opts.runConfig.cwd ?? opts.cwd,
    config: opts.config,
    command: opts.command,
    autoRun: true,
    ...(Object.keys(mergedEnv).length > 0 ? { env: mergedEnv } : {}),
  });

  if (!result.ok) {
    useRunSessions.getState().patch(runId, { status: 'exited', exitCode: -1, endedAt: Date.now() });
  }
  return result;
}

/** 정지 — PTY 트리를 통째로 회수한다(desktop `killTerminal` → `killTree`). */
export async function stopRun(runId: string): Promise<void> {
  const transport = getTerminalTransport();
  if (!transport) return;
  try {
    await transport.kill(runId);
  } finally {
    useRunSessions.getState().patch(runId, { status: 'exited', endedAt: Date.now() });
  }
}

/** 이 에이전트에서 지금 돌고 있는 실행 수 — 활동바 배지. */
export function countRunning(sessions: Record<string, RunSession>, agentId: string | null): number {
  return Object.values(sessions).filter((s) => s.status !== 'exited' && (!agentId || s.agentId === agentId)).length;
}
