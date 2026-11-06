import { describe, expect, it } from 'vitest';
import { BUNDLE_BUBBLE, type BubbleData } from '@vibisual/shared';
import { retainSessionPreviewPaths, sessionPreviewBundleSummaries, sessionPreviewPaths } from './sessionPreviewSnapshot.js';
import { buildSessionBubbles } from './sessionBubbles.js';
import { buildSessionCanvasGraph } from './sessionCanvasGraph.js';
import { applyConstellations, bundleInfoOf, bundleInteriorMembers } from '../../utils/constellationView.js';
import { collectSatellites } from '../../utils/satellite.js';

const preview = (id: string, absolutePath: string, sessions: string[]): BubbleData => ({
  id, absolutePath, path: absolutePath, label: id, bubbleType: 'file', status: 'idle', activity: 999,
  readCount: 800, writeCount: 199, lastActivity: 99999, lastTool: 'Write', previewSessionIds: sessions,
});

describe('session preview snapshot supplement', () => {
  it('collects only exact session preview paths across snapshot scopes and deduplicates files', () => {
    const image = preview('image', '/project/assets/a.png', ['session-a']);
    const pdf = preview('pdf', '/project/assets/a.pdf', ['session-a', 'session-b']);
    const other = preview('other', '/project/assets/other.png', ['session-b']);
    const ordinary = preview('text', '/project/assets/note.md', ['session-a']);
    expect(sessionPreviewPaths({ image, ordinary }, { folder: [image, pdf, other] }, { folder: [pdf] }, 'session-a', 'linux'))
      .toEqual(['/project/assets/a.png', '/project/assets/a.pdf']);
    expect(sessionPreviewPaths({ image }, {}, {}, null, 'linux')).toEqual([]);
  });

  it('does not infer ownership from open-turn state or path proximity', () => {
    const unknown = { ...preview('unknown', '/project/a.png', []), inOpenTurn: true };
    expect(sessionPreviewPaths({ unknown }, {}, {}, 'session-a', 'linux')).toEqual([]);
  });

  it('does not import other sessions activity counts, tool direction, or timestamps', () => {
    const image = preview('image', '/project/assets/a.png', ['session-a', 'session-b']);
    const previewPaths = sessionPreviewPaths({ image }, {}, {}, 'session-a', 'linux');
    const model = buildSessionBubbles({ streams: [], rootPath: '/project', platform: 'linux', previewPaths });
    expect([model.fileCount, model.toolCalls, model.readCount, model.writeCount]).toEqual([1, 0, 0, 0]);
    expect(model.folders[0]?.files[0]?.historyOnly).toBe(true);
    const graph = buildSessionCanvasGraph({ model, rootPath: '/project', platform: 'linux', running: false,
      agentId: 'agent-a', agent: null, sessionId: 'session-a', webSearchLabel: 'Search' });
    const file = graph.satellites[graph.top[0]!.id]![0]!;
    expect([file.readCount, file.writeCount, file.lastTool, file.lastActivity]).toEqual([undefined, undefined, undefined, undefined]);
    expect(graph.edges).toEqual([]);
    expect(graph.top[0]?.readCount).toBeUndefined();
  });

  it('retains paths when a later scoped snapshot omits them and normalizes path case by platform', () => {
    const prior = ['C:/project/Assets/A.png'];
    expect(retainSessionPreviewPaths(prior, [], 'win32')).toBe(prior);
    expect(retainSessionPreviewPaths(prior, ['c:/project/assets/a.png'], 'win32')).toBe(prior);
    expect(retainSessionPreviewPaths(['/project/A.png'], ['/project/a.png'], 'linux')).toEqual(['/project/A.png', '/project/a.png']);
  });

  it('retains a full session bundle beyond the interior page size', () => {
    const count = BUNDLE_BUBBLE.interiorMax + 5;
    const previewPaths = Array.from({ length: count }, (_, index) => `/project/assets/shot-${index}.png`);
    const model = buildSessionBubbles({ streams: [], rootPath: '/project', platform: 'linux', previewPaths });
    const graph = buildSessionCanvasGraph({ model, rootPath: '/project', platform: 'linux', running: false,
      agentId: 'agent-a', agent: null, sessionId: 'session-a', webSearchLabel: 'Search' });
    const view = applyConstellations({ radial: graph.top, satInfos: collectSatellites(graph.top, graph.satellites, undefined),
      appHubs: [], heat: undefined, platform: 'linux' });
    const bundle = bundleInfoOf(view.satInfos.find((sat) => sat.bubble.bubbleType === 'bundle')!.bubble)!;
    expect(bundle.count).toBe(count);
    expect(bundleInteriorMembers({ memberIds: bundle.memberIds, folderId: bundle.folderId, fileKind: bundle.kind, sessionId: bundle.sessionId },
      graph.nodeMap, graph.children, graph.satellites)).toHaveLength(count);
  });

  it('preserves full counts from representative snapshots in the matching folder and session', () => {
    const folder: BubbleData = { id: 'folder', label: 'assets', path: 'assets', absolutePath: '/project/assets',
      bubbleType: 'internal_folder', status: 'idle', activity: 1 };
    const images = ['a.png', 'b.png'].map((name) => ({ ...preview(name, `/project/assets/${name}`, ['session-a']),
      folderNodeId: folder.id, previewSessionCounts: { 'session-a': 350, 'session-b': 900 }, previewSessionDirs: { 'session-a': 'assets' } }));
    const summaries = sessionPreviewBundleSummaries({ folder }, { folder: images }, {}, 'session-a', '/project', 'linux');
    const model = buildSessionBubbles({ streams: [], rootPath: '/project', platform: 'linux', previewPaths: images.map((node) => node.absolutePath!) });
    const graph = buildSessionCanvasGraph({ model, rootPath: '/project', platform: 'linux', running: false, agent: null,
      agentId: 'agent-a', sessionId: 'session-a', webSearchLabel: 'Search', previewBundleSummaries: summaries });
    expect(graph.satellites[graph.top[0]!.id]!.map((node) => node.folderKindCount)).toEqual([350, 350]);
    expect(Object.values(summaries)).toEqual(['[350,"assets"]']);
  });
});
