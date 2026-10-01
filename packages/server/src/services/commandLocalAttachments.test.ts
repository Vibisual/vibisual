import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import type { QueuedCommand } from '@vibisual/shared';
import { findReferencedCommandAttachment } from './commandAttachmentOwnership.js';

// Importing index.ts starts the app. Compile its actual route callback instead,
// keeping files, agent creation and dispatch inert and observable in this test.
const ts = createRequire(import.meta.url)('typescript') as typeof import('typescript');
const source = fs.readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('index.ts', source, ts.ScriptTarget.ES2022, true);
let callback: string | undefined;
function find(node: import('typescript').Node): void {
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'app.post'
    && node.arguments[0] && ts.isStringLiteral(node.arguments[0])
    && node.arguments[0].text === '/api/commands/:sessionId') {
    callback = node.arguments[1]?.getText(tree);
  }
  ts.forEachChild(node, find);
}
find(tree);
if (!callback) throw new Error('Missing /api/commands/:sessionId POST handler');
const handlerCode = ts.transpileModule(`return (${callback});`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function setup(engine: 'claude' | 'codex' | 'local') {
  const agentId = 'agent-fixture';
  const sessionId = 'session-fixture';
  const subId = 'sub-fixture';
  const cwd = path.resolve('inert-command-fixture');
  const image = path.join(cwd, '.vibisual', 'attachments', sessionId, 'image.png');
  const moved = path.join(cwd, '.vibisual', 'attachments', sessionId, subId, 'image.png');
  const provider = engine === 'local' ? { kind: 'local-llama', modelId: 'test-model' }
    : engine === 'codex' ? { kind: 'codex-cli', modelId: '' } : undefined;
  const graphManager = {
    findAgentIdBySession: vi.fn(() => agentId),
    getAgentBySession: vi.fn(() => ({ id: agentId, customCreated: true })),
    getAgentConfig: vi.fn(() => ({ provider })),
    getOrchestraRootForAgent: vi.fn(() => null),
    getAgentCwd: vi.fn(() => cwd),
    recordSkillUsageFromCommandText: vi.fn(),
  };
  const subAgentManager = {
    getSub: vi.fn(() => ({ id: subId, agentId })),
    getPrimarySub: vi.fn(() => null),
    create: vi.fn(() => ({ id: subId })),
  };
  const fileOps = { existsSync: vi.fn(() => true), mkdirSync: vi.fn(), renameSync: vi.fn() };
  const commandQueues = new Map<string, QueuedCommand[]>();
  const processNextCommand = vi.fn();
  const broadcastSnapshot = vi.fn();
  const scope = {
    DEFAULT_COMMAND_DISPATCH_MODE: 'merge',
    normalizeCommandDispatchMode: () => 'merge',
    graphManager, subAgentManager, commandQueues, fs: fileOps, path,
    completedCommandArchive: new Map<string, QueuedCommand[]>(), findReferencedCommandAttachment,
    hasForeignSubAgent: () => false, isReadOnlyHookAgent: () => false,
    LOOPBACK_INGRESS_HEADER: 'test-loopback', LOOPBACK_INGRESS_VALUE: '1',
    orchestraEngineOf: () => engine,
    processNextCommand, broadcastSnapshot,
  };
  const handle = new Function(...Object.keys(scope), handlerCode)(...Object.values(scope)) as (
    req: { params: { sessionId: string }; body: unknown; query: object; get: (header: string) => undefined },
    res: { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> },
  ) => void;
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  function post(body: unknown) {
    handle({ params: { sessionId }, body, query: {}, get: () => undefined }, res);
  }
  return { post, res, image, moved, sessionId, subId, graphManager, subAgentManager, fileOps, commandQueues, processNextCommand, broadcastSnapshot };
}

describe('local image rejection precedes /api/commands side effects', () => {
  it.each([false, true])('rejects local images before session creation, attachment moves and queue mutation (existingSub=%s)', (existingSub) => {
    const h = setup('local');
    h.post({ text: 'Describe this image', attachments: [h.image], ...(existingSub ? { subAgentId: h.subId } : {}) });
    expect(h.res.status).toHaveBeenCalledExactlyOnceWith(415);
    expect(h.res.json).toHaveBeenCalledExactlyOnceWith({ error: 'local-images-unsupported' });
    expect(h.subAgentManager.create).not.toHaveBeenCalled();
    expect(h.fileOps.existsSync).not.toHaveBeenCalled();
    expect(h.fileOps.mkdirSync).not.toHaveBeenCalled();
    expect(h.fileOps.renameSync).not.toHaveBeenCalled();
    expect(h.commandQueues.size).toBe(0);
    expect(h.graphManager.recordSkillUsageFromCommandText).not.toHaveBeenCalled();
    expect(h.processNextCommand).not.toHaveBeenCalled();
    expect(h.broadcastSnapshot).not.toHaveBeenCalled();
  });

  it.each(['claude', 'codex'] as const)('keeps %s image submission on the existing accepted route', (engine) => {
    const h = setup(engine);
    h.post({ text: 'Describe this image', attachments: [h.image] });
    expect(h.res.status).not.toHaveBeenCalled();
    expect(h.subAgentManager.create).toHaveBeenCalledExactlyOnceWith('agent-fixture');
    expect(h.fileOps.renameSync).toHaveBeenCalledExactlyOnceWith(h.image, h.moved);
    const queue = h.commandQueues.get(h.sessionId);
    expect(queue).toHaveLength(1);
    expect(queue?.[0]).toMatchObject({ text: 'Describe this image', subAgentId: h.subId, attachments: [h.moved], status: 'queued' });
    expect(h.res.json).toHaveBeenCalledWith({ ok: true, command: queue?.[0] });
    expect(h.processNextCommand).toHaveBeenCalledExactlyOnceWith(h.sessionId);
  });

  it.each([{ attachments: undefined }, { attachments: [] }])('keeps local text submission on the existing accepted route ($attachments)', ({ attachments }) => {
    const h = setup('local');
    h.post({ text: 'Read the project', attachments });
    expect(h.res.status).not.toHaveBeenCalled();
    expect(h.subAgentManager.create).toHaveBeenCalledTimes(1);
    expect(h.fileOps.renameSync).not.toHaveBeenCalled();
    const queue = h.commandQueues.get(h.sessionId);
    expect(queue).toHaveLength(1);
    expect(queue?.[0]).toMatchObject({ text: 'Read the project', subAgentId: h.subId, status: 'queued' });
    expect(queue?.[0]).not.toHaveProperty('attachments');
    expect(h.processNextCommand).toHaveBeenCalledExactlyOnceWith(h.sessionId);
  });
});
