import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalTurnArgs } from './localRunner.js';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  candidates: vi.fn(),
  findModel: vi.fn(),
  output: vi.fn(),
  architecture: vi.fn(),
  terminate: vi.fn(),
}));

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('node:net', () => ({
  default: {
    createServer: () => {
      const server = new EventEmitter();
      return Object.assign(server, {
        listen() { queueMicrotask(() => server.emit('listening')); },
        close(done: () => void) { done(); },
      });
    },
  },
}));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./localEngineService.js', () => ({
  getEngineCandidates: mocks.candidates,
  getEngineState: () => ({ build: 'test-build' }),
  truncatedImages: () => [],
}));
vi.mock('./localArchService.js', () => ({
  readLocalArchitecture: () => 'test-family',
  readLocalGgufMeta: () => ({}),
  recordArchVerdict: mocks.architecture,
}));
vi.mock('./localModelService.js', () => ({ findModel: mocks.findModel, recordOutputCheck: mocks.output }));
vi.mock('./localTools.js', () => ({
  clipToolResult: (value: string) => value,
  runLocalTool: vi.fn(),
  summarizeToolInput: () => '',
}));
vi.mock('./processTree.js', () => ({ processGroupSpawnOptions: () => ({}), terminateChildTree: mocks.terminate }));

import {
  isLocalTurnRunning, listLoadedModels, loadedModelContext,
  runLocalTurn, stopLocalTurn, unloadAllLocalModels, verifyModelOutput,
} from './localRunner.js';

interface FakeChild extends EventEmitter {
  pid: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  stdout: PassThrough;
  stderr: PassThrough;
  bin: string;
  args: string[];
}

let home: string;
const children: FakeChild[] = [];
const turns: string[] = [];
const fetchMock = vi.fn<typeof fetch>();

function makeChild(bin: string, args: string[]): FakeChild {
  const child = Object.assign(new EventEmitter(), {
    pid: children.length + 100,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    stdout: new PassThrough(), stderr: new PassThrough(), bin, args,
  });
  children.push(child);
  return child;
}

function exitChild(child: FakeChild, code: number): void {
  child.exitCode = code;
  child.emit('exit', code, null);
  child.emit('close', code, null);
}

function successfulChat(): Response {
  return Response.json({ choices: [{ message: { content: 'Two plus three is five.' } }] });
}

function successfulStream(): Response {
  return new Response('data: {"choices":[{"delta":{"content":"The answer is five."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
    headers: { 'content-type': 'text/event-stream' },
  });
}

function defaultResponse(input: string | URL | Request, init?: RequestInit): Response {
  const url = String(input);
  if (url.endsWith('/props')) return Response.json({});
  if (url.endsWith('/v1/chat/completions')) {
    const body = JSON.parse(String(init?.body ?? '{}')) as { stream?: boolean };
    return body.stream ? successfulStream() : successfulChat();
  }
  return new Response(null, { status: 200 });
}

