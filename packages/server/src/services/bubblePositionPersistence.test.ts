import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ProjectGraph } from './projectGraph.js';
import { ProjectGraphManager } from './projectGraphManager.js';
import { SaveScheduler } from './statePersistence.js';
import { enableAsyncDiskWrites, getDiskWriteQueueStats, shutdownDiskWriteQueue } from './diskWriteQueue.js';

vi.mock('./appState.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./appState.js')>(),
  appStateAddOpenProject: () => false,
}));

const ts = createRequire(import.meta.url)('typescript') as typeof import('typescript');
const source = fs.readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('index.ts', source, ts.ScriptTarget.ES2022, true);
function productionFunction(name: string): string {
  let found: import('typescript').FunctionDeclaration | undefined;
  function visit(node: import('typescript').Node): void {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!found) throw new Error(`Missing production ${name}`);
  return found.getText(tree);
}
const production = ts.transpileModule(`${productionFunction('saveCheckpoint')}
${productionFunction('handleBatchPositions')}
${productionFunction('retryCheckpointWrites')}
return { handler: handleBatchPositions, retry: retryCheckpointWrites };`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  shutdownDiskWriteQueue();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function setup() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-position-save-')));
  roots.push(root);
  const manager = new ProjectGraphManager();
  const projects = ['first', 'second', 'third'].map((name) => {
    const directory = path.join(root, name);
    fs.mkdirSync(directory);
    return manager.registerProject(directory);
  });
  const agents = projects.map((project) => manager.createCustomAgent(project.name, { x: 1, y: 2 }, project.name)!);
  const scheduler = new SaveScheduler();
  const write = vi.spyOn(scheduler, 'forceCheckpoint');
  const writeAll = vi.spyOn(scheduler, 'forceCheckpointAll');
  const broadcast = vi.fn();
  const { handler, retry } = new Function('graphManager', 'saveScheduler', 'lastSavedProjectState',
    'CHECKPOINT_QUIET_SWEEP_MS', 'pruneOrphanWorktreeDirs', 'appStateAddOpenProject', 'logger',
    'broadcastSnapshot', production)(manager, scheduler, new Map(), 10_000, () => 0,
    () => false, { info: () => undefined, warn: () => undefined, error: () => undefined }, broadcast) as { handler: (
      req: { body: unknown }, res: { status: (code: number) => unknown; json: (body: unknown) => void },
    ) => void; retry: () => void };
  const request = (positions: unknown) => {
    let status = 200;
    let body: unknown;
    const res = { status(code: number) { status = code; return res; }, json(data: unknown) { body = data; } };
    handler({ body: { positions } }, res);
    return { status, body };
  };
  return { manager, projects, agents, write, writeAll, broadcast, request, retry };
}

