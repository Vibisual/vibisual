import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUBBLE_TTL, type BubbleData, type HookEventPayload, type SubAgent } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { subAgentManager } from './subAgentManager.js';

let root: string;
let graph: ProjectGraph;
let seq = 0;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-preview-sessions-')));
  graph = new ProjectGraph();
  graph.registerProject(root);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

function touch(file: string, session = 'native-session', subId?: string): void {
  const absolute = path.isAbsolute(file) ? file : path.join(root, file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, 'preview');
  const payload: HookEventPayload = {
    session_id: session, cwd: root, hook_event_name: 'PostToolUse', tool_name: 'Read',
    tool_use_id: `preview-${++seq}`, tool_input: { file_path: absolute },
    ...(subId ? { _vibisualSubAgentId: subId } : {}),
  };
  graph.processHookEvent(payload);
}

function files(source = graph): BubbleData[] {
  return [...new Map(Object.values(source.getSnapshot().satellites).flat()
    .filter((node) => node.bubbleType === 'file').map((node) => [node.id, node])).values()];
}

function customSubs(): { owner: BubbleData; session: string; subs: SubAgent[] } {
  const owner = graph.createCustomAgent('Preview owner', undefined, path.basename(root));
  const session = graph.findSessionByAgentId(owner.id)!;
  const subs: SubAgent[] = ['sub-alpha', 'sub-beta'].map((id) => ({
    id, sessionId: `native-${id}`, label: id, parentAgentId: owner.id, status: 'idle',
    createdAt: Date.now(), lastActivityAt: Date.now(),
  }));
  vi.spyOn(subAgentManager, 'getSub').mockImplementation((id) => subs.find((sub) => sub.id === id));
  vi.spyOn(subAgentManager, 'getAllSubsFlat').mockReturnValue(subs);
  return { owner, session, subs };
}

