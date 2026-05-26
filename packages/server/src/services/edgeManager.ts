import type { ActivityEdge, BubbleData, EdgeSnapshot } from '@vibisual/shared';
import { READ_TOOLS } from '@vibisual/shared';

/**
 * 엣지 생명주기 관리.
 * - 버블 쌍당 최대 2개 (read 방향 / write 방향)
 * - 버블과 운명 공동체 — 버블이 사라지기 전까진 유지
 * - 에이전트 ref 스택: ref >= 1 → active, ref == 0 → idle
 *
 * 메인 뷰 엣지, 폴더 내부 엣지 모두 이 클래스 인스턴스로 관리.
 */
export class EdgeManager {
  private edges = new Map<string, ActivityEdge>();
  /** edge ID → 그룹 키 */
  private groupMap = new Map<string, string>();
  /** edge ID → 연결된 에이전트 ID Set (ref 스택) */
  private agentRefs = new Map<string, Set<string>>();

  /**
   * 엣지 생성/갱신 + 에이전트 ref 등록.
   * 같은 방향(read/write)의 도구는 하나의 엣지로 통합, 라벨만 최신 도구명으로 갱신.
   */
  upsert(
    groupKey: string,
    source: BubbleData,
    target: BubbleData,
    toolName: string,
    agentId?: string,
  ): ActivityEdge {
    const isRead = READ_TOOLS.has(toolName);
    const direction = isRead ? 'read' : 'write';
    const now = Date.now();

    // 방향 기반 ID — 버블 쌍당 read 1개 + write 1개
    const edgeId = `${groupKey}-${source.id}-${target.id}-${direction}`;
    const oppositeId = `${groupKey}-${source.id}-${target.id}-${isRead ? 'write' : 'read'}`;

    // 반대 방향 엣지에서 이 에이전트 ref 제거 → ref 0이면 idle
    if (agentId) {
      const oppositeRefs = this.agentRefs.get(oppositeId);
      if (oppositeRefs) {
        oppositeRefs.delete(agentId);
        if (oppositeRefs.size === 0) {
          const opp = this.edges.get(oppositeId);
          if (opp) opp.isActive = false;
        }
      }
    }

    const existing = this.edges.get(edgeId);
    if (existing) {
      existing.isActive = true;
      existing.timestamp = now;
      existing.label = toolName;
      if (agentId) this.addRef(edgeId, agentId);
      return existing;
    }

    const edge: ActivityEdge = {
      id: edgeId,
      source: isRead ? target.id : source.id,
      target: isRead ? source.id : target.id,
      label: toolName,
      timestamp: now,
      isActive: true,
    };

    this.edges.set(edgeId, edge);
    this.groupMap.set(edgeId, groupKey);
    if (agentId) this.addRef(edgeId, agentId);
    return edge;
  }

  /** 에이전트 ref 추가 */
  private addRef(edgeId: string, agentId: string): void {
    let refs = this.agentRefs.get(edgeId);
    if (!refs) { refs = new Set(); this.agentRefs.set(edgeId, refs); }
    refs.add(agentId);
  }

  /** 특정 에이전트의 모든 엣지 ref 제거 → 남은 ref 중 active 에이전트가 없으면 idle */
  removeAgentRefs(agentId: string, activeAgentIds?: Set<string>): void {
    for (const [edgeId, refs] of this.agentRefs) {
      refs.delete(agentId);
      let hasActiveRef = false;
      if (activeAgentIds) {
        for (const ref of refs) {
          if (activeAgentIds.has(ref)) { hasActiveRef = true; break; }
        }
      } else {
        hasActiveRef = refs.size > 0;
      }
      if (!hasActiveRef) {
        const edge = this.edges.get(edgeId);
        if (edge) edge.isActive = false;
        refs.clear();
      }
    }
  }

  /** 전체 ref 초기화 + 모든 엣지 idle */
  clearAllRefs(): void {
    this.agentRefs.clear();
    for (const edge of this.edges.values()) {
      edge.isActive = false;
    }
  }

  /** 모든 엣지 반환 */
  getAll(): ActivityEdge[] {
    return Array.from(this.edges.values());
  }

  /** 특정 그룹의 엣지만 반환 */
  getByGroup(groupKey: string): ActivityEdge[] {
    const result: ActivityEdge[] = [];
    for (const [id, edge] of this.edges) {
      if (this.groupMap.get(id) === groupKey) {
        result.push(edge);
      }
    }
    return result;
  }

