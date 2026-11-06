import { describe, expect, it } from 'vitest';
import type { BubbleData } from '@vibisual/shared';
import { buildSessionBubbles } from './sessionBubbles.js';
import { buildSessionCanvasGraph } from './sessionCanvasGraph.js';
import { sessionBundlePageEntry, sessionBundlePageNodes, sessionBundleQueryFolderId, sessionBundleQueryLocation } from './sessionBundlePage.js';
import { applyConstellations, bundleInfoOf } from '../../utils/constellationView.js';

function graph() {
  const model = buildSessionBubbles({ rootPath: '/project', platform: 'linux', streams: [{ commands: [], events: [{
    id: 'event', subAgentId: 'session', parentAgentId: 'agent', eventType: 'tool_use', timestamp: 10,
    toolName: 'Read', content: JSON.stringify({ file_path: '/project/assets/known.png' }),
  }] }] });
  return buildSessionCanvasGraph({ model, rootPath: '/project', platform: 'linux', running: false,
    agent: null, agentId: 'agent', sessionId: 'session', webSearchLabel: 'Search' });
}

function file(id: string, name: string): BubbleData {
  return { id, label: name, path: `assets/${name}`, absolutePath: `/project/assets/${name}`, bubbleType: 'file', status: 'active',
    activity: 999, readCount: 800, writeCount: 199, lastActivity: 99999, lastTool: 'Write', fileSize: 1024 };
}

describe('session bundle page bridge', () => {
  it('queries the canonical folder in the owning project, including root and unavailable fallbacks', () => {
    const g = graph();
    const folder = { ...g.top[0]!, id: 'actual-folder' };
    const foreign = { ...folder, id: 'foreign-folder' };
    expect(sessionBundleQueryFolderId(g, g.top[0]!.id, { foreign, folder },
      { 'foreign-folder': 'foreign', 'actual-folder': 'project' }, 'project', 'linux')).toBe('actual-folder');
    expect(sessionBundleQueryFolderId(g, null, {}, {}, 'project', 'linux')).toBe('');
    expect(sessionBundleQueryFolderId(g, g.top[0]!.id, {}, {}, 'project', 'linux')).toBeNull();
  });

  it('keeps known session activity and hides unrelated activity for server-only files', () => {
    const g = graph();
    const nodes = sessionBundlePageNodes([file('known', 'known.png'), file('old', 'old.png')], g, 'session', 'linux');
    expect(nodes.map((node) => node.id)).toEqual(['sb:file:/project/assets/known.png', 'sb:file:/project/assets/old.png']);
    expect([nodes[0]!.readCount, nodes[0]!.writeCount, nodes[0]!.lastTool, nodes[0]!.lastActivity]).toEqual([1, 0, 'Read', 10]);
    expect([nodes[1]!.readCount, nodes[1]!.writeCount, nodes[1]!.lastTool, nodes[1]!.lastActivity, nodes[1]!.activity])
      .toEqual([undefined, undefined, undefined, undefined, 0]);
    expect(nodes[1]!.fileSize).toBe(1024);
    expect(nodes[1]!.status).toBe('idle');
    const entry = sessionBundlePageEntry(g, nodes[1], 'linux');
    expect(entry?.kind === 'file' && entry.file.historyOnly).toBe(true);
  });

  it('queries the exact local folder path when its canonical snapshot twin is missing', () => {
    const g = graph();
    const folderId = g.top[0]!.id;
    const canonical = sessionBundleQueryFolderId(g, folderId, {}, {}, 'project', 'linux');
    expect(sessionBundleQueryLocation(g, folderId, canonical)).toEqual({ folderId: '', folderAbsolutePath: '/project/assets' });
    expect(sessionBundleQueryLocation(g, folderId, 'actual-folder')).toEqual({ folderId: 'actual-folder' });
    expect(sessionBundleQueryLocation(g, 'unknown-folder', null)).toBeNull();
    expect(sessionBundleQueryLocation(g, null, null)).toBeNull();
    expect(sessionBundleQueryLocation(g, null, '')).toEqual({ folderId: '' });
  });

  it('maps a root radial bundle owner to the root API query', () => {
    const model = buildSessionBubbles({ streams: [], rootPath: '/project', platform: 'linux',
      previewPaths: ['/project/a.png', '/project/b.png'] });
    const g = buildSessionCanvasGraph({ model, rootPath: '/project', platform: 'linux', running: false,
      agent: null, agentId: 'agent', sessionId: 'session', webSearchLabel: 'Search' });
    const view = applyConstellations({ radial: g.top, satInfos: [], appHubs: [], heat: undefined, platform: 'linux', bundleFolder: g.bundleRoot! });
    const info = bundleInfoOf(view.radial[0]!)!;
    expect(info.folderId).toBe(g.bundleRoot!.id);
    expect(sessionBundleQueryFolderId(g, info.folderId!, {}, {}, 'project', 'linux')).toBe('');
    expect(sessionBundleQueryFolderId(g, '', {}, {}, 'project', 'linux')).toBe('');
  });
});
