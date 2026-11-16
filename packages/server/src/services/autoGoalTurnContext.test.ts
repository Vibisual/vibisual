import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AutoGoalSentLists, buildAutoGoalTurnParts, dropsConversationHistory } from './autoGoalTurnContext.js';
import { buildAutoGoalAgentProtocol } from './autoGoalAgentProtocol.js';
import { validAutoGoalCapability } from './autoGoalActorAuth.js';
import { AUTO_GOAL_LIST_RULE_LINES, buildAutoGoalPromptBlock, dropAutoGoalCache } from './autoGoalService.js';

let root: string;
const ON = { enabledProject: true };
const RELATED = 'Compile graph renderer output';
const UNRELATED = 'Diagnose Windows microphone devices';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vib-auto-goal-turn-'));
  const directory = path.join(root, '.vibisual/skills/graph-renderer');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'SKILL.md'), [
    '---', 'name: Graph renderer build', 'description: Compile graph renderer output.', 'id: graph-renderer', '---', 'Instructions',
  ].join('\n'));
});
afterEach(() => {
  dropAutoGoalCache(root);
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('vib-auto-goal-turn-')) throw new Error('Unsafe fixture cleanup');
  fs.rmSync(root, { recursive: true, force: true });
});

const parts = (over: Partial<Parameters<typeof buildAutoGoalTurnParts>[0]> = {}) => buildAutoGoalTurnParts({
  root, settings: ON, agentId: 'agent-a', sessionId: 'tab-1', task: RELATED, rulesInSystem: true, ...over,
});

/* §5.5 #17-28 ⑧(c) — 안 변하는 규약은 시스템 프롬프트 한 벌, 턴 메시지에는 변하는 것(목록·신원 한 줄)만. */
describe('procedure context split for sessions we spawn', () => {
  it('keeps the rules in the system half and only the list plus one identity line in the turn half', () => {
    const { turn, system } = parts();
    expect(system).toContain('# 절차 검토·재사용 규약');
    expect(system).toContain('/api/auto-goal/review');
    for (const line of AUTO_GOAL_LIST_RULE_LINES) {
      expect(system).toContain(line);
      expect(turn).not.toContain(line);
    }
    expect(turn).toContain('Graph renderer build');
    expect(turn).not.toContain('/api/auto-goal/');
    expect(turn.split('\n').at(-1)).toMatch(/^절차 창구 공통 JSON 필드: \{.*\}$/);
    // 규약이 가리키는 줄 이름이 실제 줄과 같아야 에이전트가 신원을 찾는다.
    expect(system).toContain('`절차 창구 공통 JSON 필드:`');
  });

  it('carries no session id or capability token in the system half', () => {
    const { turn, system } = parts();
    expect(system).not.toContain('agent-a');
    expect(system).not.toContain('tab-1');
    expect(system).not.toMatch(/[a-f0-9]{64}/);
    const token = /"procedureToken":"([a-f0-9]{64})"/.exec(turn)?.[1];
    expect(turn).toContain('"agentId":"agent-a","subAgentId":"tab-1"');
    expect(validAutoGoalCapability(token, root, { agentId: 'agent-a', subAgentId: 'tab-1' })).toBe(true);
  });

  it('keeps the system half byte-identical whether or not this turn lists anything', () => {
    const listed = parts();
    const quiet = parts({ task: UNRELATED });
    expect(quiet.turn).toBe('');
    expect(quiet.system).toBe(listed.system);
    expect(parts({ sessionId: 'tab-2' }).system).toBe(listed.system);
  });

  it('drops both halves when the feature is off or the project has no listable procedure', () => {
    expect(parts({ settings: { enabledProject: false } })).toEqual({ turn: '', system: '', listKey: '' });
    fs.rmSync(path.join(root, '.vibisual'), { recursive: true, force: true });
    expect(parts()).toEqual({ turn: '', system: '', listKey: '' });
  });

  it('gives the same list key to the same procedures in a different rank order, and a new one when the list changes', () => {
    const directory = path.join(root, '.vibisual/skills/audio-mixer');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'SKILL.md'), [
      '---', 'name: Audio mixer export', 'description: Export audio mixer stems.', 'id: audio-mixer', '---', 'Instructions',
    ].join('\n'));
    const graphFirst = parts({ task: 'Compile graph renderer output, then export audio' });
    const audioFirst = parts({ task: 'Export audio mixer stems for the graph' });
    expect(graphFirst.turn.indexOf('Graph renderer build')).toBeLessThan(graphFirst.turn.indexOf('Audio mixer export'));
    expect(audioFirst.turn.indexOf('Audio mixer export')).toBeLessThan(audioFirst.turn.indexOf('Graph renderer build'));
    expect(audioFirst.turn).not.toBe(graphFirst.turn);
    expect(audioFirst.listKey).toBe(graphFirst.listKey);
    const graphOnly = parts({ task: RELATED });
    expect(graphOnly.turn).not.toContain('Audio mixer export');
    expect(graphOnly.listKey).not.toBe(graphFirst.listKey);
    // 창구 토큰이 바뀌면(서버 재기동) 같은 목록도 다시 실어야 한다 — 신원 줄이 키에 든다.
    expect(parts({ task: RELATED, sessionId: 'tab-2' }).listKey).not.toBe(graphOnly.listKey);
    expect(parts({ rulesInSystem: false }).listKey).toBe('');
  });

  it('does not split without a session key — rules alone would name a window nobody can call', () => {
    const { turn, system } = parts({ sessionId: null });
    expect(system).toBe('');
    expect(turn).toBe(buildAutoGoalPromptBlock(root, ON, { agentId: 'agent-a', subAgentId: null }, RELATED));
  });
});

