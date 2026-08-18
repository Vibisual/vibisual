/**
 * §5.5 #17-20 ⑩⑫ v4.94 — 공통 디버그 층의 클라이언트 런타임 상태.
 *
 * `runSessions`(④ 실행 런처)와 같은 결의 **비영속 런타임 스토어**다 — 디버그 세션은 프로세스
 * 수명이라 체크포인트에 들어가지 않는다. 영속되는 것은 중단점뿐이고 그건 서버 스냅샷
 * (`graphStore.debugBreakpoints`)으로 흐른다.
 *
 * 여기서 **백엔드(CDP/DAP)를 구분하지 않는다.** 서버가 이미 한 모양으로 정규화해 보내므로
 * 화면은 `DebugSessionState` 하나만 알면 된다 — 런타임이 늘어도 이 파일은 안 바뀐다.
 */
import { create } from 'zustand';

import type {
  DebugAdapterAvailabilityWire,
  DebugControlActionWire,
} from './debugSessionTypes.js';
import type {
  DebugEventPayload,
  DebugScope,
  DebugSessionState,
  DebugVariable,
} from '@vibisual/shared';

/** 세션 하나가 남기는 콘솔 줄 수 상한(곁눈 확인용 — 본 출력은 실행 출력 패널이 그린다). */
const DEBUG_CONSOLE_LINES = 200;

interface DebugSessionsState {
  /** sessionId → 상태. 서버가 보낸 모양 그대로 담는다(가공 ❌). */
  sessions: Record<string, DebugSessionState>;
  /** 이 컴퓨터에서 쓸 수 있는 어댑터 목록(한 번 받아 두고 재사용). */
  adapters: DebugAdapterAvailabilityWire[];
  /**
   * ⑫ — 디버그 모드 토글을 에이전트별로 기억한다.
   * 종전에는 `IDEDebugView` 의 `useState` 라 사이드바를 옮겼다 오면 꺼져 있었다.
   */
  debugModeByAgent: Record<string, boolean>;
  /** sessionId → 지금 보고 있는 콜스택 프레임 id. */
  selectedFrame: Record<string, number>;
  /** 콘솔 줄이 늘어날 때마다 오르는 값(본문은 스토어 밖 링버퍼 — 바이트마다 리렌더 ❌). */
  consoleVersion: number;

  applyEvent: (payload: DebugEventPayload) => void;
  replaceAll: (sessions: DebugSessionState[]) => void;
  setAdapters: (adapters: DebugAdapterAvailabilityWire[]) => void;
  setDebugMode: (agentId: string, on: boolean) => void;
  selectFrame: (sessionId: string, frameId: number) => void;
}

export const useDebugSessions = create<DebugSessionsState>((set) => ({
  sessions: {},
  adapters: [],
  debugModeByAgent: {},
  selectedFrame: {},
  consoleVersion: 0,

  applyEvent: (payload) =>
    set((s) => {
      if (payload.kind === 'output') {
        appendConsole(payload.sessionId, payload.output ?? '');
        return { consoleVersion: s.consoleVersion + 1 };
      }
      if (!payload.state) return s;
      const next = { ...s.sessions, [payload.sessionId]: payload.state };
      if (payload.kind === 'terminated') {
        // 끝난 세션도 잠시 남겨 둔다 — 왜 끝났는지(`error`)를 화면이 적어야 하기 때문.
        return { sessions: next };
      }
      // 새로 멈춘 세션은 맨 위 프레임을 자동으로 고른다(사용자가 한 번 더 누르지 않게).
      const frames = payload.state.frames;
      if (payload.state.status === 'paused' && frames && frames.length > 0) {
        return {
          sessions: next,
          selectedFrame: { ...s.selectedFrame, [payload.sessionId]: frames[0]!.id },
        };
      }
      return { sessions: next };
    }),

  replaceAll: (sessions) =>
    set(() => ({
      sessions: Object.fromEntries(sessions.map((x) => [x.sessionId, x])),
    })),

  setAdapters: (adapters) => set(() => ({ adapters })),

  setDebugMode: (agentId, on) =>
    set((s) => ({ debugModeByAgent: { ...s.debugModeByAgent, [agentId]: on } })),

  selectFrame: (sessionId, frameId) =>
    set((s) => ({ selectedFrame: { ...s.selectedFrame, [sessionId]: frameId } })),
}));

// ─── 콘솔 링버퍼(모듈 지역 — 리렌더를 일으키지 않는다) ────────────────────────

const consoles = new Map<string, string[]>();

function appendConsole(sessionId: string, chunk: string): void {
  if (!chunk) return;
  const buf = consoles.get(sessionId) ?? [];
  for (const line of chunk.split('\n')) {
    if (line.length === 0) continue;
    buf.push(line);
  }
  if (buf.length > DEBUG_CONSOLE_LINES) buf.splice(0, buf.length - DEBUG_CONSOLE_LINES);
  consoles.set(sessionId, buf);
}

/** 그 세션의 최근 콘솔 줄(없으면 빈 배열). */
export function getDebugConsole(sessionId: string, maxLines = 8): string[] {
  return (consoles.get(sessionId) ?? []).slice(-maxLines);
}

