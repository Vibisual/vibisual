/** §5.5 #17-51 — 같은 서브에이전트가 이어지면 머리표를 생략하고, 서브에이전트마다 색·짧은 id·이름으로 가른다. */
import { describe, it, expect } from 'vitest';
import type { SubAgentStreamEvent } from '@vibisual/shared';
import {
  nestedContinuationIds, nestedAgentTone, nestedAgentShortId, nestedAgentLabels,
  sameIdSet, sameLabelMap, NESTED_AGENT_TONES,
} from './nestedSubagentRuns';

const seq = (owners: (string | undefined)[]) => owners.map((owner, i) => ({ id: `i${i}`, owner }));

describe('nestedContinuationIds', () => {
  it('같은 서브에이전트가 이어지면 첫 줄만 머리표, 나머지는 이어짐', () => {
    expect([...nestedContinuationIds(seq(['A', 'A', 'A']))]).toEqual(['i1', 'i2']);
  });

  it('부모 줄이 끼면 끊긴다', () => {
    expect([...nestedContinuationIds(seq(['A', undefined, 'A']))]).toEqual([]);
  });

  it('서브에이전트가 바뀌면 끊긴다', () => {
    expect([...nestedContinuationIds(seq(['A', 'B', 'A', 'B']))]).toEqual([]);
    expect([...nestedContinuationIds(seq(['A', 'A', 'B', 'B']))]).toEqual(['i1', 'i3']);
  });

  it('부모 줄끼리는 이어짐이 아니다', () => {
    expect([...nestedContinuationIds(seq([undefined, undefined]))]).toEqual([]);
    expect([...nestedContinuationIds([])]).toEqual([]);
  });
});

describe('nestedAgentTone · nestedAgentShortId', () => {
  it('같은 id 는 늘 같은 색', () => {
    expect(nestedAgentTone('toolu_01AbC')).toBe(nestedAgentTone('toolu_01AbC'));
  });

  it('여러 서브에이전트가 한 색으로 몰리지 않는다', () => {
    const ids = Array.from({ length: 16 }, (_, i) => `toolu_01${i.toString(36)}xYz${i * 7}`);
    const tones = new Set(ids.map((id) => nestedAgentTone(id)));
    expect(tones.size).toBeGreaterThan(3);
    for (const t of tones) expect(NESTED_AGENT_TONES).toContain(t);
  });

  it('짧은 id 는 영숫자 끝 4자', () => {
    expect(nestedAgentShortId('toolu_01ABCdef9Q')).toBe('ef9Q');
    expect(nestedAgentShortId('call-ab')).toBe('llab');
    expect(nestedAgentShortId('x')).toBe('x');
  });
});

let n = 0;
const use = (toolUseId: string, content: string): SubAgentStreamEvent => ({
  id: `e${++n}`, subAgentId: 'S', parentAgentId: 'P', timestamp: n, eventType: 'tool_use', toolName: 'Agent', toolUseId, content,
});

describe('nestedAgentLabels', () => {
  it('띄운 호출의 description 을 이름으로', () => {
    const events = [use('t1', JSON.stringify({ description: '코드 위치 찾기', prompt: 'p', subagent_type: 'Explore' }))];
    expect(nestedAgentLabels(events, new Set(['t1'])).get('t1')).toBe('코드 위치 찾기');
  });

  it('잘려 온 입력도 앞쪽 필드는 읽는다 · 이스케이프를 푼다', () => {
    const full = JSON.stringify({ description: 'say "hi"', prompt: 'x'.repeat(50) });
    expect(nestedAgentLabels([use('t1', full.slice(0, 40))], new Set(['t1'])).get('t1')).toBe('say "hi"');
  });

  it('description 이 없으면 subagent_type', () => {
    const events = [use('t1', JSON.stringify({ prompt: 'p', subagent_type: 'Explore' }))];
    expect(nestedAgentLabels(events, new Set(['t1'])).get('t1')).toBe('Explore');
  });

  it('호출이 창 밖이거나 주인이 아니면 이름이 없다', () => {
    const events = [use('other', JSON.stringify({ description: 'd' }))];
    expect(nestedAgentLabels(events, new Set(['t1'])).size).toBe(0);
    expect(nestedAgentLabels(events, new Set()).size).toBe(0);
  });
});

describe('참조 유지 비교', () => {
  it('같은 내용이면 같다고 본다', () => {
    expect(sameIdSet(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true);
    expect(sameIdSet(new Set(['a']), new Set(['a', 'b']))).toBe(false);
    expect(sameLabelMap(new Map([['a', '1']]), new Map([['a', '1']]))).toBe(true);
    expect(sameLabelMap(new Map([['a', '1']]), new Map([['a', '2']]))).toBe(false);
  });
});