describe('procedure context where rules cannot go to the system prompt', () => {
  it('sends the list with the full protocol in the turn, exactly as the hook channel does', () => {
    const { turn, system } = parts({ rulesInSystem: false, identityFile: 'C:/test-only/listener.json' });
    expect(system).toBe('');
    const ids = { agentId: 'agent-a', subAgentId: 'tab-1' };
    expect(turn).toBe(`${buildAutoGoalPromptBlock(root, ON, ids, RELATED)}\n\n${
      buildAutoGoalAgentProtocol({ root, ...ids, identityFile: 'C:/test-only/listener.json' })}`);
    expect(turn).toContain('## 절차 검토·재사용 규약');
    expect(turn).toContain(AUTO_GOAL_LIST_RULE_LINES[0]);
  });

  it('sends nothing on a turn no procedure is close to', () => {
    expect(parts({ rulesInSystem: false, task: UNRELATED })).toEqual({ turn: '', system: '', listKey: '' });
  });
});

/* §5.10 — 같은 목록을 매 턴 다시 실으면 대화 이력에 턴 수만큼 쌓인다. 바뀌었을 때와 이력에서 사라졌을 때만 다시 싣는다. */
describe('sent-list ledger', () => {
  it('omits an identical list on the next turn and re-sends a changed one', () => {
    const ledger = new AutoGoalSentLists();
    expect(ledger.isRepeat('tab-1', 'list A', 'cmd-1')).toBe(false);
    ledger.commit('tab-1', 'list A', 'cmd-1');
    expect(ledger.isRepeat('tab-1', 'list A', 'cmd-2')).toBe(true);
    expect(ledger.isRepeat('tab-1', 'list B', 'cmd-2')).toBe(false);
    expect(ledger.isRepeat('tab-2', 'list A', 'cmd-3')).toBe(false);
  });

  it('never commits by being read — measuring the inventory must not swallow the next list', () => {
    const ledger = new AutoGoalSentLists();
    for (let i = 0; i < 3; i += 1) expect(ledger.isRepeat('tab-1', 'list A', `cmd-${i}`)).toBe(false);
    expect(ledger.size).toBe(0);
  });

  it('re-sends after the conversation is compacted or cleared', () => {
    const ledger = new AutoGoalSentLists();
    ledger.commit('tab-1', 'list A', 'cmd-1');
    ledger.forget('tab-1');
    expect(ledger.isRepeat('tab-1', 'list A', 'cmd-2')).toBe(false);
  });

  it('re-sends when the same command is dispatched again — its first attempt may not have reached the model', () => {
    const ledger = new AutoGoalSentLists();
    ledger.commit('tab-1', 'list A', 'cmd-1');
    expect(ledger.isRepeat('tab-1', 'list A', 'cmd-1')).toBe(false);
    expect(ledger.isRepeat('tab-1', 'list A', 'cmd-2')).toBe(true);
  });

  it('treats an empty list as nothing to remember', () => {
    const ledger = new AutoGoalSentLists();
    ledger.commit('tab-1', '', 'cmd-1');
    expect(ledger.size).toBe(0);
    expect(ledger.isRepeat('tab-1', '', 'cmd-2')).toBe(false);
  });

  it('stays bounded and drops the session whose list was sent longest ago', () => {
    const ledger = new AutoGoalSentLists(2);
    ledger.commit('a', 'list', 'c1');
    ledger.commit('b', 'list', 'c2');
    ledger.commit('c', 'list', 'c3');
    expect(ledger.size).toBe(2);
    expect(ledger.isRepeat('a', 'list', 'c4')).toBe(false);
    ledger.commit('b', 'list 2', 'c5');
    ledger.commit('d', 'list', 'c6');
    expect(ledger.size).toBe(2);
    expect(ledger.isRepeat('c', 'list', 'c7')).toBe(false);
    expect(ledger.isRepeat('b', 'list 2', 'c7')).toBe(true);
    expect(ledger.isRepeat('d', 'list', 'c7')).toBe(true);
  });
});

