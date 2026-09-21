import { beforeEach, describe, expect, it, vi } from 'vitest';
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
