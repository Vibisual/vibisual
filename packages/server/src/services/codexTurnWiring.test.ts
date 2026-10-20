import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import type { AgentConfig, QueuedCommand } from '@vibisual/shared';
import type { CodexTurnArgs } from './codexRunner.js';

let lastTurnArgs: CodexTurnArgs | null = null;

vi.mock('./codexRunner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./codexRunner.js')>();
  return {
    ...actual,
    runCodexTurn: (args: CodexTurnArgs): void => { lastTurnArgs = args; },
  };
});

const { subAgentManager } = await import('./subAgentManager.js');
const created: string[] = [];

function codexConfig(): AgentConfig {
  return {
    model: 'opus',
    tools: [],
    permissionMode: 'auto',
    skills: [],
    provider: { kind: 'codex-cli', modelId: 'gpt-5.3-codex', reasoningSummary: 'concise', personality: 'friendly', serviceTier: 'fast', autoCompactTokenLimit: 90000, networkAccess: false },
  } as AgentConfig;
}

function makeCommand(subAgentId: string): QueuedCommand {
  return {
    id: `cmd-${Math.random().toString(36).slice(2)}`,
    text: '요청한 파일을 고쳐 줘',
    timestamp: Date.now(),
    status: 'queued',
    subAgentId,
    attachments: ['C:/tmp/reference one.png'],
    executionRequirements: { localTransport: true },
  };
}

beforeEach(() => {
  while (created.length > 0) {
    const id = created.pop();
    if (id) subAgentManager.remove(id);
  }
  lastTurnArgs = null;
  subAgentManager.setOnSubStatusChange(() => { /* test */ });
});