describe('session preview ownership', () => {
  it('removes previews and their folders on confirm like any other file bubble', () => {
    touch('assets/nested/first.png');
    touch('assets/nested/second.png');
    touch('assets/notes.md');
    const assets = graph.getSnapshot().topFolders.find((node) => node.label === 'assets')!;
    expect(files().map((node) => node.label).sort()).toEqual(['first.png', 'notes.md', 'second.png']);
    expect(files().every((node) => node.label === 'notes.md'
      || (node.inSessionPreview && node.previewSessionIds?.includes('native-session')))).toBe(true);
    graph.markAgentIdle('native-session', true);
    const snapshot = graph.getSnapshot();
    expect(files()).toEqual([]);
    expect(snapshot.topFolders.some((node) => node.id === assets.id)).toBe(false);
    expect(snapshot.edges.some((edge) => [edge.source, edge.target].includes(assets.id))).toBe(false);
    expect(Object.keys(graph.toProjectCheckpoint(path.basename(root)).graph.nodes).filter((key) => key.startsWith('assets'))).toEqual([]);
  });

  it('lets previews and their folders expire after the idle TTL', () => {
    touch('assets/nested/first.png');
    touch('assets/nested/second.png');
    graph.markAgentIdle('native-session');
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + BUBBLE_TTL * 2);
    expect(files()).toEqual([]);
    expect(graph.getSnapshot().topFolders.some((node) => node.label === 'assets')).toBe(false);
  });

  it('counts only previews of the unconfirmed turn in the bundle', () => {
    touch('assets/a.png');
    touch('assets/b.png');
    const owner = graph.getAgentBySession('native-session')!;
    graph.markAgentIdle('native-session');
    expect(graph.beginAgentTurn(owner.id, false)).toBe(true);
    touch('assets/c.png');
    touch('assets/d.png');
    const folder = graph.getSnapshot().topFolders.find((node) => node.label === 'assets')!;
    expect(files().map((node) => node.label).sort()).toEqual(['c.png', 'd.png']);
    expect(files().every((node) => node.folderKindCount === 2 && node.inOpenTurn === true)).toBe(true);
    expect(graph.getBundleFiles(folder.id, 'image')?.total).toBe(2);
    expect(graph.acknowledgeAgentTurn(owner.id)).toBe(true);
    expect(files()).toEqual([]);
    expect(graph.getBundleFiles(folder.id, 'image')?.total).toBe(0);
  });

  it('records separate custom sessions including shared files and rewritten worker sessions', () => {
    const { owner, session, subs } = customSubs();
    touch('assets/a.png', session, subs[0]!.id);
    touch('assets/b.png', subs[1]!.sessionId);
    touch('assets/shared.png', session, subs[0]!.id);
    touch('assets/shared.png', session, subs[1]!.id);
    const byName = new Map(files().map((node) => [node.label, node]));
    expect(byName.get('a.png')?.previewSessionIds).toEqual(['sub-alpha']);
    expect(byName.get('b.png')?.previewSessionIds).toEqual(['sub-beta']);
    expect(byName.get('shared.png')?.previewSessions).toEqual({ 'sub-alpha': owner.id, 'sub-beta': owner.id });
  });

  it('round trips and merges exact session ownership without persisting display fields', () => {
    const { session } = customSubs();
    touch('assets/shared.png', session, 'sub-alpha');
    const first = structuredClone(graph.toProjectCheckpoint(path.basename(root)));
    touch('assets/shared.png', session, 'sub-beta');
    const second = structuredClone(graph.toProjectCheckpoint(path.basename(root)));
    const restored = new ProjectGraph();
    restored.restoreFromCheckpoint(first);
    expect(files(restored)[0]?.previewSessionIds).toEqual(['sub-alpha']);
    restored.mergeFromCheckpoint(second);
    expect(new Set(files(restored)[0]?.previewSessionIds)).toEqual(new Set(['sub-alpha', 'sub-beta']));
    const saved = restored.toProjectCheckpoint(path.basename(root)).graph.nodes['assets/shared.png']!;
    expect(saved.previewSessions).toEqual(second.graph.nodes['assets/shared.png']!.previewSessions);
    expect(saved.inSessionPreview).toBeUndefined();
    expect(saved.previewSessionIds).toBeUndefined();
  });

  it('recovers old native ownership and keeps unresolved custom ownership outside named sessions', () => {
    const { owner, session } = customSubs();
    touch('assets/custom.png', session, 'sub-alpha');
    touch('assets/native.png');
    const checkpoint = structuredClone(graph.toProjectCheckpoint(path.basename(root)));
    delete checkpoint.auditLog;
    for (const node of Object.values(checkpoint.graph.nodes)) delete node.previewSessions;
    checkpoint.graph.hierarchy.satelliteMap['assets'] = [];
    const restored = new ProjectGraph();
    restored.restoreFromCheckpoint(checkpoint);
    const byName = new Map(files(restored).map((node) => [node.label, node]));
    expect(byName.get('native.png')?.previewSessionIds).toEqual(['native-session']);
    expect(byName.get('custom.png')?.inSessionPreview).toBe(true);
    expect(byName.get('custom.png')?.previewSessionIds).toEqual([]);
    expect(restored.getAgentBySession(session)?.id).toBe(owner.id);
  });

  it('recovers exact custom ownership from an existing audit record', () => {
    const { session } = customSubs();
    touch('assets/a.png', session, 'sub-alpha');
    const checkpoint = structuredClone(graph.toProjectCheckpoint(path.basename(root)));
    delete checkpoint.graph.nodes['assets/a.png']!.previewSessions;
    const restored = new ProjectGraph();
    restored.restoreFromCheckpoint(checkpoint);
    expect(files(restored)[0]?.previewSessionIds).toEqual(['sub-alpha']);
  });

  it('keeps ordinary document limits independent from PDF, HTML and media previews', () => {
    for (const name of ['image.png', 'report.pdf', 'page.html', 'clip.mp4', 'track.wav', 'scene.glb']) touch(`assets/${name}`);
    graph.setFolderMaxSatellites('assets', 1);
    touch('assets/old.md');
    touch('assets/new.ts');
    expect(files().map((node) => node.label).sort()).toEqual([
      'clip.mp4', 'image.png', 'new.ts', 'page.html', 'report.pdf', 'scene.glb', 'track.wav',
    ]);
  });

  it('keeps external previews outside explicit folder limits until confirm removes them', () => {
    const outside = path.join(root, '..', `${path.basename(root)}-external`);
    try {
      touch(path.join(outside, 'a/first.png'));
      touch(path.join(outside, 'b/second.png'));
      const before = graph.getSnapshot();
      const external = before.topFolders.find((node) => node.bubbleType === 'external_folder')!;
      expect(external).toBeDefined();
      graph.setFolderMaxSatellites(external.path, 1);
      expect(files().map((node) => node.label).sort()).toEqual(['first.png', 'second.png']);
      expect(graph.getSnapshot().satellites[external.id]?.map((node) => node.label).sort()).toEqual(['first.png', 'second.png']);
      graph.markAgentIdle('native-session', true);
      expect(files()).toEqual([]);
      expect(graph.getSnapshot().topFolders.some((node) => node.bubbleType === 'external_folder')).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('collects preview search results beyond the ordinary external document limit', () => {
    const outside = path.join(root, '..', `${path.basename(root)}-search`);
    try {
      fs.mkdirSync(outside);
      const names = ['one.ts', 'two.md', 'three.ts', 'first.png', 'second.pdf', 'third.png'];
      for (const name of names) fs.writeFileSync(path.join(outside, name), 'result');
      graph.processHookEvent({
        session_id: 'native-session', cwd: root, hook_event_name: 'PostToolUse', tool_name: 'Glob',
        tool_input: { path: outside, pattern: '*' }, tool_response: { filenames: names.map((name) => path.join(outside, name)) },
      });
      expect(files().map((node) => node.label).sort()).toEqual(['first.png', 'one.ts', 'second.pdf', 'third.png', 'two.md']);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('keeps unassigned custom previews without claiming a synthetic agent session', () => {
    const { session } = customSubs();
    touch('assets/unassigned.png', session);
    expect(files()[0]?.inSessionPreview).toBe(true);
    expect(files()[0]?.previewSessionIds).toEqual([]);
  });

  it('ships bounded representatives and pages through every session file', () => {
    const total = 251;
    for (let i = 0; i < total; i++) touch(`assets/shot-${i}.png`);
    const snapshot = graph.getSnapshot();
    const folder = snapshot.topFolders.find((node) => node.label === 'assets')!;
    const representatives = snapshot.satellites[folder.id]!;
    expect(representatives).toHaveLength(2);
    for (const node of representatives) {
      expect(node.previewSessionCounts).toEqual({ '': total, 'native-session': total });
      expect(node.folderKindCount).toBe(total);
    }
    expect(snapshot.children[folder.id]).toHaveLength(2);
    const pages = [0, 1, 2].map((page) => graph.getBundleFiles(folder.id, 'image', 'native-session', page)!);
    expect(pages.map((page) => page.items.length)).toEqual([120, 120, 11]);
    expect(new Set(pages.flatMap((page) => page.items.map((node) => node.id))).size).toBe(total);
    expect(graph.getBundleFiles(folder.id, 'image', 'another-session')?.total).toBe(0);
    expect(graph.getBundleFiles(folder.id, 'image')?.total).toBe(total);
    expect(graph.getBundleFiles(folder.id, 'image', 'native-session', 999)?.page).toBe(2);
  });

  it('pages root files and resolves exact member ids only for their session and type', () => {
    touch('first.png');
    touch('second.png');
    touch('third.png');
    const page = graph.getBundleFiles('', 'image', 'native-session')!;
    expect(page.total).toBe(3);
    expect(graph.getSnapshot().topFolders.filter((node) => node.bubbleType === 'file')).toHaveLength(2);
    const ids = page.items.map((node) => node.id).reverse();
    expect(graph.getBundleMembers(ids, 'image', 'native-session').map((node) => node.id)).toEqual(ids);
    expect(graph.getBundleMembers(ids, 'image', 'another-session')).toEqual([]);
    expect(graph.getBundleMembers(ids, 'image').map((node) => node.id)).toEqual(ids);
    expect(graph.getBundleMembers(ids, 'audio', 'native-session')).toEqual([]);
  });

  it('counts one preview kind across sessions for the canvas and keeps each session group for the IDE map', () => {
    const { session } = customSubs();
    touch('docs/legacy.html', session);
    touch('docs/alpha.html', session, 'sub-alpha');
    touch('docs/beta.html', session, 'sub-beta');
    const snapshot = graph.getSnapshot();
    const folder = snapshot.topFolders.find((node) => node.label === 'docs')!;
    // The snapshot ships the two most recent of the kind; the unrecorded one is reached inside the bundle.
    const pages = (snapshot.satellites[folder.id] ?? []).filter((node) => node.label.endsWith('.html'));
    expect(pages.map((node) => node.label).sort()).toEqual(['alpha.html', 'beta.html']);
    for (const node of pages) {
      expect(node.previewSessionCounts?.['']).toBe(3);
      expect(node.folderKindCount).toBe(3);
    }
    expect(graph.getBundleFiles(folder.id, 'code')?.total).toBe(3);
    expect(graph.getBundleFiles(folder.id, 'code', 'sub-alpha')?.total).toBe(1);
    expect(graph.getBundleFiles(folder.id, 'code', 'sub-beta')?.total).toBe(1);
  });

  it('keeps a shown folder\'s recent documents after idle expiry, up to the document limit', () => {
    touch('assets/nested/first.png');
    touch('assets/nested/second.png');
    touch('assets/old.md');
    touch('assets/notes.md');
    touch('assets/reports/new.log');
    const assets = graph.getSnapshot().topFolders.find((node) => node.label === 'assets')!;
    expect(graph.togglePreservePinned(assets.id)).toBe(true);
    graph.markAgentIdle('native-session');
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + BUBBLE_TTL * 2);
    const snapshot = graph.getSnapshot();
    expect(snapshot.topFolders.some((node) => node.id === assets.id)).toBe(true);
    // Documents follow the folder on screen (the limit of 2 counts documents only); expired previews leave.
    expect(snapshot.satellites[assets.id]?.map((node) => node.label).sort()).toEqual(['new.log', 'notes.md']);
  });

  it('lets a document-only folder expire together with its documents', () => {
    touch('notes/a.md');
    touch('notes/b.md');
    graph.markAgentIdle('native-session');
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + BUBBLE_TTL * 2);
    const snapshot = graph.getSnapshot();
    expect(snapshot.topFolders.some((node) => node.label === 'notes')).toBe(false);
    expect(files()).toEqual([]);
  });

  it('drops previews once their final agent owner is explicitly removed', () => {
    touch('assets/image.png');
    const owner = graph.getAgentBySession('native-session')!;
    graph.removeBubble(owner.id, { force: true });
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + BUBBLE_TTL * 2);
    expect(files()).toEqual([]);
  });
});
