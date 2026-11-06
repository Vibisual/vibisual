import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bundleSatelliteKey, isKindBundleKind, SATELLITE_MAX_BOUNDS, type BubbleData } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { ProjectGraphManager } from './projectGraphManager.js';
import { sanitizeAgentLinkRecords } from './agentLinkRecord.js';
import { pathKey } from './pathKey.js';

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function setup(): { graph: ProjectGraph; root: string; name: string } {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-bundle-max-')));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'media'));
  const file = path.join(root, 'media', 'one.png');
  fs.writeFileSync(file, 'image');
  const graph = new ProjectGraph();
  graph.registerProject(root);
  graph.processHookEvent({
    session_id: 'session-one', hook_event_name: 'PostToolUse', tool_name: 'Read',
    tool_use_id: 'image-read', tool_input: { file_path: file }, cwd: root,
  });
  return { graph, root, name: path.basename(root) };
}

function folder(graph: ProjectGraph, name: string): BubbleData {
  const snapshot = graph.getSnapshot();
  const node = [...snapshot.topFolders, ...Object.values(snapshot.children).flat()]
    .find((entry) => entry.label === name);
  if (!node) throw new Error(`Missing folder ${name}`);
  return node;
}

describe('bundle satellite settings', () => {
  it('keeps each session and kind independent from the document limit and invalidates snapshots', () => {
    const { graph } = setup();
    graph.setFolderMaxSatellites('media', 1);
    const before = graph.getMutationVersion();
    graph.getSnapshot();
    expect(graph.setFolderMaxSatellites('media', 7, 'image', 'session-one')).toBe(true);
    expect(graph.setFolderMaxSatellites('media', 3, 'image', 'session-two')).toBe(true);
    expect(graph.setFolderMaxSatellites('media', 4, 'audio', 'session-one')).toBe(true);
    expect(graph.getMutationVersion()).toBeGreaterThan(before);
    expect(folder(graph, 'media')).toMatchObject({
      maxSatellites: 1,
      bundleMaxSatellites: { 'image:session-one': 7, 'image:session-two': 3, 'audio:session-one': 4 },
    });
  });

  it('round trips folder and root bundle limits through restore and merge', () => {
    const { graph, name } = setup();
    graph.setFolderMaxSatellites('media', 90, 'image', 'session-one');
    graph.setFolderMaxSatellites('', 0, 'doc', 'session-one');
    const cp = JSON.parse(JSON.stringify(graph.toProjectCheckpoint(name))) as ReturnType<ProjectGraph['toProjectCheckpoint']>;
    for (const mode of ['restoreFromCheckpoint', 'mergeFromCheckpoint'] as const) {
      const loaded = new ProjectGraph();
      loaded[mode](cp);
      expect(folder(loaded, 'media').bundleMaxSatellites?.[bundleSatelliteKey('image', 'session-one')])
        .toBe(SATELLITE_MAX_BOUNDS.MAX);
      expect(folder(loaded, name).bundleMaxSatellites?.[bundleSatelliteKey('doc', 'session-one')])
        .toBe(SATELLITE_MAX_BOUNDS.MIN);
    }
    expect(graph.setFolderMaxSatellites('media', Number.NaN, 'image')).toBe(false);
  });

  it('routes matching relative folders and root settings to the specified project', () => {
    const a = setup();
    const b = setup();
    const manager = new ProjectGraphManager();
    const state = manager as unknown as { instances: Map<string, ProjectGraph> };
    state.instances.set(pathKey(a.root), a.graph);
    state.instances.set(pathKey(b.root), b.graph);
    expect(manager.setFolderMaxSatellites('media', 6, 'image', 'session-one', b.root)).toBe(true);
    expect(manager.setFolderMaxSatellites('', 5, 'doc', 'session-one', b.root)).toBe(true);
    expect(folder(a.graph, 'media').bundleMaxSatellites).toBeUndefined();
    expect(folder(b.graph, 'media').bundleMaxSatellites?.['image:session-one']).toBe(6);
    expect(folder(b.graph, b.name).bundleMaxSatellites?.['doc:session-one']).toBe(5);
    expect(manager.setFolderMaxSatellites('', 5, 'doc', 'session-one')).toBe(false);
    expect(manager.setFolderMaxSatellites('media', 9, 'image', 'session-one', path.join(os.tmpdir(), 'missing-preview-project'))).toBe(false);
    expect(folder(a.graph, 'media').bundleMaxSatellites).toBeUndefined();
  });

  it('preserves bundle settings in saved link records', () => {
    const records = sanitizeAgentLinkRecords({ owner: { at: 1, entries: [{
      key: 'media', bubbleType: 'internal_folder', bundleMaxSatellites: { 'image:session-one': 4, bad: 'not a number' },
    }] } });
    expect(records.get('owner')?.entries[0]?.bundleMaxSatellites).toEqual({ 'image:session-one': 4 });
  });

  it('resolves an unloaded folder by exact path within the selected project', () => {
    const a = setup();
    const b = setup();
    const manager = new ProjectGraphManager();
    (manager as unknown as { instances: Map<string, ProjectGraph> }).instances.set(pathKey(a.root), a.graph);
    (manager as unknown as { instances: Map<string, ProjectGraph> }).instances.set(pathKey(b.root), b.graph);
    const page = manager.getBundleFiles('', 'image', 'session-one', 0, b.root, path.join(b.root, 'media'));
    expect(page?.total).toBe(1);
    expect(pathKey(page!.items[0]!.absolutePath!)).toBe(pathKey(path.join(b.root, 'media', 'one.png')));
    expect(manager.getBundleFiles('', 'image', 'session-one', 0, a.root, path.join(b.root, 'media'))).toBeNull();
    expect(manager.getBundleFiles('', 'image', 'session-one', 0, b.root, path.join(b.root, 'missing'))).toBeNull();
  });

  it('merges missing bundle limits without replacing the current session setting', () => {
    const { graph, name } = setup();
    graph.setFolderMaxSatellites('media', 4, 'image', 'session-one');
    graph.setFolderMaxSatellites('media', 3, 'audio', 'session-one');
    const cp = JSON.parse(JSON.stringify(graph.toProjectCheckpoint(name))) as ReturnType<ProjectGraph['toProjectCheckpoint']>;
    graph.setFolderMaxSatellites('media', 6, 'image', 'session-one');
    graph.mergeFromCheckpoint(cp);
    expect(folder(graph, 'media').bundleMaxSatellites).toEqual({ 'image:session-one': 6, 'audio:session-one': 3 });
  });

  it('persists session satellite positions and removes the underlying file by its display id', () => {
    const { graph, name } = setup();
    const node = Object.values(graph.getSnapshot().satellites).flat().find((item) => item.label === 'one.png')!;
    const id = `sat-${node.id}:preview-session:session-one`;
    graph.updateBubblePositionsBatch([{ id, x: 44, y: 55 }]);
    const cp = JSON.parse(JSON.stringify(graph.toProjectCheckpoint(name))) as ReturnType<ProjectGraph['toProjectCheckpoint']>;
    expect(cp.satellitePositions?.[id]).toEqual({ x: 44, y: 55 });
    const loaded = new ProjectGraph();
    loaded.restoreFromCheckpoint(cp);
    expect(loaded.getSnapshot().satellitePositions?.[id]).toEqual({ x: 44, y: 55 });
    loaded.removeBubble(id);
    expect(Object.values(loaded.getSnapshot().satellites).flat().some((item) => item.id === node.id)).toBe(false);
  });
});