describe('Codex Agent Studio 실행 연결', () => {
  it('relays raw activity through live status events and ignores activity from a finished turn', () => {
    const sub = subAgentManager.create('agent-codex-activity', 'sub-codex-activity');
    created.push(sub.id);
    const stream = vi.fn();
    subAgentManager.setOnStreamEvent(stream);
    try {
      subAgentManager.execute(makeCommand(sub.id), process.cwd(), 'CONTEXT', codexConfig());
      const firstTurn = lastTurnArgs!;
      expect(firstTurn.onActivity).toBeTypeOf('function');
      stream.mockClear();
      const at = Date.now();
      firstTurn.onActivity!(at);
      expect(stream).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        subAgentId: sub.id, timestamp: at, eventType: 'system', content: '[status]',
      }));
      firstTurn.onDone(undefined, 'done');
      subAgentManager.execute(makeCommand(sub.id), process.cwd(), 'CONTEXT', codexConfig());
      stream.mockClear();
      firstTurn.onActivity!(at + 1);
      expect(stream).not.toHaveBeenCalled();
      lastTurnArgs!.onActivity!(at + 2);
      expect(stream).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ timestamp: at + 2 }));
      lastTurnArgs!.onDone(undefined, 'done');
    } finally {
      subAgentManager.setOnStreamEvent(() => { /* restore test callback */ });
    }
  });

  it('모델을 아직 고르지 않은 Codex 멤버도 첫 턴을 실행하고 같은 스레드로 재개한다', () => {
    const sub = subAgentManager.create('agent-codex-default', 'sub-codex-default');
    created.push(sub.id);
    const config = codexConfig();
    config.provider!.modelId = '';
    const first = makeCommand(sub.id);
    subAgentManager.execute(first, process.cwd(), 'CONTEXT', config);
    expect(first.status).toBe('executing');
    expect(lastTurnArgs?.model).toBe('');
    expect(lastTurnArgs?.resumeThreadId).toBeUndefined();
    lastTurnArgs!.onThread?.('default-model-thread');
    lastTurnArgs!.onDone(undefined, 'ready');
    const second = makeCommand(sub.id);
    subAgentManager.execute(second, process.cwd(), 'CONTEXT', config);
    expect(second.status).toBe('executing');
    expect(lastTurnArgs?.model).toBe('');
    expect(lastTurnArgs?.resumeThreadId).toBe('default-model-thread');
    lastTurnArgs!.onDone(undefined, 'done');
  });
  it('forwards raw Bash execution and outcomes through the existing scoped hook emitter', () => {
    const sub = subAgentManager.create('agent-codex-procedure', 'sub-codex-procedure');
    created.push(sub.id);
    const cmd = makeCommand(sub.id);
    const emitted = vi.fn();
    subAgentManager.setLocalHookEmitter(emitted);
    subAgentManager.execute(cmd, process.cwd(), 'CONTEXT', codexConfig());
    const raw = 'printf "a  b"\nprintf "second line"';
    lastTurnArgs!.onEvent({ eventType: 'tool_use', content: 'summary', toolName: 'Bash', toolUseId: 'item-1', bashHook: { phase: 'pre', command: raw } });
    lastTurnArgs!.onEvent({ eventType: 'tool_result', content: 'summary', toolName: 'Bash', toolUseId: 'item-1', bashHook: { phase: 'post', toolResponse: 'done', toolIsError: false } });
    expect(emitted).toHaveBeenNthCalledWith(1, { agentId: sub.parentAgentId, subAgentId: sub.id }, expect.objectContaining({ phase: 'pre', toolInput: { command: raw } }));
    expect(emitted).toHaveBeenNthCalledWith(2, { agentId: sub.parentAgentId, subAgentId: sub.id }, expect.objectContaining({ phase: 'post', toolInput: { command: raw }, toolIsError: false }));
    expect(emitted.mock.calls[0]?.[1].toolUseId).toBe(`codex-bash:${sub.id}:${cmd.id}:item-1`);
    lastTurnArgs!.onDone(undefined, 'done');
    subAgentManager.setLocalHookEmitter(() => { /* restore neutral test emitter */ });
  });

  it('Claude 경로와 같은 프로젝트 규칙·라이브 맥락·카드 env·첨부를 Codex runner에 싣는다', () => {
    const sub = subAgentManager.create('agent-codex-wiring', 'sub-codex-wiring');
    created.push(sub.id);
    const cmd = makeCommand(sub.id);

    subAgentManager.execute(
      cmd,
      process.cwd(),
      'PROJECT CONTEXT',
      codexConfig(),
      'LIVE CONTEXT',
      {
        codexContextArgs: ['-c', 'developer_instructions=""'],
        codexEdgeConfig: { helperPath: '/hooks/codex-edges.mjs', nodeBin: 'node', edgeIds: ['edge-target'], restrictedTools: ['Read'] },
        appendSystemPrompt: 'STABLE AGENT RULES',
        extraEnv: {
          VIBISUAL_BASE: 'http://127.0.0.1:43111',
          VIBISUAL_TOKEN: 'test-token',
        },
      },
    );

    expect(lastTurnArgs).not.toBeNull();
    expect(lastTurnArgs).toMatchObject({ reasoningSummary: 'concise', personality: 'friendly', serviceTier: 'fast', autoCompactTokenLimit: 90000, networkAccess: false });
    expect(lastTurnArgs!.images).toEqual(cmd.attachments);
    expect(lastTurnArgs!.executionRequirements).toEqual(cmd.executionRequirements);
    expect(lastTurnArgs!.contextArgs).toEqual(['-c', 'developer_instructions=""']);
    expect(lastTurnArgs!.edgeConfig?.edgeIds).toEqual(['edge-target']);
    expect(lastTurnArgs!.edgeConfig?.restrictedTools).toEqual(['Read']);
    expect(lastTurnArgs!.prompt).toContain('mcp__vibisual_edges__dispatch');
    expect(lastTurnArgs!.prompt).toContain('All direct executable tools are blocked');
    expect(lastTurnArgs!.env).toMatchObject({
      VIBISUAL_BASE: 'http://127.0.0.1:43111',
      VIBISUAL_TOKEN: 'test-token',
    });
    const prompt = lastTurnArgs!.prompt;
    expect(prompt).toContain('PROJECT CONTEXT');
    expect(prompt).toContain('STABLE AGENT RULES');
    expect(prompt).toContain('LIVE CONTEXT');
    expect(prompt).toContain(cmd.text);
    expect(prompt.indexOf('PROJECT CONTEXT')).toBeLessThan(prompt.indexOf('LIVE CONTEXT'));
    expect(prompt.indexOf('LIVE CONTEXT')).toBeLessThan(prompt.indexOf(cmd.text));

    lastTurnArgs!.onDone(undefined, '완료');
    expect(cmd.status).toBe('completed');
  });

  it('keeps the edge bridge while disabling its optional context instructions on resumed turns', () => {
    const sub = subAgentManager.create('agent-codex-context', 'sub-codex-context');
    created.push(sub.id);
    sub.sessionId = 'existing-thread';
    const cmd = makeCommand(sub.id);
    subAgentManager.execute(cmd, process.cwd(), 'FILTERED CONTEXT', codexConfig(), undefined, {
      codexContextArgs: ['-c', 'project_doc_max_bytes=0'],
      codexEdgeInstructionsEnabled: false,
      codexEdgeConfig: { helperPath: '/hooks/codex-edges.mjs', nodeBin: 'node', edgeIds: ['edge-target'], restrictedTools: ['Read'] },
    });
    expect(lastTurnArgs!.resumeThreadId).toBe('existing-thread');
    expect(lastTurnArgs!.contextArgs).toEqual(['-c', 'project_doc_max_bytes=0']);
    expect(lastTurnArgs!.edgeConfig?.edgeIds).toEqual(['edge-target']);
    expect(lastTurnArgs!.prompt).not.toContain('mcp__vibisual_edges__dispatch');
    expect(lastTurnArgs!.prompt.match(/FILTERED CONTEXT/g)).toHaveLength(1);
    lastTurnArgs!.onDone(undefined, 'done');
  });
});