describe('position uploads preserve coordinates without saving unrelated projects', () => {
  it('unchanged coordinates skip checkpoint construction, persistence and broadcasts', () => {
    const state = setup();
    const checkpoint = vi.spyOn(state.manager, 'toProjectCheckpoint');
    expect(state.request(state.agents.map((agent) => ({ id: agent.id, x: 1, y: 2 })))).toEqual({ status: 200, body: { ok: true } });
    expect(checkpoint).not.toHaveBeenCalled();
    expect(state.write).not.toHaveBeenCalled();
    expect(state.writeAll).not.toHaveBeenCalled();
    expect(state.broadcast).not.toHaveBeenCalled();
  });

  it('a changed project is durable immediately; unchanged projects are untouched', () => {
    const state = setup();
    const changed = state.agents[1]!;
    expect(state.request([{ id: changed.id, x: 25, y: -40 }]).status).toBe(200);
    expect(state.write).toHaveBeenCalledTimes(1);
    expect(state.write.mock.calls[0]![0].project.name).toBe('second');
    expect(state.writeAll).not.toHaveBeenCalled();
    expect(state.broadcast).toHaveBeenCalledTimes(1);
    const savePath = path.join(state.projects[1]!.path, '.vibisual/save/checkpoint.json');
    const disk = JSON.parse(fs.readFileSync(savePath, 'utf8'));
    expect(disk.graph.agents[changed.path].position).toEqual({ x: 25, y: -40 });
    expect(fs.existsSync(path.join(state.projects[0]!.path, '.vibisual/save/checkpoint.json'))).toBe(false);
    expect(fs.existsSync(path.join(state.projects[2]!.path, '.vibisual/save/checkpoint.json'))).toBe(false);
    state.request([{ id: changed.id, x: 25, y: -40 }]);
    expect(state.write).toHaveBeenCalledTimes(1);
  });

  it('a multi-project upload persists each changed project, including its satellite coordinates', () => {
    const state = setup();
    const [first, second] = state.agents;
    state.request([{ id: first!.id, x: 4, y: 5 }, { id: `sat-${second!.id}`, x: 6, y: 7 }]);
    expect(state.writeAll).toHaveBeenCalledTimes(1);
    expect(state.writeAll.mock.calls[0]![0].map((cp) => cp.project.name)).toEqual(['first', 'second']);
    const secondDisk = JSON.parse(fs.readFileSync(path.join(state.projects[1]!.path, '.vibisual/save/checkpoint.json'), 'utf8'));
    expect(secondDisk.satellitePositions[`sat-${second!.id}`]).toEqual({ x: 6, y: 7 });
    state.request([{ id: `sat-${second!.id}`, x: 6, y: 7 }]);
    expect(state.writeAll).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed batch before any partial mutation or write', () => {
    const state = setup();
    expect(state.request([{ id: state.agents[0]!.id, x: 3, y: 4 }, { id: 'bad', x: Infinity, y: 0 }]).status).toBe(400);
    expect(state.agents[0]!.position).toEqual({ x: 1, y: 2 });
    expect(state.write).not.toHaveBeenCalled();
  });

  it('retries a failed save even when the next upload has identical coordinates', () => {
    const state = setup();
    const agent = state.agents[1]!;
    const target = path.join(state.projects[1]!.path, '.vibisual/save/checkpoint.json');
    const rename = fs.renameSync;
    let fail = true;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (fail && to === target) { fail = false; throw new Error('temporary disk failure'); }
      rename(from, to);
    });
    const positions = [{ id: agent.id, x: 50, y: 60 }];
    state.request(positions);
    expect(fs.existsSync(target)).toBe(false);
    state.request(positions);
    expect(state.write).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fs.readFileSync(target, 'utf8')).graph.agents[agent.path].position).toEqual({ x: 50, y: 60 });
    state.request(positions);
    expect(state.write).toHaveBeenCalledTimes(2);
  });

  it('the periodic retry persists a failed save with no subsequent position upload', () => {
    const state = setup();
    const agent = state.agents[1]!;
    const target = path.join(state.projects[1]!.path, '.vibisual/save/checkpoint.json');
    const rename = fs.renameSync;
    let fail = true;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (fail && to === target) { fail = false; throw new Error('temporary disk failure'); }
      rename(from, to);
    });
    state.request([{ id: agent.id, x: 8, y: 9 }]);
    expect(fs.existsSync(target)).toBe(false);
    state.retry();
    expect(JSON.parse(fs.readFileSync(target, 'utf8')).graph.agents[agent.path].position).toEqual({ x: 8, y: 9 });
    expect(state.write).toHaveBeenCalledTimes(2);
    state.retry();
    expect(state.write).toHaveBeenCalledTimes(2);
  });

  it('a transient serialization exception does not escape the periodic sweep or erase its retry', () => {
    const state = setup();
    const agent = state.agents[1]!;
    const target = path.join(state.projects[1]!.path, '.vibisual/save/checkpoint.json');
    const json = { toJSON() { throw new Error('temporary serialization failure'); } };
    Object.assign(agent, { extra: json });
    expect(state.request([{ id: agent.id, x: 8, y: 9 }]).status).toBe(500);
    expect(() => state.retry()).not.toThrow();
    expect(fs.existsSync(target)).toBe(false);
    delete (agent as unknown as { extra?: unknown }).extra;
    state.retry();
    expect(JSON.parse(fs.readFileSync(target, 'utf8')).graph.agents[agent.path].position).toEqual({ x: 8, y: 9 });
  });

  it('the periodic retry also recovers a queued worker write after the canvas is quiet', async () => {
    const state = setup();
    const agent = state.agents[1]!;
    const target = path.join(state.projects[1]!.path, '.vibisual/save/checkpoint.json');
    fs.mkdirSync(target, { recursive: true });
    const priorFailed = getDiskWriteQueueStats().failed;
    enableAsyncDiskWrites();
    state.request([{ id: agent.id, x: 11, y: 12 }]);
    const until = async (condition: () => boolean) => {
      const deadline = Date.now() + 3000;
      while (!condition() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
      expect(condition()).toBe(true);
    };
    await until(() => getDiskWriteQueueStats().failed > priorFailed);
    fs.rmdirSync(target);
    state.retry();
    await until(() => fs.existsSync(target));
    expect(JSON.parse(fs.readFileSync(target, 'utf8')).graph.agents[agent.path].position).toEqual({ x: 11, y: 12 });
    expect(state.write).toHaveBeenCalledTimes(1);
  });
});

describe('position changes invalidate snapshots only when their final value changes', () => {
  it('updates a warm snapshot in the same tick and detects duplicate-id no-ops', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Position', { x: 1, y: 2 });
    const before = graph.getSnapshot();
    const version = graph.getMutationVersion();
    expect(graph.updateBubblePositionsBatch([{ id: agent.id, x: 99, y: 99 }, { id: agent.id, x: 1, y: 2 }])).toBe(false);
    expect(graph.getMutationVersion()).toBe(version);
    expect(graph.getSnapshot()).toBe(before);
    expect(graph.updateBubblePositionsBatch([{ id: agent.id, x: 3, y: 4 }])).toBe(true);
    expect(graph.getMutationVersion()).toBe(version + 1);
    expect(graph.getSnapshot().agents.find((item) => item.id === agent.id)?.position).toEqual({ x: 3, y: 4 });
  });

  it('trashed and unknown bubbles cannot trigger writes or lose their retained positions', () => {
    const graph = new ProjectGraph();
    const agent = graph.createCustomAgent('Trash', { x: 1, y: 2 });
    graph.trashCustomAgentByBubbleId(agent.id);
    expect(graph.updateBubblePositionsBatch([{ id: agent.id, x: 5, y: 6 }, { id: 'unknown', x: 0, y: 0 }])).toBe(false);
    expect(agent.position).toEqual({ x: 1, y: 2 });
  });
});
