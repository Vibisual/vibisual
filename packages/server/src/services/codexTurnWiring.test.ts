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
    provider: { kind: 'codex-cli', modelId: 'gpt-5.3-codex' },
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
        codexEdgeConfig: { helperPath: '/hooks/codex-edges.mjs', nodeBin: 'node', edgeIds: ['edge-target'], restrictedTools: ['Read'] },
        appendSystemPrompt: 'STABLE AGENT RULES',
        extraEnv: {
          VIBISUAL_BASE: 'http://127.0.0.1:43111',
          VIBISUAL_TOKEN: 'test-token',
        },
      },
    );

    expect(lastTurnArgs).not.toBeNull();
    expect(lastTurnArgs!.images).toEqual(cmd.attachments);
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
});