/**
 * §5.25 (F) "쓴 내용도 남는다" — 사용자 보고(2026-10-20): 코덱스가 고친 파일에 쓰기 화살표는 서는데 파일을
 * 눌러도 쓴 내용이 비었다. `file_change` 는 경로만 싣기 때문이다. 사전 훅이 허락한 패치를 sub 장부에 적고,
 * 그 파일의 완료가 꺼내 **같은 사후 `Write` 이벤트에 실어** 방출기로 보내는지 고정한다.
 */
describe('코덱스 패치 덩어리 → 파일 쓰기 이벤트', () => {
  const PATCH = [
    '*** Begin Patch',
    '*** Update File: src/pathLinkContextMenu.ts',
    '@@',
    '-  /** `POST /api/reveal-path` — 파일이면 그 파일이 든 폴더. */',
    '+  /** `POST /api/reveal-path` — 파일이면 상위 폴더에서 해당 파일 선택. */',
    '*** End Patch',
  ].join('\n');
  const target = (): string => path.join(process.cwd(), 'src', 'pathLinkContextMenu.ts');
  const notePatch = (subId: string): number => subAgentManager.noteCodexPatch(subId, {
    cwd: process.cwd(), toolName: 'apply_patch', toolInput: { command: PATCH }, toolUseId: 'call-patch-1',
  });

  it('허락된 패치의 덩어리가 그 파일의 완료 이벤트에 한 번만 실린다', () => {
    const sub = subAgentManager.create('agent-codex-patch', 'sub-codex-patch');
    created.push(sub.id);
    const emitted = vi.fn();
    subAgentManager.setLocalHookEmitter(emitted);
    try {
      subAgentManager.execute(makeCommand(sub.id), process.cwd(), 'CONTEXT', codexConfig());
      expect(notePatch(sub.id)).toBe(1);
      lastTurnArgs!.onFileWrites([target()]);
      expect(emitted).toHaveBeenCalledExactlyOnceWith(
        { agentId: sub.parentAgentId, subAgentId: sub.id },
        expect.objectContaining({
          phase: 'post',
          toolName: 'Write',
          toolInput: { path: target() },
          fileEdit: expect.objectContaining({
            oldString: '  /** `POST /api/reveal-path` — 파일이면 그 파일이 든 폴더. */',
            newString: '  /** `POST /api/reveal-path` — 파일이면 상위 폴더에서 해당 파일 선택. */',
          }),
        }),
      );
      expect(String(emitted.mock.calls[0]?.[1].fileEdit.id).startsWith('call-patch-1:')).toBe(true);

      // 같은 파일의 다음 완료(장부가 빈 쓰기)는 버블·화살표만 — 같은 이력을 두 번 붙이지 않는다.
      emitted.mockClear();
      lastTurnArgs!.onFileWrites([target()]);
      expect(emitted).toHaveBeenCalledTimes(1);
      expect(emitted.mock.calls[0]?.[1].fileEdit).toBeUndefined();
      lastTurnArgs!.onDone(undefined, 'done');
    } finally {
      subAgentManager.setLocalHookEmitter(() => { /* restore neutral test emitter */ });
    }
  });

  it('지난 턴에 적용되지 못한 패치 칸은 다음 턴의 같은 파일에 붙지 않는다', () => {
    const sub = subAgentManager.create('agent-codex-patch-stale', 'sub-codex-patch-stale');
    created.push(sub.id);
    const emitted = vi.fn();
    subAgentManager.setLocalHookEmitter(emitted);
    try {
      subAgentManager.execute(makeCommand(sub.id), process.cwd(), 'CONTEXT', codexConfig());
      expect(notePatch(sub.id)).toBe(1); // 허락은 됐지만 적용 전에 턴이 끝났다
      lastTurnArgs!.onDone(undefined, 'done');

      subAgentManager.execute(makeCommand(sub.id), process.cwd(), 'CONTEXT', codexConfig());
      lastTurnArgs!.onFileWrites([target()]); // 이번 턴의 쓰기 — 훅이 적은 것이 없다
      expect(emitted).toHaveBeenCalledTimes(1);
      expect(emitted.mock.calls[0]?.[1].fileEdit).toBeUndefined();
      lastTurnArgs!.onDone(undefined, 'done');
    } finally {
      subAgentManager.setLocalHookEmitter(() => { /* restore neutral test emitter */ });
    }
  });

  it('모르는 sub 의 패치는 적지 않는다', () => {
    expect(notePatch('sub-does-not-exist')).toBe(0);
  });
});
