/**
 * §4 — `subagentStatusLine` 수집기 저장소: 서브에이전트 토큰·모델·사고 깊이를 진행 중에 주는 유일한 경로(JSONL 은 턴 뒤에야 찬다).
 * 마지막 스냅샷만 든다. 계측·표시 전용, 영속 ❌.
 */

/** 보관할 최대 세션 수(오래 안 쓴 세션부터 버림). */
export const SUBAGENT_STATUSLINE_SESSION_MAX = 100;

export interface SubagentStatusLineTask {
  id: string;
  name?: string;
  type?: string;
  status?: string;
  description?: string;
  label?: string;
  startTime?: number;
  model?: string;
  effort?: string | number;
  contextWindowSize?: number;
  tokenCount?: number;
  cwd?: string;
}

export interface SubagentStatusLineSnapshot {
  sessionId: string;
  cwd?: string;
  at: number;
  tasks: SubagentStatusLineTask[];
}

const bySession = new Map<string, SubagentStatusLineSnapshot>();

function pickString(rec: Record<string, unknown>, key: string): string | undefined {
  const v = rec[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function pickNumber(rec: Record<string, unknown>, key: string): number | undefined {
  const v = rec[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** 들어온 행 하나를 우리 모양으로 좁힌다. `id` 가 없으면 버린다(행을 특정할 수 없으므로). */
function normalizeTask(raw: unknown): SubagentStatusLineTask | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const id = pickString(rec, 'id');
  if (!id) return null;

  const effortRaw = rec['effort'];
  const effort =
    typeof effortRaw === 'number' || (typeof effortRaw === 'string' && effortRaw.trim())
      ? (typeof effortRaw === 'string' ? effortRaw.trim() : effortRaw)
      : undefined;

  return {
    id,
    ...(pickString(rec, 'name') ? { name: pickString(rec, 'name') as string } : {}),
    ...(pickString(rec, 'type') ? { type: pickString(rec, 'type') as string } : {}),
    ...(pickString(rec, 'status') ? { status: pickString(rec, 'status') as string } : {}),
    ...(pickString(rec, 'description') ? { description: pickString(rec, 'description') as string } : {}),
    ...(pickString(rec, 'label') ? { label: pickString(rec, 'label') as string } : {}),
    ...(pickNumber(rec, 'startTime') !== undefined ? { startTime: pickNumber(rec, 'startTime') as number } : {}),
    ...(pickString(rec, 'model') ? { model: pickString(rec, 'model') as string } : {}),
    ...(effort !== undefined ? { effort } : {}),
    ...(pickNumber(rec, 'contextWindowSize') !== undefined
      ? { contextWindowSize: pickNumber(rec, 'contextWindowSize') as number }
      : {}),
    ...(pickNumber(rec, 'tokenCount') !== undefined ? { tokenCount: pickNumber(rec, 'tokenCount') as number } : {}),
    ...(pickString(rec, 'cwd') ? { cwd: pickString(rec, 'cwd') as string } : {}),
  };
}

/**
 * 한 틱분을 기록한다(마지막 것만 남는다).
 * @returns 저장했으면 true — 쓸 만한 행이 하나도 없으면 저장하지 않는다.
 */
export function recordSubagentStatusLine(
  sessionId: string,
  tasks: unknown,
  cwd?: string,
): boolean {
  if (!sessionId || !Array.isArray(tasks)) return false;

  const normalized = tasks
    .map(normalizeTask)
    .filter((t): t is SubagentStatusLineTask => t !== null);
  if (normalized.length === 0) return false;

  // 최근 사용 순서를 유지하려면 다시 넣기 전에 지운다(Map 은 삽입 순서를 지킨다).
  bySession.delete(sessionId);
  bySession.set(sessionId, {
    sessionId,
    ...(cwd ? { cwd } : {}),
    at: Date.now(),
    tasks: normalized,
  });

  while (bySession.size > SUBAGENT_STATUSLINE_SESSION_MAX) {
    const oldest = bySession.keys().next().value;
    if (oldest === undefined) break;
    bySession.delete(oldest);
  }
  return true;
}

/** 한 세션의 마지막 스냅샷. 없으면 null. */
export function getSubagentStatusLine(sessionId: string): SubagentStatusLineSnapshot | null {
  return bySession.get(sessionId) ?? null;
}

/** 전체 스냅샷(최근 사용 순서). */
export function listSubagentStatusLines(): SubagentStatusLineSnapshot[] {
  return Array.from(bySession.values());
}

/** 테스트용 초기화. */
export function resetSubagentStatusLine(): void {
  bySession.clear();
}
