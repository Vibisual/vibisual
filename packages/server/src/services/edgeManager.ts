import type { ActivityEdge, BubbleData, EdgeSnapshot } from '@vibisual/shared';
import { READ_TOOLS } from '@vibisual/shared';

/** getByGroup 이 "그 그룹 없음"을 돌려줄 때 쓰는 공유 빈 배열 — 매 호출 새 배열을 만들지 않는다. */
const EMPTY_EDGES: ActivityEdge[] = [];

/**
 * 엣지 생명주기 관리(메인 뷰·폴더 내부 엣지 모두 이 클래스 인스턴스).
 * - 버블 쌍당 방향은 하나(§2.1 #3) — 방향이 뒤집히면 반대 방향 엣지를 삭제한다(`isActive=false` 로만 내리면 회색 읽기와 컬러 쓰기 화살표가 함께 남는다).
 *   단 다른 에이전트가 그 방향을 아직 쓰면(ref ≥ 1) 남긴다.
 * - 버블과 운명 공동체 — 버블이 사라지기 전까진 유지. 에이전트 ref 스택: ref >= 1 → active, ref == 0 → idle.
 */
export class EdgeManager {
  private edges = new Map<string, ActivityEdge>();
  /** edge ID → 그룹 키 */
  private groupMap = new Map<string, string>();
  /** edge ID → 연결된 에이전트 ID Set (ref 스택) */
  private agentRefs = new Map<string, Set<string>>();

  /**
   * §9 — 그룹 키 → 그 그룹의 엣지들. `getByGroup` 전용 역색인(정본은 `edges`).
   * `getSnapshot()` 이 폴더마다 `getByGroup` 을 부르므로 매번 전부 훑으면 실측(엣지 2,426 · 폴더 456) 스냅샷 1건에 11.8ms(메인 스레드 프레임 하나), 색인이면 0.02ms.
   * 무효화 방식으로 유지한다(증분 갱신 ❌) — 엣지를 건드리는 자리가 7곳이라 증분은 한 곳만 빠뜨려도 화살표가 조용히 사라진다. 재구축은 스냅샷당 많아야 한 번이다.
   */
  private groupIndex: Map<string, ActivityEdge[]> | null = null;

  /** 엣지·그룹 장부가 바뀌면 색인을 버린다 — 다음 조회가 다시 짓는다. */
  private invalidateGroupIndex(): void {
    this.groupIndex = null;
  }

  private ensureGroupIndex(): Map<string, ActivityEdge[]> {
    if (this.groupIndex !== null) return this.groupIndex;
    const index = new Map<string, ActivityEdge[]>();
    for (const [id, edge] of this.edges) {
      const group = this.groupMap.get(id);
      if (group === undefined) continue;
      const bucket = index.get(group);
      if (bucket) bucket.push(edge);
      else index.set(group, [edge]);
    }
    this.groupIndex = index;
    return index;
  }

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

    // 방향 기반 ID — 같은 쌍의 반대 방향은 여기서 정리된다(한 쌍에 방향 하나).
    const edgeId = `${groupKey}-${source.id}-${target.id}-${direction}`;
    const oppositeId = `${groupKey}-${source.id}-${target.id}-${isRead ? 'write' : 'read'}`;

    // 반대 방향 엣지에서 이 에이전트 ref 제거 → 남은 ref 가 없으면 그 방향은 **삭제**한다.
    // (남겨 두면 회색 유령 화살표가 반대 방향으로 영구히 걸린 채 남는다.)
    const oppositeRefs = this.agentRefs.get(oppositeId);
    if (agentId) oppositeRefs?.delete(agentId);
    if (this.edges.has(oppositeId) && (!oppositeRefs || oppositeRefs.size === 0)) {
      this.deleteEdge(oppositeId);
    } else if (oppositeRefs && oppositeRefs.size === 0) {
      // 엣지는 이미 없는데 ref 껍데기만 남는 자리 — 여기서 걷지 않으면 영원히 쌓인다(§9).
      this.agentRefs.delete(oppositeId);
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
    this.invalidateGroupIndex();
    if (agentId) this.addRef(edgeId, agentId);
    return edge;
  }

  /** 엣지 1개를 장부 3곳(엣지·그룹·ref)에서 함께 지운다 — 한 곳만 지우면 유령 항목이 남는다. */
  private deleteEdge(edgeId: string): void {
    this.edges.delete(edgeId);
    this.groupMap.delete(edgeId);
    this.agentRefs.delete(edgeId);
    this.invalidateGroupIndex();
  }

