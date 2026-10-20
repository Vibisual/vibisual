import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppAgentBriefArgs } from '../../apps/registry.js';
import { AppAgentPreparationError } from '../../apps/registry.js';
import { buildVibi3DBrief } from './vibi3dBrief.js';

const mocks = vi.hoisted(() => ({ read: vi.fn(), prepare: vi.fn() }));
vi.mock('./modelSource.js', async (original) => ({ ...await original<typeof import('./modelSource.js')>(), readModelDocument: mocks.read }));
vi.mock('./vibi3dWorkflow.js', async (original) => ({ ...await original<typeof import('./vibi3dWorkflow.js')>(), prepareVibi3DRun: mocks.prepare }));
const args: AppAgentBriefArgs = { projectId: '/project', projectName: 'Project', request: 'Make a storefront',
  bubble: { id: 'node', label: 'Model', ref: 'product' } };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({ id: 'product', revision: 1, payload: { format: 'vibi3d', version: 1 }, links: [] });
  mocks.prepare.mockResolvedValue({ snapshot: { sessionId: 'live', projectId: '/project', fileName: 'Model', revision: 0, nodes: [], selectedId: null,
    document: { id: 'product', revision: 1, dirty: false } }, run: { id: 'run', stages: [] }, previousRun: null });
});
describe('canvas native brief', () => {
  it('prepares the bound live document and declares the local transport for the existing command queue', async () => {
    const brief = await buildVibi3DBrief(args);
    expect(mocks.prepare).toHaveBeenCalledWith('/project', 'product');
    expect(brief).toMatchObject({ ref: 'product', executionRequirements: { localTransport: true } });
    expect(brief!.text).toContain('/sessions/live/commands');
    expect(brief!.text).toContain('At EVERY stage: checkpoint');
    expect(brief!.text).not.toContain('LOCAL CLI MODELING: prefer');
  });
  it('retains the existing kit when this request explicitly selects Blender', async () => {
    const brief = await buildVibi3DBrief({ ...args, request: 'Use Blender for this object' });
    expect(brief!.text).toContain('LOCAL CLI MODELING: prefer');
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it('continues the restored autosaved AI draft and treats older named stages only as explicit restore choices', async () => {
    mocks.prepare.mockResolvedValue({ snapshot: { sessionId: 'retained', projectId: '/project', fileName: 'Model', revision: 12,
      nodes: [], selectedId: null, document: { id: 'product', revision: 1, dirty: true, humanDirty: false } },
      run: null, previousRun: { id: 'older-run', docId: 'product', stages: [{ id: 'blockout' }] } });
    const brief = await buildVibi3DBrief({ ...args, request: 'Continue my model' });
    expect(brief!.text).toContain('/sessions/retained/commands');
    expect(brief!.text).toContain('Continue the automatically saved AI work draft');
    expect(brief!.text).toContain('Only when the user explicitly selects a named saved stage');
    expect(brief!.text).not.toContain('At EVERY stage: checkpoint');
    expect(brief!.text).not.toContain('Run context: null');
    expect(brief!.text).not.toContain('Otherwise start from the current source');
  });
  it('fails closed on a source read failure and never creates a replacement document', async () => {
    mocks.read.mockRejectedValue(new Error('offline'));
    await expect(buildVibi3DBrief(args)).rejects.toBeInstanceOf(AppAgentPreparationError);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