  /** 조건에 맞는 엣지 일괄 제거 */
  removeByPredicate(pred: (edge: ActivityEdge) => boolean): void {
    for (const [id, edge] of this.edges) {
      if (pred(edge)) {
        this.edges.delete(id);
        this.groupMap.delete(id);
        this.agentRefs.delete(id);
      }
    }
  }

  /** 직렬화 (레거시 — v1 SavedState 호환) */
  toJSON(): { edges: [string, ActivityEdge][]; groups: [string, string][]; refs: [string, string[]][] } {
    return {
      edges: [...this.edges.entries()],
      groups: [...this.groupMap.entries()],
      refs: [...this.agentRefs.entries()].map(([k, v]) => [k, [...v]]),
    };
  }

  /** 직렬화 (v2 — Record 기반 깔끔한 포맷) */
  toSnapshot(): EdgeSnapshot {
    const edges: Record<string, ActivityEdge> = {};
    for (const [k, v] of this.edges) edges[k] = v;
    const groups: Record<string, string> = {};
    for (const [k, v] of this.groupMap) groups[k] = v;
    const refs: Record<string, string[]> = {};
    for (const [k, v] of this.agentRefs) refs[k] = [...v];
    return { edges, groups, refs };
  }

  /** 복원 (레거시 — v1 SavedState 호환) */
  restore(data: { edges: [string, ActivityEdge][]; groups: [string, string][]; refs: [string, string[]][] }): void {
    this.edges = new Map(data.edges);
    this.groupMap = new Map(data.groups);
    this.agentRefs = new Map(data.refs.map(([k, v]) => [k, new Set(v)]));
  }

  /** 복원 (v2 — Record 기반) */
  restoreFromSnapshot(data: EdgeSnapshot): void {
    this.edges = new Map(Object.entries(data.edges));
    this.groupMap = new Map(Object.entries(data.groups));
    this.agentRefs = new Map(
      Object.entries(data.refs).map(([k, v]) => [k, new Set(v)]),
    );
  }

  /** 노드 id 재해싱 이후 엣지 source/target/edgeId/groupKey 를 일괄 remap.
   *  id 포맷: `${groupKey}-${source.id}-${target.id}-${direction}` — 노드 id가 바뀌면 edge id 자체도 재생성 필요.
   *  idMap 에 없는 id는 그대로 유지. */
  remapIds(idMap: Map<string, string>): void {
    if (idMap.size === 0) return;
    const remap = (id: string): string => idMap.get(id) ?? id;
    const newEdges = new Map<string, ActivityEdge>();
    const newGroups = new Map<string, string>();
    const newRefs = new Map<string, Set<string>>();
    for (const [oldEdgeId, edge] of this.edges) {
      const oldGroup = this.groupMap.get(oldEdgeId) ?? '';
      const newGroup = remap(oldGroup);
      const newSource = remap(edge.source);
      const newTarget = remap(edge.target);
      const direction = oldEdgeId.endsWith('-read') ? 'read' : 'write';
      // edge id 재구성: isRead 시 source/target이 스왑된 상태로 저장되므로, 저장된 순서 그대로 사용
      const newEdgeId = `${newGroup}-${direction === 'read' ? newTarget : newSource}-${direction === 'read' ? newSource : newTarget}-${direction}`;
      newEdges.set(newEdgeId, { ...edge, id: newEdgeId, source: newSource, target: newTarget });
      newGroups.set(newEdgeId, newGroup);
      const refs = this.agentRefs.get(oldEdgeId);
      if (refs) newRefs.set(newEdgeId, new Set(refs));
    }
    this.edges = newEdges;
    this.groupMap = newGroups;
    this.agentRefs = newRefs;
  }

  /** 병합 복원 — 기존 데이터에 추가 (프로젝트별 체크포인트 병합용) */
  mergeFromSnapshot(data: EdgeSnapshot): void {
    for (const [k, v] of Object.entries(data.edges)) {
      if (!this.edges.has(k)) this.edges.set(k, v);
    }
    for (const [k, v] of Object.entries(data.groups)) {
      if (!this.groupMap.has(k)) this.groupMap.set(k, v);
    }
    for (const [k, v] of Object.entries(data.refs)) {
      const existing = this.agentRefs.get(k);
      if (existing) {
        for (const id of v) existing.add(id);
      } else {
        this.agentRefs.set(k, new Set(v));
      }
    }
  }
}