function startTurn(subAgentId: string, modelId: string, contextSize = 4096): {
  done: ReturnType<typeof vi.fn>;
  finished: Promise<void>;
} {
  turns.push(subAgentId);
  let resolve: () => void = () => undefined;
  const finished = new Promise<void>((done) => { resolve = done; });
  const done = vi.fn<LocalTurnArgs['onDone']>(() => resolve());
  runLocalTurn({ subAgentId, modelId, contextSize, prompt: 'What is 2 plus 3?', onEvent: vi.fn(), onDone: done });
  return { done, finished };
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-local-loading-'));
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  children.length = 0;
  turns.length = 0;
  mocks.spawn.mockReset().mockImplementation((bin: string, args: string[]) => makeChild(bin, args));
  mocks.candidates.mockReset().mockReturnValue([{ backend: 'cpu', serverBin: '/engine/cpu/llama-server' }]);
  mocks.findModel.mockReset().mockImplementation((id: string) => ({
    id, name: id, path: path.join(home, `${id}.gguf`), sizeBytes: 64, downloadedAt: 1,
  }));
  mocks.output.mockReset();
  mocks.architecture.mockReset();
  mocks.terminate.mockReset().mockImplementation((child: FakeChild) => {
    if (child.exitCode === null) exitChild(child, 0);
  });
  fetchMock.mockReset().mockImplementation(async (input, init) => defaultResponse(input, init));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  for (const sub of turns) stopLocalTurn(sub);
  await vi.waitFor(() => expect(turns.some(isLocalTurnRunning)).toBe(false));
  unloadAllLocalModels();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('local model loading — 실제 공개 진입점의 자원 소유권', () => {
  it('두 버블이 같은 모델을 동시에 준비해도 프로세스는 한 번만 띄운다', async () => {
    let release: (response: Response) => void = () => undefined;
    const health = new Promise<Response>((resolve) => { release = resolve; });
    fetchMock.mockImplementation(async (input, init) => String(input).endsWith('/health') ? health : defaultResponse(input, init));
    const first = verifyModelOutput('shared-model');
    const second = verifyModelOutput('shared-model');
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
    release(new Response(null));
    expect(await Promise.all([first, second])).toEqual(['ok', 'ok']);
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(listLoadedModels()).toEqual(['shared-model']);
  });

  it('사용 중인 모델은 다른 모델 요청이 빼앗지 않고 취소된 대기자는 뒤에 살아나지 않는다', async () => {
    let release: (response: Response) => void = () => undefined;
    const heldChat = new Promise<Response>((resolve) => { release = resolve; });
    let firstChat = true;
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).endsWith('/v1/chat/completions') && firstChat) { firstChat = false; return heldChat; }
      return defaultResponse(input, init);
    });
    const active = verifyModelOutput('active-model');
    await vi.waitFor(() => expect(firstChat).toBe(false));
    const waiting = startTurn('waiting-sub', 'next-model');
    const canceled = startTurn('canceled-sub', 'canceled-model');
    expect(stopLocalTurn('canceled-sub')).toBe(true);
    await canceled.finished;
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.terminate).not.toHaveBeenCalled();
    release(successfulChat());
    expect(await active).toBe('ok');
    await waiting.finished;
    expect(waiting.done.mock.calls[0]?.[0]).toBeUndefined();
    expect(children.map((child) => child.args[child.args.indexOf('-m') + 1])).toEqual([
      path.join(home, 'active-model.gguf'), path.join(home, 'next-model.gguf'),
    ]);
    expect(listLoadedModels()).toEqual(['next-model']);
  });

  it('GPU 실행본 실패 시 설치된 CPU 실행본으로 전환한다', async () => {
    mocks.candidates.mockReturnValue([
      { backend: 'vulkan', serverBin: '/engine/vulkan/llama-server' },
      { backend: 'cpu', serverBin: '/engine/cpu/llama-server' },
    ]);
    mocks.spawn.mockImplementation((bin: string, args: string[]) => {
      const child = makeChild(bin, args);
      if (bin.includes('vulkan')) child.exitCode = 1;
      return child;
    });
    expect(await verifyModelOutput('model')).toBe('ok');
    expect(children.map((child) => child.bin)).toEqual([
      '/engine/vulkan/llama-server', '/engine/vulkan/llama-server', '/engine/cpu/llama-server',
    ]);
    const cpu = children.at(-1);
    expect(cpu?.args[cpu.args.indexOf('-ngl') + 1]).toBe('0');
  });

  it('spawn ENOENT는 앱 오류 이벤트로 탈출하지 않고 준비 실패로 끝난다', async () => {
    mocks.spawn.mockImplementation((bin: string, args: string[]) => {
      const child = makeChild(bin, args);
      queueMicrotask(() => child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })));
      return child;
    });
    fetchMock.mockImplementation(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) { reject(signal.reason); return; }
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    expect(await verifyModelOutput('model')).toBe('skipped');
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(listLoadedModels()).toEqual([]);
    expect(mocks.output).not.toHaveBeenCalled();
    expect(mocks.architecture).not.toHaveBeenCalled();
  });

  it('로딩 중 전체 종료는 준비 중인 자식을 정리하고 줄 선 모델을 뒤늦게 띄우지 않는다', async () => {
    fetchMock.mockImplementation(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) { reject(signal.reason); return; }
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const preparing = verifyModelOutput('preparing-model');
    const queued = verifyModelOutput('queued-model');
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
    unloadAllLocalModels();
    expect(await Promise.all([preparing, queued])).toEqual(['skipped', 'skipped']);
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.terminate).toHaveBeenCalledWith(children[0]);
    expect(children[0]?.exitCode).toBe(0);
    expect(listLoadedModels()).toEqual([]);
    expect(mocks.output).not.toHaveBeenCalled();
    // 취소된 세대는 끝나고, 이후 사용자가 새로 요청한 모델은 다시 준비할 수 있다.
    fetchMock.mockImplementation(async (input, init) => defaultResponse(input, init));
    expect(await verifyModelOutput('fresh-model')).toBe('ok');
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    expect(listLoadedModels()).toEqual(['fresh-model']);
  });

  it('CPU 메모리가 부족하면 문맥을 반으로 줄여 다시 띄우고 실제 크기를 공개한다', async () => {
    mocks.spawn.mockImplementation((bin: string, args: string[]) => {
      const child = makeChild(bin, args);
      if (children.length === 1) {
        queueMicrotask(() => {
          child.stderr.emit('data', Buffer.from('failed to allocate KV cache: out of memory'));
          exitChild(child, 1);
        });
      }
      return child;
    });
    const turn = startTurn('oom-context', 'model', 8192);
    await turn.finished;
    expect(turn.done.mock.calls[0]?.[0]).toBeUndefined();
    expect(children.map((child) => child.args[child.args.indexOf('-c') + 1])).toEqual(['8192', '4096']);
    expect(children.every((child) => child.bin === '/engine/cpu/llama-server')).toBe(true);
    expect(loadedModelContext('model')).toBe(4096);
  });

  it('같은 모델의 문맥 설정을 바꾸면 다음 턴부터 새 크기로 다시 띄운다', async () => {
    const first = startTurn('context-first', 'model', 4096);
    await first.finished;
    const second = startTurn('context-second', 'model', 8192);
    await second.finished;
    expect(children.map((child) => child.args[child.args.indexOf('-c') + 1])).toEqual(['4096', '8192']);
    expect(loadedModelContext('model')).toBe(8192);
    expect(mocks.terminate).toHaveBeenCalledOnce();
  });

  it('출력이 깨진 한 모델은 파일에만 기록하고 같은 구조의 모든 모델을 차단하지 않는다', async () => {
    fetchMock.mockImplementation(async (input, init) => String(input).endsWith('/v1/chat/completions')
      ? Response.json({ choices: [{ message: { content: '?'.repeat(24) } }] })
      : defaultResponse(input, init));
    expect(await verifyModelOutput('bad-quant')).toBe('broken');
    expect(mocks.output).toHaveBeenCalledExactlyOnceWith('bad-quant', 64, 'broken');
    expect(mocks.architecture).not.toHaveBeenCalled();
  });

  it('HTTP 오류와 짧은 점검 출력은 파일·모델 구조의 고장으로 기록하지 않는다', async () => {
    fetchMock.mockImplementation(async (input, init) => String(input).endsWith('/v1/chat/completions')
      ? new Response(null, { status: 503 }) : defaultResponse(input, init));
    expect(await verifyModelOutput('http-error')).toBe('skipped');
    fetchMock.mockImplementation(async (input, init) => String(input).endsWith('/v1/chat/completions')
      ? Response.json({ choices: [{ message: { content: '5' } }] }) : defaultResponse(input, init));
    expect(await verifyModelOutput('short-answer')).toBe('skipped');
    expect(mocks.output).not.toHaveBeenCalled();
    expect(mocks.architecture).not.toHaveBeenCalled();
  });

  it('준비 확인 직후 /props 중 자식이 죽으면 죽은 인스턴스를 재사용하지 않는다', async () => {
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).endsWith('/props')) {
        const child = children.at(-1);
        if (child) exitChild(child, 1);
        return Response.json({});
      }
      return defaultResponse(input, init);
    });
    expect(await verifyModelOutput('early-exit')).toBe('skipped');
    expect(listLoadedModels()).toEqual([]);
    expect(mocks.output).not.toHaveBeenCalled();
  });
});
