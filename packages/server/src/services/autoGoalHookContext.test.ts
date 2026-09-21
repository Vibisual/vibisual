import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildAutoGoalHookContext, type AutoGoalHookContextDeps } from './autoGoalHookContext.js';
import { dropAutoGoalCache } from './autoGoalService.js';

let root: string;
let deps: AutoGoalHookContextDeps;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vib-auto-goal-hook-'));
  const directory = path.join(root, '.vibisual/brain/skills/graph-renderer');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'SKILL.md'), [
    '---', 'name: Graph renderer build', 'description: Compile graph renderer output.',
    'id: graph-renderer', 'status: active', 'verifyState: verified', '---', 'Old renderer build instructions.',
  ].join('\n'));
  deps = {
    agentBySession: (id) => id === 'external-session' ? { id: 'external-agent', customCreated: false } : null,
    isManagedSession: () => false,
    rootForAgent: (id) => id === 'external-agent' ? root : null,
    settings: () => ({ enabledAgents: { 'external-agent': true } }),
    contextEnabled: () => true,
    identityFile: 'C:/test-only/listener.json',
  };
});
afterEach(() => {
  dropAutoGoalCache(root);
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('vib-auto-goal-hook-')) throw new Error('Unsafe fixture cleanup');
  fs.rmSync(root, { recursive: true, force: true });
});
const request = { session_id: 'external-session', prompt: 'Compile graph renderer output' };

describe('external hook procedure context', () => {
  it('injects actual legacy paths and the same agent/session API identity for a relevant request', () => {
    let scope: string[] = [];
    const text = buildAutoGoalHookContext(request, { ...deps, contextEnabled: (agent, session) => { scope = [agent, session]; return true; } });
    expect(text).toContain('.vibisual/brain/skills/graph-renderer/SKILL.md');
    expect(text).toContain('검토 대기 — 실행 지침이 아님');
    expect(text).toContain('"agentId":"external-agent","subAgentId":"external-session"');
    expect(text).toContain('/api/auto-goal/review');
    expect(text).toContain('/api/auto-goal/assess');
    expect(text).toContain('C:/test-only/listener.json');
    expect(scope).toEqual(['external-agent', 'external-session']);
  });

  it('does not duplicate managed session injection or grant authority to an unregistered session', () => {
    expect(buildAutoGoalHookContext(request, { ...deps, isManagedSession: () => true })).toBe('');
    expect(buildAutoGoalHookContext(request, { ...deps, agentBySession: () => ({ id: 'external-agent', customCreated: true }) })).toBe('');
    expect(buildAutoGoalHookContext({ ...request, session_id: 'unregistered' }, deps)).toBe('');
    expect(buildAutoGoalHookContext(request, { ...deps, rootForAgent: () => null })).toBe('');
  });

  it('honors the actual session override and context switch, and skips unrelated work', () => {
    expect(buildAutoGoalHookContext(request, { ...deps, settings: () => ({ enabledProject: true, enabledSessions: { 'external-session': false } }) })).toBe('');
    expect(buildAutoGoalHookContext(request, { ...deps, contextEnabled: () => false })).toBe('');
    expect(buildAutoGoalHookContext({ ...request, prompt: 'Diagnose Windows microphone devices' }, deps)).toBe('');
  });
});
