import { SESSION_MEMO, repairMemoGroups, sanitizeSessionMemos, type ProjectCheckpoint, type SessionMemo } from '@vibisual/shared';

export interface CanvasMemoOwners {
  projectOf: (agentId: string) => string | null;
  available: (agentId: string, subAgentId: string | null) => boolean;
  read: (agentId: string, subAgentId: string | null) => SessionMemo[];
  write: (agentId: string, subAgentId: string | null, memos: SessionMemo[]) => void;
  readCanvas: (project: string) => SessionMemo[];
  writeCanvas: (project: string, memos: SessionMemo[]) => void;
  markDeleted: (project: string, id: string) => void;
}

export class CanvasMemoService {
  constructor(private readonly owners: CanvasMemoOwners) {}

  canReturn(project: string, id: string): boolean {
    const home = this.owners.readCanvas(project).find((m) => m.id === id)?.canvas;
    return !!home && this.owners.projectOf(home.agentId) === project && this.owners.available(home.agentId, home.subAgentId);
  }

  move(input: { agentId: string; subAgentId: string | null; memoId: string; wholeCard: boolean;
    memos: unknown; x: number; y: number; folderId: string | null }): SessionMemo[] | null {
    const o = this.owners;
    const project = o.projectOf(input.agentId);
    if (!project || !o.available(input.agentId, input.subAgentId)) return null;
    const current = o.read(input.agentId, input.subAgentId);
    if (!current.some((m) => m.id === input.memoId)) return null;
    const canvas = o.readCanvas(project);
    const canvasIds = new Set(canvas.map((m) => m.id));
    const source = sanitizeSessionMemos(input.memos).filter((m) => !m.canvas && !canvasIds.has(m.id));
    const target = source.find((m) => m.id === input.memoId && m.closedAt === undefined);
    if (!target || !Number.isFinite(input.x) || !Number.isFinite(input.y)) return null;
    const moving = source.filter((m) => m.id === target.id || (input.wholeCard && target.groupId && m.groupId === target.groupId));
    if (canvas.filter((m) => m.closedAt === undefined).length + moving.length > SESSION_MEMO.MAX_PER_OWNER) return null;
    const ids = new Set(moving.map((m) => m.id));
    const transferred = moving.map((m): SessionMemo => ({ ...m, x: input.x, y: input.y,
      canvas: { agentId: input.agentId, subAgentId: input.subAgentId, x: m.x, y: m.y, folderId: input.folderId } }));
    const remaining = repairMemoGroups(source.filter((m) => !ids.has(m.id)));
    o.writeCanvas(project, sanitizeSessionMemos([...canvas, ...transferred]));
    o.write(input.agentId, input.subAgentId, remaining);
    return remaining;
  }

  returnHome(project: string, id: string): boolean {
    const o = this.owners;
    const canvas = o.readCanvas(project);
    const memo = canvas.find((m) => m.id === id);
    const home = memo?.canvas;
    if (!memo || !home || o.projectOf(home.agentId) !== project || !o.available(home.agentId, home.subAgentId)) return false;
    const source = o.read(home.agentId, home.subAgentId);
    if (source.filter((m) => m.closedAt === undefined).length >= SESSION_MEMO.MAX_PER_OWNER) return false;
    const restored = { ...memo, x: home.x, y: home.y, updatedAt: Date.now() };
    delete restored.canvas;
    delete restored.closedAt;
    delete restored.groupId;
    delete restored.groupActive;
    o.write(home.agentId, home.subAgentId, sanitizeSessionMemos([...source.filter((m) => m.id !== id), restored]));
    o.writeCanvas(project, repairMemoGroups(canvas.filter((m) => m.id !== id)));
    return true;
  }

  save(project: string, input: unknown): SessionMemo[] {
    const previous = this.owners.readCanvas(project);
    const incoming = new Map(sanitizeSessionMemos(input).map((m) => [m.id, m]));
    // 저장은 편집만 한다. 이동/삭제 전용 요청만 소유권을 바꿀 수 있다.
    const byId = new Map(previous.map((m) => [m.id, m]));
    const next = repairMemoGroups([
      ...[...incoming.values()].flatMap((patch) => {
        const original = byId.get(patch.id);
        return original ? [{ ...patch, canvas: original.canvas }] : [];
      }),
      ...previous.filter((m) => !incoming.has(m.id)),
    ]);
    this.owners.writeCanvas(project, next);
    return next;
  }

  delete(project: string, id: string): boolean {
    const current = this.owners.readCanvas(project);
    const target = current.find((m) => m.id === id);
    if (!target || target.closedAt === undefined) return false;
    this.owners.markDeleted(project, id);
    this.owners.writeCanvas(project, current.filter((m) => m.id !== id));
    return true;
  }
}

export function reconcileCanvasMemoOwnership(cp: ProjectCheckpoint): void {
  const deleted = new Set((cp.deletedCanvasMemoIds ?? []).filter((id) => typeof id === 'string'));
  for (const [project, memos] of Object.entries(cp.canvasMemos ?? {})) {
    cp.canvasMemos![project] = sanitizeSessionMemos(memos).filter((m) => m.canvas && !deleted.has(m.id));
  }
  const canvasIds = new Set(Object.values(cp.canvasMemos ?? {}).flat().map((m) => m.id));
  const clean = (memos: SessionMemo[]): SessionMemo[] => repairMemoGroups(sanitizeSessionMemos(memos).filter((m) => !deleted.has(m.id) && !canvasIds.has(m.id)));
  for (const [agent, memos] of Object.entries(cp.agentMemos ?? {})) {
    if (Array.isArray(memos)) cp.agentMemos![agent] = clean(memos);
  }
  for (const record of [cp.subAgents, cp.archivedSubAgents]) {
    for (const subs of Object.values(record ?? {})) {
      if (!Array.isArray(subs)) continue;
      for (const sub of subs) if (Array.isArray(sub.memos)) sub.memos = clean(sub.memos);
    }
  }
}
