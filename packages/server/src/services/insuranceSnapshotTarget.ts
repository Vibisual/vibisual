/**
 * §5.26 (F) `[지금 사본 뜨기]` — 라우트 입력을 `PreCompact` 훅 경로(§5.26 (E))와 같은 두 키로 푼다.
 * 그래프는 버블 키로 서 있고 마커 신원은 CLI 세션 UUID 다. 세션 탭의 UUID 를 그래프 키로 넘기면 프로젝트를 못 짚어 409 가 된다.
 */
import type { SubAgent } from '@vibisual/shared';

type SubRef = Pick<SubAgent, 'id' | 'sessionId' | 'parentAgentId'>;

export interface SnapshotTargetDeps {
  getSub: (subAgentId: string) => SubRef | undefined;
  findSubBySessionId: (claudeSessionId: string) => SubRef | undefined;
  /** 버블 → 그래프 키(훅 세션 키). */
  findSessionByAgentId: (agentId: string) => string | null;
}

export interface SnapshotTarget {
  /** `recordCompactMarker` 의 `sessionId` — 프로젝트·버블·cwd 를 짚는 키. */
  graphSessionId: string;
  /** 마커 신원이자 대화록 파일 이름. */
  claudeSessionId: string;
  subAgentId?: string;
}

export function resolveSnapshotTarget(
  input: { sessionId?: string; subAgentId?: string },
  deps: SnapshotTargetDeps,
): SnapshotTarget | null {
  const wantedSub = input.subAgentId?.trim() ?? '';
  const given = input.sessionId?.trim() ?? '';
  // 탭 id 가 없어도 UUID 로 탭을 찾는다 — (F) 감시 줄·마커가 쥔 것은 UUID 뿐이다.
  const sub = (wantedSub ? deps.getSub(wantedSub) : undefined)
    ?? (given ? deps.findSubBySessionId(given) : undefined);
  const claudeSessionId = given || sub?.sessionId || '';
  if (!claudeSessionId) return null;
  // 훅으로만 붙은 세션은 CLI id 가 곧 그래프 키다.
  const graphSessionId = (sub ? deps.findSessionByAgentId(sub.parentAgentId) : null) ?? claudeSessionId;
  const subAgentId = sub?.id ?? (wantedSub || undefined);
  return { graphSessionId, claudeSessionId, ...(subAgentId ? { subAgentId } : {}) };
}
