/**
 * §3.6-1 v4.89 — `InstructionsLoaded` 훅 계측 저장소.
 *
 * §5.11 집행은 "프롬프트에 실었다"까지만 알 수 있었고, 그 규칙이 세션 컨텍스트에 **실제로**
 * 들어갔는지는 확인할 길이 없었다. Claude Code 의 `InstructionsLoaded` 훅은 로드된 지시 파일의
 * 경로·사유를 알려 주므로 그 구멍을 메운다.
 *
 * 경계 — **계측·표시 전용**이다. 어떤 판정 로직도 이 데이터를 읽지 않으며, 영속화하지 않는다
 * (복원 대상이 아니라 관찰 대상이라 체크포인트 4곳을 건드리지 않는다).
 */

/** 세션당 보관할 최대 기록 수(FIFO). */
export const INSTRUCTIONS_LOADED_MAX = 50;

/** 보관할 최대 세션 수(오래 안 쓴 세션부터 버림). */
export const INSTRUCTIONS_LOADED_SESSION_MAX = 200;

export interface InstructionsLoadedEntry {
  /** 훅이 도착한 시각(ms). */
  at: number;
  /** 로드된 지시 파일 경로들. */
  paths: string[];
  /** 훅이 밝힌 사유(예: 'startup', 'path-match'). 없으면 생략. */
  reason?: string;
}

export interface InstructionsLoadedSession {
  sessionId: string;
  entries: InstructionsLoadedEntry[];
}

/** sessionId → 기록. Map 순서가 곧 최근 사용 순서(재기록 시 뒤로 옮긴다). */
const bySession = new Map<string, InstructionsLoadedEntry[]>();

/** 훅 payload 에서 경로 목록을 뽑는다 — 필드 이름이 판본마다 달라 넓게 받는다. */
function extractPaths(payload: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (v: unknown): void => {
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
  };

  for (const key of ['paths', 'files', 'instruction_files', 'instructionFiles', 'loaded_files']) {
    const v = payload[key];
    if (Array.isArray(v)) v.forEach(push);
  }
  for (const key of ['path', 'file', 'file_path', 'filePath']) {
    push(payload[key]);
  }

  // 객체 배열({ path, ... })로 오는 판본 대응.
  for (const key of ['instructions', 'sources']) {
    const v = payload[key];
    if (!Array.isArray(v)) continue;
    for (const item of v) {
      if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>;
        push(rec['path'] ?? rec['file'] ?? rec['file_path']);
      } else {
        push(item);
      }
    }
  }

  return Array.from(new Set(out));
}

/**
 * 훅 1건 기록. 경로를 하나도 못 뽑으면 저장하지 않는다(빈 항목으로 목록만 늘리지 않기 위함).
 * @returns 저장했으면 true.
 */
export function recordInstructionsLoaded(sessionId: string, payload: Record<string, unknown>): boolean {
  if (!sessionId) return false;

  const paths = extractPaths(payload);
  if (paths.length === 0) return false;

  const reasonRaw = payload['reason'] ?? payload['trigger'] ?? payload['source'];
  const reason = typeof reasonRaw === 'string' && reasonRaw.trim() ? reasonRaw.trim() : undefined;

  const entry: InstructionsLoadedEntry = { at: Date.now(), paths, ...(reason ? { reason } : {}) };

  const prev = bySession.get(sessionId) ?? [];
  const next = [...prev, entry].slice(-INSTRUCTIONS_LOADED_MAX);

  // 최근 사용 순서를 유지하려면 다시 넣기 전에 지운다(Map 은 삽입 순서를 지킨다).
  bySession.delete(sessionId);
  bySession.set(sessionId, next);

  while (bySession.size > INSTRUCTIONS_LOADED_SESSION_MAX) {
    const oldest = bySession.keys().next().value;
    if (oldest === undefined) break;
    bySession.delete(oldest);
  }
  return true;
}

/** 한 세션의 기록(오래된 것부터). 없으면 빈 배열. */
export function getInstructionsLoaded(sessionId: string): InstructionsLoadedEntry[] {
  return bySession.get(sessionId) ?? [];
}

/** 전체 세션 요약 — 세션별 기록 수와 마지막 시각, 그리고 로드된 경로 합집합. */
export function summarizeInstructionsLoaded(): {
  sessions: { sessionId: string; count: number; lastAt: number; paths: string[] }[];
  totalSessions: number;
} {
  const sessions = Array.from(bySession.entries()).map(([sessionId, entries]) => {
    const paths = new Set<string>();
    let lastAt = 0;
    for (const e of entries) {
      e.paths.forEach((p) => paths.add(p));
      if (e.at > lastAt) lastAt = e.at;
    }
    return { sessionId, count: entries.length, lastAt, paths: Array.from(paths) };
  });
  return { sessions, totalSessions: sessions.length };
}

/** 테스트용 초기화. */
export function resetInstructionsLoaded(): void {
  bySession.clear();
}
