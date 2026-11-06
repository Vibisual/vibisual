import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_COMMAND_DISPATCH_MODE, normalizeAppNodeIds, normalizeCommandDispatchMode,
  type GraphSnapshot, type QueuedCommand,
} from '@vibisual/shared';
import { normalizeRunLimits } from './commandRunLimits.js';
import { normalizeExecutionRequirements } from './commandExecutionRequirements.js';
import { prioritizeImmediateFollowUp } from './immediateFollowUpQueue.js';
import { isLiveFollowUpLocked } from './liveFollowUp.js';
import { ProjectGraph } from './projectGraph.js';
import { ProjectGraphManager } from './projectGraphManager.js';
import { pathKey } from './pathKey.js';

vi.mock('./appState.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./appState.js')>();
  return { ...actual, appStateAddOpenProject: () => false };
});

// Exercise production callbacks with the real graph cache, without starting the
// HTTP server or a model process. The cache stays warm throughout each test.
const ts = createRequire(import.meta.url)('typescript') as typeof import('typescript');
const source = fs.readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('index.ts', source, ts.ScriptTarget.ES2022, true);
function extract(predicate: (node: import('typescript').Node) => boolean): import('typescript').Node {
  let match: import('typescript').Node | undefined;
  function visit(node: import('typescript').Node): void {
    if (predicate(node)) match = node;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!match) throw new Error('Missing production command route or interruption helper');
  return match;
}
function route(method: string, url: string): string {
  const node = extract((candidate) => ts.isCallExpression(candidate)
    && candidate.expression.getText(tree) === `app.${method}`
    && !!candidate.arguments[0] && ts.isStringLiteral(candidate.arguments[0])
    && candidate.arguments[0].text === url) as import('typescript').CallExpression;
  return node.arguments[1]!.getText(tree);
}
const interrupt = extract((node) => ts.isFunctionDeclaration(node)
  && node.name?.text === 'interruptForImmediateCommand').getText(tree);
