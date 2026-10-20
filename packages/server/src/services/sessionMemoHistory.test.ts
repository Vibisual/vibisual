import { describe, expect, it } from 'vitest';
import {
  SESSION_MEMO,
  SESSION_MEMO_DEFAULT_COLOR,
  repairMemoGroups,
  sanitizeSessionMemo,
  sanitizeSessionMemos,
  type SessionMemo,
} from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { SubAgentManager, subAgentManager } from './subAgentManager.js';

function memo(id: string, extra: Partial<SessionMemo> = {}): SessionMemo {
  return {
    id, text: `Note ${id}`, x: 40, y: 60,
    w: SESSION_MEMO.DEFAULT_W, h: SESSION_MEMO.DEFAULT_H,
    color: SESSION_MEMO_DEFAULT_COLOR, createdAt: 1000, updatedAt: 1000,
    ...extra,
  };
}

describe('closed memo history normalization', () => {
  it('keeps the close timestamp, content, links and appearance without group membership', () => {
    const note = memo('closed', {
      closedAt: 2000, name: 'Remember', alpha: 0.4,
      groupId: 'group', groupActive: true,
      links: [{ id: 'link', start: 0, end: 4, target: { kind: 'file', path: 'src/main.ts' } }],
    });
    const { groupId, groupActive, ...expected } = note;
    expect(sanitizeSessionMemo(note)).toEqual(expected);
    expect(sanitizeSessionMemos([expected])).toEqual([expected]);
  });

  it('accepts a zero timestamp but never treats invalid values as closed', () => {
    expect(sanitizeSessionMemo(memo('zero', { closedAt: 0 }))?.closedAt).toBe(0);
    for (const closedAt of [-1, NaN, Infinity, '2000', null]) {
      expect(sanitizeSessionMemo({ ...memo('invalid'), closedAt })).not.toHaveProperty('closedAt');
    }
  });

  it('retains every closed note before and after a full set of open notes', () => {
    const history = Array.from({ length: SESSION_MEMO.MAX_PER_OWNER * 3 }, (_, i) => memo(`closed-${i}`, { closedAt: 2000 + i }));
    const opened = Array.from({ length: SESSION_MEMO.MAX_PER_OWNER + 5 }, (_, i) => memo(`open-${i}`));
    for (const input of [[...history, ...opened], [...opened, ...history]]) {
      const output = sanitizeSessionMemos(input);
      expect(output.filter((m) => m.closedAt !== undefined)).toEqual(history);
      expect(output.filter((m) => m.closedAt === undefined)).toHaveLength(SESSION_MEMO.MAX_PER_OWNER);
      expect(sanitizeSessionMemos(output)).toEqual(output);
    }
  });

  it('a closed active tab cannot move or collapse the remaining open tabs', () => {
    const output = repairMemoGroups([
      memo('a', { groupId: 'group', x: 10 }),
      memo('b', { groupId: 'group', x: 20 }),
      memo('closed', { groupId: 'group', groupActive: true, closedAt: 2000, x: 999, collapsed: true }),
    ]);
    expect(output.slice(0, 2).map((m) => [m.x, m.collapsed, m.groupActive])).toEqual([
      [20, undefined, undefined], [20, undefined, true],
    ]);
    expect(output[2]).toMatchObject({ x: 999, collapsed: true, closedAt: 2000 });
    expect(output[2]).not.toHaveProperty('groupId');
    expect(output[2]).not.toHaveProperty('groupActive');
  });
});

