import type { BubbleData, PipelineType, PipelineState, AgentRole } from '@vibisual/shared';
import { PIPELINE_CHILD_CONFIGS } from '@vibisual/shared';

// ─── 유틸 ───

function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** 파이프라인 자식 에이전트 역할 목록 (생성 순서) */
const CHILD_ROLES: readonly AgentRole[] = ['explore', 'architect', 'implementer', 'verifier'];

/** 역할별 기본 라벨 */
const ROLE_LABELS: Record<AgentRole, string> = {
  explore: 'Explorer',
  architect: 'Architect',
  implementer: 'Implementer',
  verifier: 'Verifier',
};

// ─── PipelineManager ───

export interface CreatePipelineResult {
  parent: BubbleData;
  children: BubbleData[];
  state: PipelineState;
}

/**
 * 파이프라인 에이전트 생성 + 상태 관리.
 * ProjectGraph에서 인스턴스로 사용.
 */
export class PipelineManager {
  /** parentId → PipelineState */
  private pipelines = new Map<string, PipelineState>();
  /** parentId → child BubbleData[] */
  private children = new Map<string, BubbleData[]>();
  private counter = 0;

  /** 파이프라인 부모 + 자식 4개를 원자적으로 생성 */
  create(
    type: PipelineType,
    label: string,
    position?: { x: number; y: number },
  ): CreatePipelineResult {
    this.counter += 1;
    const ts = Date.now().toString(36);
    const parentSessionId = `pipeline-${ts}-${this.counter}`;
    const parentId = `pipeline-${hashString(parentSessionId)}`;

    const parent: BubbleData = {
      id: parentId,
      label: label || `Pipeline ${this.counter}`,
      bubbleType: 'pipeline',
      path: parentSessionId,
      status: 'idle',
      activity: 0,
      lastActivity: Date.now(),
      customCreated: true,
      position,
      pipelineType: type,
    };

    const childBubbles: BubbleData[] = [];
    const childIds: string[] = [];

    for (const role of CHILD_ROLES) {
      const cfg = PIPELINE_CHILD_CONFIGS[role];
      const childSessionId = `${parentSessionId}-${role}`;
      const childId = `agent-${hashString(childSessionId)}`;

      const child: BubbleData = {
        id: childId,
        label: ROLE_LABELS[role],
        bubbleType: 'agent',
        path: childSessionId,
        status: 'idle',
        activity: 0,
        lastActivity: Date.now(),
        agentRole: role,
        pipelineParentId: parentId,
        modelName: cfg.model,
      };

      childBubbles.push(child);
      childIds.push(childId);
    }

    const state: PipelineState = {
      parentId,
      type,
      childIds,
      createdAt: Date.now(),
    };

    this.pipelines.set(parentId, state);
    this.children.set(parentId, childBubbles);

    return { parent, children: childBubbles, state };
  }

  /** 특정 parentId가 파이프라인인지 확인 */
  has(parentId: string): boolean {
    return this.pipelines.has(parentId);
  }

  /** 스냅샷용 — parentId → child BubbleData[] */
  getChildrenSnapshot(): Record<string, BubbleData[]> {
    const result: Record<string, BubbleData[]> = {};
    for (const [k, v] of this.children) result[k] = v;
    return result;
  }

  /** 스냅샷용 — parentId → PipelineState */
  getPipelinesSnapshot(): Record<string, PipelineState> {
    const result: Record<string, PipelineState> = {};
    for (const [k, v] of this.pipelines) result[k] = v;
    return result;
  }

  /** 체크포인트에서 복원 */
  restore(data: Record<string, PipelineState>, agents: Map<string, BubbleData>): void {
    this.pipelines.clear();
    this.children.clear();

    for (const [parentId, state] of Object.entries(data)) {
      this.pipelines.set(parentId, state);
      // agents Map에서 childIds에 해당하는 에이전트를 수집
      const kids: BubbleData[] = [];
      for (const agent of agents.values()) {
        if (agent.pipelineParentId === parentId) kids.push(agent);
      }
      this.children.set(parentId, kids);
    }

    // counter 복원 (기존 파이프라인 수 기반)
    this.counter = this.pipelines.size;
  }

  /** 카운터 값 (체크포인트 저장용) */
  getCounter(): number {
    return this.counter;
  }
}

export const pipelineManager = new PipelineManager();
