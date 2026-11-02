import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueuedCommand } from '@vibisual/shared';
import { useGraphStore } from './graphStore.js';

const command: QueuedCommand = {
  id: 'base', text: 'Original task', timestamp: 1, status: 'executing', subAgentId: 'S',
  followUps: [{ id: 'follow', text: 'See this image', timestamp: 2, deliveredAt: 3, attachments: ['C:\\work\\.vibisual\\attachments\\S\\follow.png'] }],
};

beforeEach(() => {
  useGraphStore.setState({ attachmentPreviews: { 'follow.png': 'blob:follow', 'unused.png': 'blob:unused' } });
  vi.spyOn(URL, 'revokeObjectURL');
});
afterEach(() => { vi.restoreAllMocks(); });

describe('accepted follow-up attachment previews', () => {
  it.each([false, true])('retains the preview after delivery moves the message into its parent (completed=%s)', (completed) => {
    const queues: Record<string, QueuedCommand[]> = completed ? {} : { agent: [command] };
    const archive: Record<string, QueuedCommand[]> = completed ? { agent: [{ ...command, status: 'completed' }] } : {};
    const s = useGraphStore.getState();
    s.loadSnapshot({}, [], [], {}, [], {}, {}, {}, {}, {}, {}, {}, {}, queues, archive, {},
      s.agentPhase, 0, {}, {}, {}, {}, {}, {}, {}, [], [], {}, {}, {});
    expect(useGraphStore.getState().attachmentPreviews['follow.png']).toBe('blob:follow');
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:follow');
    expect(useGraphStore.getState().attachmentPreviews['unused.png']).toBeUndefined();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:unused');
  });
});
