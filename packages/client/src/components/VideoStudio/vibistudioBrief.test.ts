import { beforeEach, expect, it, vi } from 'vitest';
import type { AppAgentBriefArgs } from '../../apps/registry.js';
import { AppAgentPreparationError } from '../../apps/registry.js';
const mocks = vi.hoisted(() => ({ read: vi.fn(), create: vi.fn() }));
vi.mock('./videoApi.js', () => ({ readDoc: mocks.read, createDoc: mocks.create }));
import { buildVibistudioBrief } from './vibistudioBrief.js';
const args: AppAgentBriefArgs = { projectId: 'C:/project', projectName: 'project', request: 'Make the title larger',
  bubble: { id: 'node', label: 'Video', ref: 'existing' } };
beforeEach(() => vi.clearAllMocks());

it('never creates a substitute document when reading an existing task fails', async () => {
  mocks.read.mockRejectedValue(new Error('Disconnected'));
  await expect(buildVibistudioBrief(args)).rejects.toBeInstanceOf(AppAgentPreparationError);
  expect(mocks.create).not.toHaveBeenCalled();
});
it('continues using the existing editable document', async () => {
  mocks.read.mockResolvedValue({ doc: { id: 'existing', version: 4, tracks: [] }, duration: 0 });
  expect((await buildVibistudioBrief(args))?.ref).toBe('existing');
  expect(mocks.create).not.toHaveBeenCalled();
});
it('does not dispatch a generic output request when creating the required source fails', async () => {
  mocks.create.mockRejectedValue(new Error('Disk full'));
  await expect(buildVibistudioBrief({ ...args, bubble: { id: 'new', label: 'New' } })).rejects.toBeInstanceOf(AppAgentPreparationError);
});
