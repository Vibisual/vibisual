import { beforeEach, describe, expect, it } from 'vitest';
import { SESSION_MEMO, sanitizeSessionMemos, type SessionMemo } from '@vibisual/shared';
import { CanvasMemoService } from './canvasMemos.js';
import { ProjectGraph } from './projectGraph.js';
import { mergeSnapshots } from './projectGraphManager.js';

function note(id = 'memo-one', patch: Partial<SessionMemo> = {}): SessionMemo {
  return { id, text: 'Note with content', name: 'Title', x: 40, y: 60, w: 280, h: 180,
    color: '#1E293B', alpha: 0.4, createdAt: 1, updatedAt: 1, ...patch };
}

describe('canvas memo ownership', () => {
  let source: SessionMemo[];
  let canvas: SessionMemo[];
  let available: boolean;
  let service: CanvasMemoService;
  beforeEach(() => {
    source = [note()]; canvas = []; available = true;
    service = new CanvasMemoService({
      projectOf: () => 'Project', available: () => available,
      read: () => source, write: (_id, _sub, memos) => { source = memos; },
      readCanvas: () => canvas, writeCanvas: (_project, memos) => { canvas = memos; },
      markDeleted: () => {},
    });
  });
  function move(wholeCard = true): SessionMemo[] | null {
    return service.move({ agentId: 'agent', subAgentId: 'sub', memoId: 'memo-one', wholeCard,
      memos: source, x: -300, y: 450, folderId: 'folder' });
  }
  it('moves the same memo to signed world coordinates and retains its home and content', () => {
    const original = source[0]!;
    expect(move()).toEqual([]);
    expect(source).toEqual([]);
    expect(canvas[0]).toMatchObject({ ...original, x: -300, y: 450,
      canvas: { agentId: 'agent', subAgentId: 'sub', x: 40, y: 60, folderId: 'folder' } });
    expect(sanitizeSessionMemos(canvas)).toEqual(canvas);
  });
  it('returns to the session coordinates and removes its canvas address', () => {
    move(); canvas[0] = { ...canvas[0]!, text: 'Edited on canvas', x: 900 };
    expect(service.returnHome('Project', 'memo-one')).toBe(true);
    expect(canvas).toEqual([]);
    expect(source[0]).toMatchObject({ x: 40, y: 60, text: 'Edited on canvas' });
    expect(source[0]).not.toHaveProperty('canvas');
  });
  it('keeps a canvas memo when its original owner is deleted or in trash', () => {
    move(); available = false; source = [];
    expect(service.returnHome('Project', 'memo-one')).toBe(false);
    expect(canvas).toHaveLength(1);
    expect(service.save('Project', canvas)).toHaveLength(1);
  });
  it('moves a whole group or a single tab without leaving an invalid group', () => {
    source = [note('memo-one', { groupId: 'group', groupActive: true }), note('memo-two', { groupId: 'group' })];
    move(false);
    expect(source).toHaveLength(1); expect(canvas).toHaveLength(1);
    expect(source[0]).not.toHaveProperty('groupId'); expect(canvas[0]).not.toHaveProperty('groupId');
    source = [note('memo-one', { groupId: 'group', groupActive: true }), note('memo-two', { groupId: 'group' })];
    canvas = []; move();
    expect(canvas.map((m) => m.groupId)).toEqual(['group', 'group']);
  });
  it('closes and restores the same memo and only permanently deletes a closed bubble', () => {
    move(); const open = canvas[0]!;
    expect(service.delete('Project', open.id)).toBe(false);
    service.save('Project', [{ ...open, closedAt: 20 }]);
    expect(canvas[0]).toHaveProperty('closedAt', 20);
    service.save('Project', [open]);
    expect(canvas[0]).not.toHaveProperty('closedAt');
    service.save('Project', [{ ...open, closedAt: 30 }]);
    expect(service.delete('Project', open.id)).toBe(true);
    expect(service.save('Project', [open])).toEqual([]);
  });
  it('does not overwrite the origin or resurrect a returned note from a late canvas save', () => {
    move(); const stale = canvas[0]!;
    service.save('Project', [{ ...stale, canvas: { ...stale.canvas!, agentId: 'other' } }]);
    expect(canvas[0]?.canvas?.agentId).toBe('agent');
    service.returnHome('Project', stale.id);
    expect(service.save('Project', [stale])).toEqual([]);
  });
  it('refuses a return at the open memo limit without losing either side', () => {
    move(); source = Array.from({ length: SESSION_MEMO.MAX_PER_OWNER }, (_, i) => note(`other-${i}`));
    expect(service.returnHome('Project', 'memo-one')).toBe(false);
    expect(source).toHaveLength(SESSION_MEMO.MAX_PER_OWNER); expect(canvas).toHaveLength(1);
  });
  it('rejects a move with an absent memo or invalid coordinates', () => {
    expect(service.move({ agentId: 'agent', subAgentId: null, memoId: 'missing', wholeCard: true,
      memos: source, x: NaN, y: 0, folderId: null })).toBeNull();
    expect(source).toHaveLength(1); expect(canvas).toEqual([]);
  });
});

describe('canvas memo persistence', () => {
  it('round-trips through snapshots, checkpoint restore and merge without an owner agent', () => {
    const graph = new ProjectGraph();
    const project = graph.registerProject('/tmp/canvas-memo-project');
    const memo = note('orphan', { x: -400, closedAt: 10, canvas: { agentId: 'deleted', subAgentId: 'deleted-sub', x: 40, y: 60, folderId: null } });
    graph.setCanvasMemos(project.name, [memo]);
    expect(graph.getSnapshot().canvasMemos?.[project.name]).toEqual([memo]);
    const checkpoint = graph.toProjectCheckpoint(project.name)!;
    const restored = new ProjectGraph(); restored.registerProject(project.path); restored.restoreFromCheckpoint(checkpoint);
    const merged = new ProjectGraph(); merged.registerProject(project.path); merged.mergeFromCheckpoint(checkpoint);
    expect(restored.getCanvasMemos(project.name)).toEqual([memo]);
    expect(merged.getCanvasMemos(project.name)).toEqual([memo]);
    expect(mergeSnapshots(restored.getSnapshot(), merged.getSnapshot()).canvasMemos?.[project.name]).toEqual([memo]);
    graph.setCanvasMemos(project.name, []);
    expect(graph.toProjectCheckpoint(project.name)?.canvasMemos).toEqual({ [project.name]: [] });
  });
});
