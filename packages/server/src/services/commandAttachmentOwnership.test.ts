import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueuedCommand } from '@vibisual/shared';
import { findReferencedCommandAttachment } from './commandAttachmentOwnership.js';

// Execute the actual production callbacks without booting index.ts or a model.
const ts = createRequire(import.meta.url)('typescript') as typeof import('typescript');
const source = fs.readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('index.ts', source, ts.ScriptTarget.ES2022, true);
function route(method: string, url: string): string {
  let callback: string | undefined;
  function find(node: import('typescript').Node): void {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === `app.${method}`
      && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === url) {
      callback = node.arguments[1]?.getText(tree);
    }
    ts.forEachChild(node, find);
  }
  find(tree);
  if (!callback) throw new Error(`Missing ${method} ${url}`);
  return ts.transpileModule(`return (${callback});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}
const postCode = route('post', '/api/commands/:sessionId');
const deleteCode = route('delete', '/api/agent-attachments/:sessionId');
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-attachment-ownership-')); });
afterEach(() => {
  vi.restoreAllMocks();
  const resolved = path.resolve(root);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('vibi-attachment-ownership-')) {
    throw new Error('Unsafe test cleanup');
  }
  fs.rmSync(resolved, { recursive: true, force: true });
});

function setup() {
  const sessionId = 'session-fixture';
  const dir = path.join(root, '.vibisual', 'attachments', sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const image = path.join(dir, '70fcb730-31ea-43fb-9c58-3e7c781d374a.png');
  fs.writeFileSync(image, 'user image');
  const commandQueues = new Map<string, QueuedCommand[]>();
  const completedCommandArchive = new Map<string, QueuedCommand[]>();
  const scope = {
    fs, path, commandQueues, completedCommandArchive, findReferencedCommandAttachment,
    logger: { warn: vi.fn() },
    graphManager: {
      getAgentCwd: () => root, findAgentIdBySession: () => 'agent-fixture',
      getAgentBySession: () => ({ customCreated: true }), getAgentConfig: () => ({}),
      getOrchestraRootForAgent: () => null, recordSkillUsageFromCommandText: vi.fn(),
    },
    subAgentManager: { getSub: () => ({ agentId: 'agent-fixture' }) },
    DEFAULT_COMMAND_DISPATCH_MODE: 'merge', normalizeCommandDispatchMode: () => 'merge',
    hasForeignSubAgent: () => false, isReadOnlyHookAgent: () => false,
    LOOPBACK_INGRESS_HEADER: 'test-loopback', LOOPBACK_INGRESS_VALUE: '1', orchestraEngineOf: () => 'claude',
    broadcastSnapshot: vi.fn(), processNextCommand: vi.fn(),
  };
  type Reply = { status: number; body: Record<string, unknown> };
  type Response = { status: (code: number) => Response; json: (body: Record<string, unknown>) => void };
  type Request = { params: { sessionId: string }; body: unknown; query: object; get: () => undefined };
  function call(code: string, body: unknown): Promise<Reply> {
    const handle = new Function(...Object.keys(scope), code)(...Object.values(scope)) as (req: Request, res: Response) => void;
    return new Promise((resolve) => {
      let status = 200;
      const res: Response = { status: (value) => { status = value; return res; }, json: (result) => resolve({ status, body: result }) };
      handle({ params: { sessionId }, body, query: {}, get: () => undefined }, res);
    });
  }
  const post = (file = image, subAgentId = 'sub-first') => call(postCode, { text: 'Describe image', subAgentId, attachments: [file] });
  const remove = (file = image) => call(deleteCode, { filePath: file });
  const queued = () => commandQueues.get(sessionId) ?? [];
  function complete(): void {
    completedCommandArchive.set(sessionId, queued().map((command) => ({ ...command, status: 'completed' })));
    commandQueues.delete(sessionId);
  }
  return { sessionId, dir, image, commandQueues, completedCommandArchive, post, remove, queued, complete };
}

describe('submitted images survive response loss and draft cleanup', () => {
  it('still deletes an unsubmitted draft image', async () => {
    const h = setup();
    expect((await h.remove()).status).toBe(200);
    expect(fs.existsSync(h.image)).toBe(false);
    expect((await h.remove()).status).toBe(200); // Already removed is still idempotent.
  });

  it('reports a failed draft unlink without pretending the image was removed', async () => {
    const h = setup();
    vi.spyOn(fs, 'unlinkSync').mockImplementationOnce(() => { throw Object.assign(new Error('EACCES injected'), { code: 'EACCES' }); });
    expect(await h.remove()).toEqual({ status: 500, body: { error: 'unlink failed' } });
    expect(fs.existsSync(h.image)).toBe(true);
  });

  it.each(['queued', 'executing', 'completed'] as const)('preserves the original path owned by a %s command after move failure', async (status) => {
    const h = setup();
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('EACCES injected'); });
    await h.post();
    expect(h.queued()[0]?.attachments).toEqual([h.image]);
    if (status === 'completed') h.complete();
    else h.queued()[0]!.status = status;
    const reply = await h.remove();
    expect(reply).toEqual({ status: 200, body: { ok: true, retained: true } });
    expect(fs.readFileSync(h.image, 'utf8')).toBe('user image');
  });

  it.each([false, true])('recovers a moved upload on retry without breaking its earlier command (completed=%s)', async (completed) => {
    const h = setup();
    await h.post(); // Reply is deliberately discarded, as with transport loss.
    const first = h.queued()[0]!;
    const moved = first.attachments![0]!;
    expect(fs.existsSync(h.image)).toBe(false);
    if (completed) h.complete();
    const retry = await h.post(h.image, 'sub-second');
    expect(retry.status).toBe(200);
    expect(h.queued().at(-1)?.attachments).toEqual([moved]);
    expect(first.attachments).toEqual([moved]);
    expect(fs.readFileSync(moved, 'utf8')).toBe('user image');
    expect(await h.remove(moved)).toEqual({ status: 200, body: { ok: true, retained: true } });
    expect(fs.existsSync(moved)).toBe(true);
  });

  it('does not move a referenced subfolder image again when retrying in another tab', async () => {
    const h = setup();
    await h.post();
    const moved = h.queued()[0]!.attachments![0]!;
    await h.post(moved, 'sub-second');
    expect(h.queued()[1]?.attachments).toEqual([moved]);
    expect(fs.existsSync(moved)).toBe(true);
    expect(fs.existsSync(path.join(h.dir, 'sub-second', path.basename(moved)))).toBe(false);
  });

  it('does not move a referenced original image again after the first rename failed', async () => {
    const h = setup();
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('EACCES injected'); });
    await h.post();
    await h.post(h.image, 'sub-second');
    expect(h.queued().map((command) => command.attachments)).toEqual([[h.image], [h.image]]);
    expect(fs.existsSync(h.image)).toBe(true);
  });

  it('does not recover images from another session or from outside this attachment directory', async () => {
    const h = setup();
    await h.post();
    const first = h.queued()[0]!;
    h.commandQueues.delete(h.sessionId);
    h.commandQueues.set('other-session', [first]);
    await h.post(h.image, 'sub-second');
    expect(h.queued()[0]?.attachments).toBeUndefined();
    const outside = path.join(root, 'outside.png');
    fs.writeFileSync(outside, 'outside');
    expect((await h.remove(outside)).status).toBe(403);
    expect(fs.existsSync(outside)).toBe(true);
  });

  it('does not guess when an original upload matches conflicting command paths', () => {
    const h = setup();
    const first = path.join(h.dir, 'sub-first', path.basename(h.image));
    const second = path.join(h.dir, 'sub-second', path.basename(h.image));
    expect(findReferencedCommandAttachment(h.image, h.dir, [{ attachments: [first, second] }], true)).toBeUndefined();
    expect(findReferencedCommandAttachment(h.image, h.dir, [{ attachments: [first, first] }], true)).toBe(first);
  });
});