  /**
   * §2.1 #3 — 한 쌍에 방향 하나. 같은 (group, 버블쌍)에 read·write 가 둘 다 있으면 활성 우선 → 최신 `timestamp` 하나만 남긴다.
   * 옛 체크포인트에 양방향 잔여쌍이 쌓여 있어(실측 426쌍) 복원 직후 한 번 훑지 않으면 유령 화살표가 되살아난다.
   * @returns 지운 엣지 수
   */
  pruneOppositePairs(): number {
    const pairs = new Map<string, { read?: string; write?: string }>();
    for (const id of this.edges.keys()) {
      const m = id.match(/^(.*)-(read|write)$/);
      if (!m) continue;
      const entry = pairs.get(m[1]!) ?? {};
      entry[m[2] as 'read' | 'write'] = id;
      pairs.set(m[1]!, entry);
    }

    let removed = 0;
    for (const { read, write } of pairs.values()) {
      if (!read || !write) continue;
      const a = this.edges.get(read);
      const b = this.edges.get(write);
      if (!a || !b) continue;
      const loser = this.weakerEdge(a, b);
      this.deleteEdge(loser.id);
      removed++;
    }
    return removed;
  }

  /** 같은 쌍의 두 방향 중 **버릴 쪽** — 활성이 이기고, 둘 다 같으면 오래된 쪽이 진다. */
  private weakerEdge(a: ActivityEdge, b: ActivityEdge): ActivityEdge {
    if (a.isActive !== b.isActive) return a.isActive ? b : a;
    return a.timestamp >= b.timestamp ? b : a;
  }

  /** 에이전트 ref 추가 */
  private addRef(edgeId: string, agentId: string): void {
    let refs = this.agentRefs.get(edgeId);
    if (!refs) { refs = new Set(); this.agentRefs.set(edgeId, refs); }
    refs.add(agentId);
  }

  /**
   * 특정 에이전트의 모든 엣지 ref 제거 → 남은 ref 중 active 에이전트가 없으면 idle.
   * §9 — 비운 항목은 장부에서도 뺀다 — 에이전트가 유휴로 갈 때마다 불려 빈 Set 이 쌓인다(실측 `agentRefs` 2,367개 중 2,248개가 빈 항목, 체크포인트마다 136 KB).
   * 빈 항목과 없는 항목은 판정이 같다(`agentRefs.get()` 이 `undefined` 면 "ref 없음" — upsert 의 `!oppositeRefs || oppositeRefs.size === 0`).
   */
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
        // Map 순회 중 delete 는 안전하다(아직 방문하지 않은 항목만 영향받고, 지운 건 원래 방문 대상이 아니다).
        // 종전의 `refs.clear()` 와 판정이 같다 — 남아 있던 비활성 ref 도 함께 사라진다.
        this.agentRefs.delete(edgeId);
      }
    }
  }

  /**
   * §9 — 복원 시 옛 체크포인트의 빈 ref 항목을 걷어낸다(이미 디스크에 남은 자국, 실측 2,248개). 판정 영향 없이 부피만 준다.
   * @returns 걷어낸 항목 수
   */
  private pruneEmptyRefs(): number {
    let removed = 0;
    for (const [edgeId, refs] of this.agentRefs) {
      if (refs.size === 0) { this.agentRefs.delete(edgeId); removed++; }
    }
    return removed;
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

  /** 특정 그룹의 엣지. ⚠ 돌려주는 배열은 색인이 들고 있는 것이라 고치면 안 된다(읽기 전용). 그룹이 없으면 공유 빈 상수를 준다. */
  getByGroup(groupKey: string): ActivityEdge[] {
    return this.ensureGroupIndex().get(groupKey) ?? EMPTY_EDGES;
  }

  /** 조건에 맞는 엣지 일괄 제거 */
  removeByPredicate(pred: (edge: ActivityEdge) => boolean): void {
    for (const [id, edge] of this.edges) {
      if (pred(edge)) {
        this.edges.delete(id);
        this.groupMap.delete(id);
        this.agentRefs.delete(id);
        this.invalidateGroupIndex();
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
    this.invalidateGroupIndex();
    this.pruneEmptyRefs();
    this.pruneOppositePairs();
  }

  /** 복원 (v2 — Record 기반) */
  restoreFromSnapshot(data: EdgeSnapshot): void {
    this.edges = new Map(Object.entries(data.edges));
    this.groupMap = new Map(Object.entries(data.groups));
    this.agentRefs = new Map(
      Object.entries(data.refs).map(([k, v]) => [k, new Set(v)]),
    );
    this.invalidateGroupIndex();
    this.pruneEmptyRefs();
    this.pruneOppositePairs();
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
    this.invalidateGroupIndex();
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
    this.invalidateGroupIndex();
    this.pruneEmptyRefs();
    this.pruneOppositePairs();
  }
}