describe('commands that drop the conversation history', () => {
  it('recognizes compact and clear with or without arguments, and nothing else', () => {
    for (const text of ['/compact', '  /compact  ', '/compact keep the open questions', '/clear', '/clear\n']) {
      expect(dropsConversationHistory(text), text).toBe(true);
    }
    for (const text of ['', 'compact the notes', '/compaction', '/context', 'run /compact later', '/clearall']) {
      expect(dropsConversationHistory(text), text).toBe(false);
    }
  });
});

/**
 * 배선 — 조립 함수는 `runServer` 안이라 직접 부를 수 없다. 빠지면 빌드·타입체크는 통과하고 규약만 조용히 사라지거나 매 턴 다시 쌓인다.
 * 줄 모양을 본다: 아래 정규식에 걸리는 대입문은 한 줄로 유지한다.
 */
describe('dispatch wiring', () => {
  const source = fs.readFileSync(new URL('../index.ts', import.meta.url), 'utf8');

  it('sends the static halves through the appended system prompt', () => {
    expect(source).toMatch(/const systemRulesBlock =[^\n]*compactSelfRule[^\n]*autoGoalParts\.system/);
    expect(source).toMatch(/const appendSystemPrompt =[^\n]*systemRulesBlock/);
  });

  it('gates both halves of each source on its inventory switch', () => {
    expect(source).toMatch(/const compactSelfRule = take\(CONTEXT_SOURCE_IDS\.compactSelf\)/);
    expect(source).toMatch(/const autoGoalOn = !!take\(CONTEXT_SOURCE_IDS\.autoGoalSkills\)/);
    expect(source).toMatch(/const autoGoalTurn = autoGoalOn &&/);
    expect(source).toMatch(/\(autoGoalOn \? assembled\.autoGoalParts\.system : ''\)/);
  });

  it('always carries the full list on a first spawn and drops only a repeat from the live preamble', () => {
    expect(source).toMatch(/const dispatchContext =[^\n]*compactSelfTurn \+ autoGoalTurn;/);
    expect(source).toMatch(/const livePreamble =[^\n]*compactSelfTurn \+ \(autoGoalRepeat \? '' : autoGoalTurn\);/);
  });

  it('commits the digest only at the dispatch site, after execute', () => {
    const commits = source.split('autoGoalSentLists.commit(').length - 1;
    expect(commits).toBe(1);
    expect(source.indexOf('autoGoalSentLists.commit(')).toBeGreaterThan(source.indexOf('subAgentManager.execute(next'));
    // 재는 길(`assembleContextParts`)은 장부를 건드리지 않는다.
    const assemble = source.slice(source.indexOf('function assembleContextParts('), source.indexOf('function countRunningTurns('));
    expect(assemble.length).toBeGreaterThan(0);
    expect(assemble.includes('autoGoalSentLists.commit(') || assemble.includes('autoGoalSentLists.isRepeat(') || assemble.includes('autoGoalSentLists.forget(')).toBe(false);
  });

  it('forgets the sent list when the session compacts or clears', () => {
    expect(source).toMatch(/dropsConversationHistory\(next\.text[^\n]*autoGoalSentLists\.forget\(next\.subAgentId\)/);
    expect(source).toMatch(/compactingSince !== undefined\) autoGoalSentLists\.forget\(s\.id\)/);
  });
});
