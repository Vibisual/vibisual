import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SubAgent, TurnTokenUsage } from '@vibisual/shared';
import { calculateTokenCost, costDayKey } from '@vibisual/shared';
import { ProjectGraph } from './projectGraph.js';
import { subAgentManager } from './subAgentManager.js';
import { readCodexTokenUsage } from './codexContext.js';
import { readSessionTokenData } from './sessionDiscovery.js';

vi.mock('./codexContext.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./codexContext.js')>(),
  readCodexContext: vi.fn(() => null),
  readCodexTokenUsage: vi.fn(() => null),
}));
vi.mock('./sessionDiscovery.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./sessionDiscovery.js')>(),
  readSessionTokenData: vi.fn(() => null),
  readContextInfo: vi.fn(() => null),
  discoverSessions: vi.fn(() => []),
}));

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

const now = Date.parse('2026-09-22T12:00:00');
const usage = (model: string, timestamp = now): TurnTokenUsage => ({
  model, timestamp, turnIndex: 0, inputTokens: 200, outputTokens: 100,
  cacheReadTokens: 800, cacheCreateTokens: 0, totalContext: 1000, tools: [],
});
const sub = (agentId: string, sessionId: string, lastActivityAt = now) => ({
  id: `sub-${sessionId}`, parentAgentId: agentId, sessionId, label: sessionId, lastActivityAt,
}) as SubAgent;

describe('ProjectGraph Codex cost map wiring', () => {
  it('routes provider records, retains model/day pricing, persists labels and ignores another graph', () => {
    const graph = new ProjectGraph();
    const projectName = graph.registerProject(process.cwd()).name;
    const codex = graph.createCustomAgent('Codex costs', undefined, projectName, { provider: { kind: 'codex-cli', modelId: 'gpt-5.4' } });
    const claude = graph.createCustomAgent('Claude costs', undefined, projectName);
    const yesterday = Date.parse('2026-09-21T12:00:00');
    const codexTurns = [usage('gpt-5.4', yesterday), { ...usage('gpt-5.3-codex'), turnIndex: 1 }];
    vi.mocked(readCodexTokenUsage).mockReturnValue(codexTurns);
    vi.mocked(readSessionTokenData).mockReturnValue({ sessionId: 'claude-thread', turns: [usage('claude-sonnet-4-6')], categories: [] });
    vi.spyOn(subAgentManager, 'getAllSubsFlat').mockReturnValue([
      sub(codex.id, 'codex-thread'), sub(claude.id, 'claude-thread'), sub('other-graph-agent', 'foreign-thread'),
    ]);

    expect(graph.sweepCostMap(null, now)).toBe(true);
    expect(readCodexTokenUsage).toHaveBeenCalledExactlyOnceWith('codex-thread');
    expect(readSessionTokenData).toHaveBeenCalledExactlyOnceWith(graph.getAgentCwdByAgentId(claude.id), 'claude-thread');
    const map = graph.toProjectCheckpoint(projectName).costMap!;
    expect(map.sessions).toHaveLength(2);
    expect(map.sessions.find(s => s.sessionId === 'codex-thread')).toMatchObject({ provider: 'codex', measured: true, inputTokens: 400, cacheReadTokens: 1600, outputTokens: 200 });
    expect(map.agents.find(a => a.agentId === codex.id)?.provider).toBe('codex');
    const gpt54 = calculateTokenCost(200, 100, 800, 0, 'gpt-5.4', null).total;
    const gpt53 = calculateTokenCost(200, 100, 800, 0, 'gpt-5.3-codex', null).total;
    expect(map.days.find(day => day.date === costDayKey(yesterday))?.costUsd).toBeCloseTo(gpt54, 10);
    const codexEntry = map.sessions.find(s => s.sessionId === 'codex-thread')!;
    expect(codexEntry.days?.[costDayKey(now)]?.costUsd).toBeCloseTo(gpt53, 10);
    expect(codexEntry.costUsd).toBeCloseTo(gpt54 + gpt53, 10);
    expect(graph.sweepCostMap(null, now + 1)).toBe(false);
    expect(graph.toProjectCheckpoint(projectName).costMap?.periods.all.costUsd).toBeCloseTo(map.periods.all.costUsd, 10);
  });

  it('retries a quiet legacy unmeasured Codex row instead of leaving it permanently empty', () => {
    const graph = new ProjectGraph();
    const projectName = graph.registerProject(process.cwd()).name;
    const agent = graph.createCustomAgent('Legacy costs', undefined, projectName);
    vi.spyOn(subAgentManager, 'getAllSubsFlat').mockReturnValue([sub(agent.id, 'legacy-thread', 0)]);
    vi.mocked(readSessionTokenData).mockReturnValue(null);
    expect(graph.sweepCostMap(null, now)).toBe(true);
    expect(graph.toProjectCheckpoint(projectName).costMap?.sessions[0]?.measured).toBe(false);
    graph.setAgentConfig(agent.id, { ...graph.getAgentConfig(agent.id)!, provider: { kind: 'codex-cli', modelId: 'gpt-5.4' } });
    vi.mocked(readCodexTokenUsage).mockReturnValue([usage('gpt-5.4')]);

    expect(graph.sweepCostMap(null, now + 1)).toBe(true);
    expect(graph.toProjectCheckpoint(projectName).costMap?.sessions[0]).toMatchObject({ provider: 'codex', measured: true, inputTokens: 200 });
    vi.mocked(readCodexTokenUsage).mockClear();
    expect(graph.sweepCostMap(null, now + 2)).toBe(false);
    expect(readCodexTokenUsage).not.toHaveBeenCalled();
  });

  it('uses the Codex reader for an interactive Codex CMD agent too', () => {
    const graph = new ProjectGraph();
    const projectName = graph.registerProject(process.cwd()).name;
    const agent = graph.createCustomAgent('Codex CMD costs', undefined, projectName, { executionMode: 'interactive-terminal', cliKind: 'codex' });
    vi.spyOn(subAgentManager, 'getAllSubsFlat').mockReturnValue([sub(agent.id, 'cmd-thread')]);
    vi.mocked(readCodexTokenUsage).mockReturnValue([usage('gpt-5.4')]);
    expect(graph.sweepCostMap(null, now)).toBe(true);
    expect(readCodexTokenUsage).toHaveBeenCalledExactlyOnceWith('cmd-thread');
    expect(readSessionTokenData).not.toHaveBeenCalled();
  });
});