// ─── 서버와의 대화(REST) ──────────────────────────────────────────────────
//
// 명령은 REST 로 보내고 **결과는 기다리지 않는다** — 상태는 `debug_event` 로 되돌아오는 것이
// 진실이다(서버 SSOT). 여기서 낙관적으로 상태를 바꾸면 두 진실이 생긴다.

/** 그 실행(runId)에 붙어 있는 세션(없으면 null). */
export function findSessionByRun(
  sessions: Record<string, DebugSessionState>,
  runId: string,
): DebugSessionState | null {
  for (const s of Object.values(sessions)) {
    if (s.runId === runId && s.status !== 'ended') return s;
  }
  return null;
}

/** 부팅·재접속 때 한 번 — 서버가 들고 있던 세션과 어댑터 목록을 받아 온다. */
export async function hydrateDebugState(): Promise<void> {
  try {
    const [sessionsRes, adaptersRes] = await Promise.all([
      fetch('/api/debug/sessions'),
      fetch('/api/debug/adapters'),
    ]);
    if (sessionsRes.ok) {
      const data = (await sessionsRes.json()) as { sessions?: DebugSessionState[] };
      useDebugSessions.getState().replaceAll(data.sessions ?? []);
    }
    if (adaptersRes.ok) {
      const data = (await adaptersRes.json()) as { adapters?: DebugAdapterAvailabilityWire[] };
      useDebugSessions.getState().setAdapters(data.adapters ?? []);
    }
  } catch {
    /* 조회 실패는 조용히 — 다음 조작 때 다시 시도된다 */
  }
}

/** 디버기에 붙는다. 실패 사유는 그대로 돌려줘 화면이 적게 한다. */
export async function attachDebugSession(opts: {
  runId: string;
  root: string;
  runtime: string;
  port?: number;
  command?: string;
  /** 붙자마자 걸어 둘 중단점 — 뒤로 미루면 시작 코드의 중단점을 놓친다. */
  breakpoints?: { file: string; line: number; enabled: boolean }[];
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/debug/attach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, ...(data.error ? { error: data.error } : {}) };
    }
    const data = (await res.json()) as { session?: DebugSessionState };
    if (data.session) useDebugSessions.getState().applyEvent({ sessionId: data.session.sessionId, kind: 'state', state: data.session });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 세션만 끊는다(디버기는 계속 달린다). */
export async function detachDebugSession(sessionId: string): Promise<void> {
  await fetch('/api/debug/detach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  }).catch(() => undefined);
}

/** 계속·일시정지·스텝. */
export async function controlDebugSession(sessionId: string, action: DebugControlActionWire): Promise<void> {
  await fetch('/api/debug/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, action }),
  }).catch(() => undefined);
}

/** ⑫ — 붙지 않고 그냥 진행(멈춰 선 Node 프로세스를 풀어 준다). */
export async function releaseDebugWait(port: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/debug/release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, ...(data.error ? { error: data.error } : {}) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 살아 있는 세션에 중단점을 밀어 넣는다(저장은 별도 — `graphStore.saveBreakpoints`). */
export async function pushBreakpointsToSession(
  sessionId: string,
  breakpoints: { file: string; line: number; enabled: boolean }[],
): Promise<void> {
  await fetch('/api/debug/breakpoints/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, breakpoints }),
  }).catch(() => undefined);
}

/** 멈춘 프레임의 변수 묶음. */
export async function fetchDebugScopes(sessionId: string, frameId: number): Promise<DebugScope[]> {
  try {
    const res = await fetch(`/api/debug/scopes?sessionId=${encodeURIComponent(sessionId)}&frameId=${frameId}`);
    if (!res.ok) return [];
    const data = (await res.json()) as { scopes?: DebugScope[] };
    return data.scopes ?? [];
  } catch {
    return [];
  }
}

/** 묶음 하나를 펼친다. */
export async function fetchDebugVariables(sessionId: string, reference: number): Promise<DebugVariable[]> {
  try {
    const res = await fetch(
      `/api/debug/variables?sessionId=${encodeURIComponent(sessionId)}&reference=${reference}`,
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { variables?: DebugVariable[] };
    return data.variables ?? [];
  } catch {
    return [];
  }
}

/** 멈춘 자리에서 식을 계산한다. */
export async function evaluateDebugExpression(
  sessionId: string,
  expression: string,
  frameId?: number,
): Promise<DebugVariable | null> {
  try {
    const res = await fetch('/api/debug/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, expression, ...(frameId === undefined ? {} : { frameId }) }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: DebugVariable };
    return data.result ?? null;
  } catch {
    return null;
  }
}

/**
 * ⑫ — **실제로 비어 있는** 디버그 포트를 서버에서 받아 온다.
 * 종전에는 우리 실행 세션 안에서만 겹치는지 봐서, 밖에서 이미 그 포트를 쓰는 프로세스와 부딪혔다.
 */
export async function requestFreeDebugPort(base: number): Promise<number | null> {
  try {
    const res = await fetch(`/api/debug/free-port?base=${base}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { port?: number };
    return typeof data.port === 'number' ? data.port : null;
  } catch {
    return null;
  }
}
