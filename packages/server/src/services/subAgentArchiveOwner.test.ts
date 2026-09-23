import { describe, expect, it } from 'vitest';
import { SubAgentManager } from './subAgentManager.js';

describe('restoring only the requested parent conversation', () => {
  it('a duplicated reorder ID cannot replace another open conversation', () => {
    const manager = new SubAgentManager();
    const first = manager.create('agent-a');
    const second = manager.create('agent-a');
    expect(manager.reorder('agent-a', [first.id, first.id])).toBe(false);
    expect(manager.getSnapshot()['agent-a']?.map((sub) => sub.id)).toEqual([first.id, second.id]);
    expect(manager.reorder('agent-a', [second.id, first.id])).toBe(true);
    expect(manager.getSnapshot()['agent-a']?.map((sub) => sub.id)).toEqual([second.id, first.id]);
  });
  it('a different project cannot move a closed conversation out of its archive', () => {
    const manager = new SubAgentManager();
    const sub = manager.create('agent-b');
    sub.sessionId = 'existing-conversation-b';
    manager.remove(sub.id);
    expect(manager.restoreFromArchive(sub.id, 'agent-a')).toBeNull();
    expect(manager.getSub(sub.id)).toBeUndefined();
    expect(manager.getArchived('agent-b')).toHaveLength(1);
    const restored = manager.restoreFromArchive(sub.id, 'agent-b');
    expect(restored?.sessionId).toBe('existing-conversation-b');
    expect(manager.getArchived('agent-b')).toEqual([]);
    expect(manager.restoreFromArchive(sub.id, 'agent-b')).toBe(restored);
  });

  it('a duplicate restore from the wrong parent cannot return another project live tab', () => {
    const manager = new SubAgentManager();
    const sub = manager.create('agent-b');
    expect(manager.restoreFromArchive(sub.id, 'agent-a')).toBeNull();
    expect(manager.getSub(sub.id)).toBe(sub);
  });
});