const ts = createRequire(import.meta.url)('typescript') as typeof import('typescript');
const source = fs.readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('index.ts', source, ts.ScriptTarget.ES2022, true);
let handlerSource = '';
let pageHandlerSource = '';
let membersHandlerSource = '';
function visit(node: import('typescript').Node): void {
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'app.post'
    && node.arguments[0] && ts.isStringLiteral(node.arguments[0])
    && node.arguments[0].text === '/api/satellite/max') handlerSource = node.arguments[1]!.getText(tree);
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'app.post'
    && node.arguments[0] && ts.isStringLiteral(node.arguments[0])
    && node.arguments[0].text === '/api/bundle-files') membersHandlerSource = node.arguments[1]!.getText(tree);
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'app.get'
    && node.arguments[0] && ts.isStringLiteral(node.arguments[0])
    && node.arguments[0].text === '/api/bundle-files') pageHandlerSource = node.arguments[1]!.getText(tree);
  ts.forEachChild(node, visit);
}
visit(tree);

it('validates bundle targets before saving and broadcasts accepted changes', () => {
  const graphManager = { setFolderMaxSatellites: vi.fn(() => true), getBroadcastSnapshot: vi.fn(() => ({})) };
  const broadcast = vi.fn();
  const save = vi.fn();
  const code = ts.transpileModule(`return (${handlerSource});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  type Response = { status: (code: number) => Response; json: (value: unknown) => void };
  const handler = new Function('graphManager', 'broadcast', 'saveCheckpoint', 'logger', 'isKindBundleKind', code)(
    graphManager, broadcast, save, { error: vi.fn() }, isKindBundleKind,
  ) as (req: { body: unknown }, res: Response) => void;
  const json = vi.fn();
  const res: Response = { status: vi.fn(() => res), json };
  for (const extra of [{ kind: 'file' }, { kind: 'image', sessionId: 7 }, { sessionId: 's' }, { absolutePath: false }]) {
    handler({ body: { folderPath: 'media', max: 3, ...extra } }, res);
    expect(res.status).toHaveBeenLastCalledWith(400);
  }
  expect(save).not.toHaveBeenCalled();
  handler({ body: { folderPath: 'media', max: 3, kind: 'image', sessionId: 's', absolutePath: '/project' } }, res);
  expect(graphManager.setFolderMaxSatellites).toHaveBeenCalledWith('media', 3, 'image', 's', '/project');
  expect(save).toHaveBeenCalledOnce();
  expect(broadcast).toHaveBeenCalledOnce();
  expect(json).toHaveBeenLastCalledWith({ ok: true });
});

it('validates bundle page requests and forwards the exact session and project scope', () => {
  const result = { items: [], total: 240, page: 1 };
  const graphManager = { getBundleFiles: vi.fn(() => result) };
  const code = ts.transpileModule(`return (${pageHandlerSource});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  type Response = { status: (code: number) => Response; json: (value: unknown) => void };
  const handler = new Function('graphManager', 'logger', 'isKindBundleKind', code)(
    graphManager, { error: vi.fn() }, isKindBundleKind,
  ) as (req: { query: unknown }, res: Response) => void;
  const json = vi.fn();
  const res: Response = { status: vi.fn(() => res), json };
  for (const extra of [{ kind: 'file' }, { page: '-1' }, { page: '1.2' }, { page: ['1', '2'] }, { sessionId: '' }, { folderAbsolutePath: '/project/media' }]) {
    handler({ query: { folderId: 'folder', kind: 'image', ...extra } }, res);
    expect(res.status).toHaveBeenLastCalledWith(400);
  }
  expect(graphManager.getBundleFiles).not.toHaveBeenCalled();
  handler({ query: { folderId: 'folder', kind: 'image', sessionId: 's', page: '1', absolutePath: '/project' } }, res);
  expect(graphManager.getBundleFiles).toHaveBeenCalledWith('folder', 'image', 's', 1, '/project', undefined);
  expect(json).toHaveBeenLastCalledWith(result);
  handler({ query: { folderId: '', kind: 'image', sessionId: 's', absolutePath: '/project', folderAbsolutePath: '/project/deep/media' } }, res);
  expect(graphManager.getBundleFiles).toHaveBeenCalledWith('', 'image', 's', 0, '/project', '/project/deep/media');
});

it('bounds exact bundle member reads and forwards session ownership without saving', () => {
  const graphManager = { getBundleMembers: vi.fn(() => [{ id: 'frame-a' }]) };
  const code = ts.transpileModule(`return (${membersHandlerSource});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  type Response = { status: (code: number) => Response; json: (value: unknown) => void };
  const handler = new Function('graphManager', 'logger', 'isKindBundleKind', 'BUNDLE_BUBBLE', code)(
    graphManager, { error: vi.fn() }, isKindBundleKind, { interiorMax: 120 },
  ) as (req: { body: unknown }, res: Response) => void;
  const json = vi.fn();
  const res: Response = { status: vi.fn(() => res), json };
  for (const body of [null, { ids: [''], kind: 'image' }, { ids: Array(121).fill('frame'), kind: 'image' },
    { ids: ['frame'], kind: 'image', sessionId: '' }, { ids: ['frame'], kind: 'file' }]) {
    handler({ body }, res);
    expect(res.status).toHaveBeenLastCalledWith(400);
  }
  expect(graphManager.getBundleMembers).not.toHaveBeenCalled();
  handler({ body: { ids: ['frame-a'], kind: 'image', sessionId: 's', absolutePath: '/project' } }, res);
  expect(graphManager.getBundleMembers).toHaveBeenCalledWith(['frame-a'], 'image', 's', '/project');
  expect(json).toHaveBeenLastCalledWith({ items: [{ id: 'frame-a' }] });
});
