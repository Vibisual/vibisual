import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Vibi3DRun } from '@vibisual/shared';
import { emitAppEvent } from '../../apps/appEvents.js';
import { useVibi3DWorkflow } from './useVibi3DWorkflow.js';

let view: ReactTestRenderer | undefined;
let seen: ReturnType<typeof useVibi3DWorkflow>;
const request = vi.fn();
const run = (id: string): Vibi3DRun => ({ id, docId: id, projectId: '/Project', baseRevision: 1,
  currentRevision: 2, initialEmpty: true, createdAt: 1, stages: [] });
const response = (id: string): Response => ({ ok: true, json: async () => ({ run: run(id) }) }) as Response;
function Probe({ id }: { id: string }): null { seen = useVibi3DWorkflow('/Project', id, 1); return null; }
beforeEach(() => { request.mockReset(); vi.stubGlobal('fetch', request); });
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.unstubAllGlobals(); });

describe('native authoring stage history', () => {
  it('cannot display the previous document after an in-flight read finishes', async () => {
    let finish!: (value: Response) => void;
    request.mockReturnValueOnce(new Promise<Response>(resolve => { finish = resolve; })).mockResolvedValue(response('new'));
    await act(async () => { view = create(createElement(Probe, { id: 'old' })); });
    await act(async () => { view!.update(createElement(Probe, { id: 'new' })); });
    await act(async () => { finish(response('old')); });
    expect(seen.run?.docId).toBe('new');
  });

  it('refreshes only its exact document and canonical host project, without a polling timer', async () => {
    request.mockResolvedValue(response('doc'));
    await act(async () => { view = create(createElement(Probe, { id: 'doc' })); });
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => {
      emitAppEvent({ appId: 'vibi3d', kind: 'workflow-updated', project: '/project', key: 'doc' });
      emitAppEvent({ appId: 'vibi3d', kind: 'workflow-updated', project: '/Project', key: 'other' });
    });
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => { emitAppEvent({ appId: 'vibi3d', kind: 'workflow-updated', project: '/Project', key: 'doc' }); });
    expect(request).toHaveBeenCalledTimes(2);
  });
});