const callbacks = ts.transpileModule(`
  ${interrupt}
  return {
    post: ${route('post', '/api/commands/:sessionId')},
    patch: ${route('patch', '/api/commands/:sessionId/:commandId/mode')},
    delete: ${route('delete', '/api/commands/:sessionId/:commandId')},
    pop: ${route('post', '/api/commands/:sessionId/pop')},
    reorder: ${route('put', '/api/commands/:sessionId/reorder')}
  };
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

type Reply = { status: number; body: { command?: QueuedCommand | null; [key: string]: unknown } };
type Response = { status: (code: number) => Response; json: (body: Reply['body']) => void };
type Request = { params: { sessionId: string; commandId?: string }; body: unknown; query: object; get: () => undefined };
type Handler = (req: Request, res: Response) => void;
type Method = 'post' | 'patch' | 'delete' | 'pop' | 'reorder';
const tempDirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-command-snapshot-')));
  tempDirs.push(root);
  const sessionId = 'command-snapshot-session';
  const subAgentId = 'command-snapshot-sub';
  const graph = new ProjectGraph();
  graph.registerProject(root);
  graph.processHookEvent({
    session_id: sessionId, hook_event_name: 'PostToolUse', tool_name: 'Read',
    tool_use_id: 'command-snapshot-tool', tool_input: { file_path: path.join(root, 'a.txt') }, cwd: root,
  });
  const agentId = graph.findAgentIdBySession(sessionId)!;
  const command = (id: string, status: QueuedCommand['status'] = 'queued'): QueuedCommand => ({
    id, text: id, timestamp: 1, subAgentId, status, dispatchMode: 'merge',
  });
  const running = command('running', 'executing');
  const first = command('first');
  const second = command('second');
  const queue = [running, first, second];
  const commandQueues = new Map([[sessionId, queue]]);
  graph.setCommandQueuesRef(commandQueues);
  const manager = new ProjectGraphManager();
  const state = manager as unknown as {
    instances: Map<string, ProjectGraph>;
    sessionRouting: Map<string, string>;
  };
  state.instances.set(pathKey(root), graph);
  state.sessionRouting.set(sessionId, pathKey(root));

  // Freeze the TTL, so machine speed and unrelated activity cannot hide a stale
  // snapshot. Serialize the broadcast just as the transport does, retaining no
  // mutable references to queue entries in previously delivered messages.
  vi.spyOn(Date, 'now').mockReturnValue(Date.now());
  const before = graph.getSnapshot();
  expect(graph.getSnapshot()).toBe(before);
  const snapshots: GraphSnapshot[] = [];
  const scope = {
    commandQueues, poppedCommands: new Map(), prioritizeImmediateFollowUp,
    isLiveFollowUpLocked, deliverLiveFollowUp: vi.fn(), sealHeirCutByImmediate: vi.fn(),
    settleDispatchCommand: vi.fn(), logger: { info: vi.fn(), warn: vi.fn() },
    subAgentManager: {
      getSub: () => ({ parentAgentId: agentId }),
      isSubProcessingCommand: () => true, sealHeldTurnNow: () => false,
      softInterrupt: () => true, stop: vi.fn(),
    },
    graphManager: {
      findAgentIdBySession: () => agentId,
      getAgentBySession: () => ({ customCreated: true }),
      getAgentConfig: () => ({ provider: { kind: 'codex-cli' } }),
      getOrchestraRootForAgent: () => null,
      recordSkillUsageFromCommandText: manager.recordSkillUsageFromCommandText.bind(manager),
      invalidateCommandSnapshot: manager.invalidateCommandSnapshot.bind(manager),
    },
    DEFAULT_COMMAND_DISPATCH_MODE, normalizeCommandDispatchMode, normalizeRunLimits,
    normalizeExecutionRequirements, normalizeAppNodeIds,
    hasForeignSubAgent: () => false, isReadOnlyHookAgent: () => false,
    LOOPBACK_INGRESS_HEADER: 'test-loopback', LOOPBACK_INGRESS_VALUE: '1',
    orchestraEngineOf: () => 'codex', shouldInterceptOrchestra: () => false,
    broadcastSnapshot: () => { snapshots.push(structuredClone(graph.getSnapshot())); },
    // The selected sub already has an executing command; its queue remains held
    // and cannot rely on a later dispatch to trigger another graph mutation.
    processNextCommand: vi.fn(),
  };
  const handlers = new Function(...Object.keys(scope), callbacks)(...Object.values(scope)) as Record<Method, Handler>;
  function call(method: Method, body: unknown, commandId = second.id): Reply {
    let reply: Reply | undefined;
    let status = 200;
    const res: Response = {
      status: (value) => { status = value; return res; },
      json: (result) => { reply = { status, body: result }; },
    };
    handlers[method]({ params: { sessionId, commandId }, body, query: {}, get: () => undefined }, res);
    if (!reply) throw new Error('Route did not respond');
    return reply;
  }
  const visible = () => snapshots.at(-1)?.commandQueues[agentId] ?? [];
  return { ...scope, snapshots, agentId, subAgentId, call, visible };
}

describe('command routes publish current queues while the graph snapshot cache is warm', () => {
  it.each(['merge', 'wait'] as const)('shows each successive %s follow-up in its first broadcast', (dispatchMode) => {
    const h = setup();
    const submitted: string[] = [];
    for (const text of ['Additional instruction', 'Another instruction']) {
      const reply = h.call('post', { text, dispatchMode, subAgentId: h.subAgentId });
      expect(reply.status).toBe(200);
      submitted.push(reply.body.command!.id);
      expect(h.visible().map((entry) => entry.id)).toEqual(['running', 'first', 'second', ...submitted]);
      expect(h.visible().at(-1)?.text).toBe(text);
    }
    expect(h.snapshots).toHaveLength(2);
    expect(h.snapshots[0]!.commandQueues[h.agentId]!.at(-1)?.text)
      .toBe('Additional instruction');
  });

  it('publishes the new order immediately when a queued message changes to immediate delivery', () => {
    const h = setup();
    expect(h.call('patch', { dispatchMode: 'immediate' }).status).toBe(200);
    expect(h.visible().map((entry) => entry.id)).toEqual(['running', 'second', 'first']);
    expect(h.visible()[1]?.dispatchMode).toBe('immediate');
  });

  it('removes a deleted follow-up from the first broadcast', () => {
    const h = setup();
    expect(h.call('delete', {}).status).toBe(200);
    expect(h.visible().map((entry) => entry.id)).toEqual(['running', 'first']);
  });

  it('removes a popped command from the first broadcast', () => {
    const h = setup();
    expect(h.call('pop', {}).body.command?.id).toBe('running');
    expect(h.visible().map((entry) => entry.id)).toEqual(['first', 'second']);
  });

  it('publishes reordering without waiting for another input', () => {
    const h = setup();
    expect(h.call('reorder', { fromId: 'second', toId: 'first' }).status).toBe(200);
    expect(h.visible().map((entry) => entry.id)).toEqual(['running', 'second', 'first']);
  });
});