describe('closed memo history ownership and persistence', () => {
  it('survives closing a session, restarting from its archive and reopening the same session', () => {
    const manager = new SubAgentManager();
    const sub = manager.create('memo-history-parent');
    const other = manager.create('memo-history-parent');
    const notes = sanitizeSessionMemos([memo('open'), memo('closed', { closedAt: 2000 })]);
    manager.setSessionMemos(sub.id, notes);
    manager.setSessionMemos(other.id, [memo('other')]);
    manager.remove(sub.id);
    expect(manager.getSessionMemos(other.id)).toEqual([memo('other')]);
    expect(manager.getSessionMemos(sub.id)).toEqual([]);

    const restarted = new SubAgentManager();
    restarted.restore(manager.getSnapshot(), 0, undefined, manager.getArchiveSnapshot());
    expect(restarted.restoreFromArchive(sub.id)?.memos).toEqual(notes);

    const reopened = notes.map(({ closedAt, ...note }) => note);
    restarted.setSessionMemos(sub.id, reopened);
    expect(restarted.getSessionMemos(sub.id)).toEqual(reopened);
    expect(restarted.getSessionMemos(other.id)).toEqual([memo('other')]);
  });

  it('main-tab checkpoint restore and merge retain history beyond the open note cap', () => {
    const graph = new ProjectGraph();
    const project = graph.registerProject('/tmp/memo-history');
    const owner = graph.createCustomAgent('Memo History', undefined, project.name);
    const opened = Array.from({ length: SESSION_MEMO.MAX_PER_OWNER }, (_, i) => memo(`open-${i}`));
    const history = Array.from({ length: SESSION_MEMO.MAX_PER_OWNER + 5 }, (_, i) => memo(`closed-${i}`, { closedAt: 2000 + i }));
    graph.setAgentMemos(owner.id, [...opened, ...history]);
    const checkpoint = graph.toProjectCheckpoint(project.name)!;

    const restored = new ProjectGraph();
    restored.registerProject('/tmp/memo-history');
    restored.restoreFromCheckpoint(checkpoint);
    expect(restored.getAgentMemos(owner.id)).toEqual([...opened, ...history]);

    const added = memo('older-closed', { closedAt: 1500 });
    checkpoint.agentMemos = { [owner.id]: [memo('extra-open'), added] };
    restored.mergeFromCheckpoint(checkpoint);
    expect(restored.getAgentMemos(owner.id)).toEqual([...opened, ...history, added]);
    expect(restored.getSnapshot().agentMemos?.[owner.id]).toEqual([...opened, ...history, added]);
  });

  it('soft trash preserves history, while final deletion clears live and archived session memos only for that owner', () => {
    const graph = new ProjectGraph();
    const project = graph.registerProject('/tmp/memo-history-delete');
    const owner = graph.createCustomAgent('Delete History', undefined, project.name);
    const otherOwner = graph.createCustomAgent('Keep History', undefined, project.name);
    const live = subAgentManager.create(owner.id);
    const archived = subAgentManager.create(owner.id);
    const other = subAgentManager.create(otherOwner.id);
    const history = [memo('closed', { closedAt: 2000 })];
    try {
      graph.setAgentMemos(owner.id, history);
      for (const sub of [live, archived, other]) subAgentManager.setSessionMemos(sub.id, history);
      subAgentManager.remove(archived.id);

      expect(graph.trashCustomAgentByBubbleId(owner.id)).toBe(true);
      expect(graph.restoreTrashedAgent(owner.id)).toBe(true);
      expect(graph.getAgentMemos(owner.id)).toEqual(history);
      expect(subAgentManager.getSessionMemos(live.id)).toEqual(history);
      expect(subAgentManager.getArchived(owner.id)[0]?.memos).toEqual(history);

      graph.trashCustomAgentByBubbleId(owner.id);
      expect(graph.permanentlyDeleteTrashedAgent(owner.id)).toBe(true);
      expect(graph.getAgentMemos(owner.id)).toEqual([]);
      expect(subAgentManager.getSessionMemos(live.id)).toEqual([]);
      expect(subAgentManager.getArchived(owner.id)[0]?.memos).toBeUndefined();
      expect(subAgentManager.getSessionMemos(other.id)).toEqual(history);
      const saved = graph.toProjectCheckpoint(project.name)!;
      expect(saved.agentMemos?.[owner.id]).toBeUndefined();
      expect(saved.subAgents?.[owner.id]).toBeUndefined();
      expect(saved.archivedSubAgents?.[owner.id]).toBeUndefined();
    } finally {
      subAgentManager.remove(live.id);
      subAgentManager.remove(other.id);
    }
  });
});
