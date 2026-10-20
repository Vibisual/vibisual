import { describe, expect, it, vi } from 'vitest';
import { createEmptyDoc } from '../ops.js';
import type { AppServerHost } from '../host.js';
import type { VideoDoc } from '../types.js';
import { VideoSourceSync, videoCreationLinks } from './sourceSync.js';

const old = { id: 'old', kind: 'model' as const, source: { kind: 'file' as const, path: 'old.glb' }, creationSource: { id: 'p', revision: 1, appId: 'vibi3d' } };
function linked(title: string, revision = 1): VideoDoc {
  return { ...createEmptyDoc('d', title), assets: { old: { ...old, creationSource: { ...old.creationSource, revision } } },
    tracks: [{ id: 'v', kind: 'visual' as const, items: [{ id: 'a', kind: 'model' as const, at: 0, duration: 3, assetId: 'old' }] }] };
}
function recordingHost(fail?: (title: string) => boolean) {
  const calls: { title: string; links: number }[] = [];
  const host: AppServerHost = { resolveProjectPath: () => '/project', atomicWriteFile: vi.fn(), info: vi.fn(), warn: vi.fn(),
    syncCreationSource: async (_p, source) => {
      calls.push({ title: source.title, links: source.links.length });
      if (fail?.(source.title)) throw new Error('offline');
      return { id: source.key, revision: calls.length };
    } };
  return { host, calls };
}

describe('video source index', () => {
  it('indexes only actual source consumers, keeping old and new revisions separate', () => {
    const doc = { ...createEmptyDoc('d', ''), assets: { old, unused: { ...old, id: 'unused' }, next: { ...old, id: 'next', creationSource: { ...old.creationSource, revision: 2 } } },
      tracks: [{ id: 'v', kind: 'visual' as const, items: [{ id: 'a', kind: 'model' as const, at: 0, duration: 3, assetId: 'old' }, { id: 'b', kind: 'model' as const, at: 3, duration: 3, assetId: 'next' }] }] };
    expect(videoCreationLinks(doc)).toEqual([
      { id: 'old', sourceId: 'p', sourceRevision: 1, role: 'model', targets: ['a'] },
      { id: 'next', sourceId: 'p', sourceRevision: 2, role: 'model', targets: ['b'] },
    ]);
  });
  it('folds a burst of saves into one write of the latest document', async () => {
    const sync = new VideoSourceSync(5); const { host, calls } = recordingHost();
    sync.enqueue(host, '/project', linked('first'));
    sync.enqueue(host, '/project', linked('second'));
    sync.enqueue(host, '/project', linked('third'));
    expect(await sync.status('/project', 'd')).toEqual({ ok: true });
    expect(calls).toEqual([{ title: 'third', links: 1 }]);
  });
  it('sends nothing when title and links did not change (content edits do not reach the index)', async () => {
    const sync = new VideoSourceSync(5); const { host, calls } = recordingHost();
    sync.enqueue(host, '/project', linked('movie'));
    await sync.status('/project', 'd');
    const edited = { ...linked('movie'), fps: 60 };
    sync.enqueue(host, '/project', edited);
    await sync.status('/project', 'd');
    expect(calls).toHaveLength(1);
    sync.enqueue(host, '/project', linked('movie', 2));
    await sync.status('/project', 'd');
    expect(calls).toHaveLength(2);
  });
  it('repairs an older index once per document when opened, not on every status call', async () => {
    const sync = new VideoSourceSync(5); const { host, calls } = recordingHost();
    sync.ensure(host, '/project', linked('movie'));
    await sync.status('/project', 'd');
    sync.ensure(host, '/project', linked('movie'));
    await sync.status('/project', 'd');
    expect(calls).toHaveLength(1);
  });
  it('reports a failure and retries with the next save without losing it', async () => {
    const sync = new VideoSourceSync(5); const { host, calls } = recordingHost(title => title === 'first');
    sync.enqueue(host, '/project', linked('first'));
    expect((await sync.status('/project', 'd')).ok).toBe(false);
    sync.enqueue(host, '/project', linked('second'));
    expect(await sync.status('/project', 'd')).toEqual({ ok: true });
    expect(calls.map(c => c.title)).toEqual(['first', 'second']);
  });
});
