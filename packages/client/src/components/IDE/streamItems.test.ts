/**
 * streamItems.test.ts — 증분 파서(IncrementalStreamParser)가 전체 재구축(buildBaseItems)과
 * **항상 동일한 결과**를 내는지 랜덤 시퀀스로 못박는다. Electron 앱 없이 파싱 정확성 검증.
 *
 * 검증 축:
 *  1) 임의 이벤트/명령 시퀀스를 임의 청크로 흘려 넣으며, 매 prefix 마다 증분 == 전체.
 *  2) 폴백 경로 — commands 변경 / 앞쪽 절단(trim) / 세션 교체 시 리셋 후에도 == 전체.
 */
import { describe, it, expect } from 'vitest';
import type { QueuedCommand, SubAgentStreamEvent } from '@vibisual/shared';
import { buildBaseItems, IncrementalStreamParser, mergeCardsIntoItems, type StreamItemFull, type BaseItemsResult } from './streamItems.js';

// ─── 시드 PRNG (mulberry32) — 재현 가능한 랜덤 ───
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type EvtType = 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'result' | 'system' | 'pulse' | 'hidden';
const EVT_TYPES: EvtType[] = ['text', 'thinking', 'tool_use', 'tool_result', 'result', 'system', 'pulse', 'hidden'];
const TOOLS = ['Grep', 'Read', 'Glob', 'Bash', 'TodoWrite'];

/** §5.5 #17-12 — TodoWrite 는 계획 블록으로 승격된다. 유효 JSON(승격)과 깨진 입력(도구 상자 폴백) 둘 다 흘린다. */
function todoInput(rnd: () => number, i: number): string {
  if (rnd() < 0.25) return `not-json-${i}`;
  const statuses = ['pending', 'in_progress', 'completed'];
  const todos = Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, k) => ({
    content: `step${i}_${k}`,
    status: statuses[Math.floor(rnd() * statuses.length)]!,
  }));
  return JSON.stringify({ todos });
}

function genEvents(rnd: () => number, n: number): SubAgentStreamEvent[] {
  const out: SubAgentStreamEvent[] = [];
  let ts = 1000;
  for (let i = 0; i < n; i++) {
    ts += 1 + Math.floor(rnd() * 5);
    const kind = EVT_TYPES[Math.floor(rnd() * EVT_TYPES.length)]!;
    const id = `e${i}`;
    const base = { id, subAgentId: 'S', parentAgentId: 'P', timestamp: ts };
    switch (kind) {
      case 'text': out.push({ ...base, eventType: 'text', content: `t${i}_${Math.floor(rnd() * 100)}` }); break;
      case 'thinking': out.push({ ...base, eventType: 'thinking', content: `k${i}_${Math.floor(rnd() * 100)}` }); break;
      case 'tool_use': {
        const toolName = TOOLS[Math.floor(rnd() * TOOLS.length)]!;
        const content = toolName === 'TodoWrite' ? todoInput(rnd, i) : `in${i}`;
        out.push({ ...base, eventType: 'tool_use', toolName, content });
        break;
      }
      case 'tool_result': out.push({ ...base, eventType: 'tool_result', toolName: TOOLS[Math.floor(rnd() * TOOLS.length)]!, content: `out${i}` }); break;
      case 'result': out.push({ ...base, eventType: 'result', content: `r${i}` }); break;
      case 'system': out.push({ ...base, eventType: 'system', content: rnd() < 0.5 ? `[task_started]` : `plain${i}` }); break;
      case 'pulse': out.push({ ...base, eventType: 'system', content: `[thinking_tokens]` }); break;
      case 'hidden': out.push({ ...base, eventType: 'system', content: `[status]` }); break;
    }
  }
  return out;
}

function genCommands(rnd: () => number, events: SubAgentStreamEvent[]): QueuedCommand[] {
  const n = Math.floor(rnd() * 4); // 0~3
  const cmds: QueuedCommand[] = [];
  const statuses = ['completed', 'executing', 'queued', 'error'];
  for (let i = 0; i < n; i++) {
    // 절반은 이벤트 사이 타임스탬프(→ crossesCommand 분할 유발), 절반은 앞쪽.
    const ts = events.length > 0 && rnd() < 0.5
      ? events[Math.floor(rnd() * events.length)]!.timestamp
      : 500 + i;
    cmds.push({
      id: `c${i}`,
      text: `cmd ${i}`,
      status: statuses[Math.floor(rnd() * statuses.length)]! as QueuedCommand['status'],
      timestamp: ts,
      result: rnd() < 0.5 ? `res${i}` : undefined,
    } as QueuedCommand);
  }
  return cmds;
}

/** 렌더에 영향 주는 필드만 뽑아 비교 가능한 평문으로. */
function normItem(it: StreamItemFull): unknown {
  switch (it.kind) {
    case 'text': case 'system': case 'result': return { k: it.kind, id: it.id, c: it.content, ts: it.timestamp };
    case 'tool': return { k: 'tool', id: it.id, n: it.toolName, in: it.input, out: it.output, a: it.isActive, ts: it.timestamp };
    case 'command': return { k: 'command', id: it.id, p: it.prompt, r: it.result, s: it.status, ts: it.timestamp };
    case 'thinking-live': return { k: 'thinking-live', id: it.id, ts: it.timestamp };
    case 'plan': return { k: 'plan', id: it.id, todos: it.todos, sup: !!it.superseded, ts: it.timestamp };
    default: return { k: it.kind, id: it.id, ts: it.timestamp };
  }
}
function normBase(b: BaseItemsResult): unknown {
  return {
    items: b.items.map(normItem),
    agentBusy: b.agentBusy,
    live: b.thinkingLive ? { id: b.thinkingLive.id, ts: b.thinkingLive.timestamp } : null,
  };
}

describe('IncrementalStreamParser === buildBaseItems', () => {
  it('매 prefix 마다 증분 == 전체 (랜덤 시퀀스 × 청크)', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const rnd = mulberry32(seed);
      const n = 5 + Math.floor(rnd() * 180);
      const events = genEvents(rnd, n);
      const commands = genCommands(rnd, events);

      const parser = new IncrementalStreamParser();
      let consumed = 0;
      while (consumed < events.length) {
        const step = 1 + Math.floor(rnd() * 7);
        consumed = Math.min(events.length, consumed + step);
        const prefix = events.slice(0, consumed);
        const inc = parser.sync(prefix, commands);
        const full = buildBaseItems(prefix, commands);
        expect(normBase(inc), `seed=${seed} consumed=${consumed}`).toEqual(normBase(full));
      }
    }
  });

  it('폴백: commands 변경 후에도 == 전체', () => {
    for (let seed = 200; seed <= 260; seed++) {
      const rnd = mulberry32(seed);
      const events = genEvents(rnd, 20 + Math.floor(rnd() * 60));
      const c1 = genCommands(rnd, events);
      const c2 = genCommands(rnd, events);
      const parser = new IncrementalStreamParser();
      parser.sync(events, c1);
      const inc = parser.sync(events, c2); // commands 바뀜 → 내부 리셋
      expect(normBase(inc), `seed=${seed}`).toEqual(normBase(buildBaseItems(events, c2)));
    }
  });

  it('폴백: 앞쪽 절단(trim) 후에도 == 전체', () => {
    for (let seed = 300; seed <= 360; seed++) {
      const rnd = mulberry32(seed);
      const events = genEvents(rnd, 30 + Math.floor(rnd() * 80));
      const commands = genCommands(rnd, events);
      const parser = new IncrementalStreamParser();
      parser.sync(events, commands);
      const trim = 1 + Math.floor(rnd() * 20);
      const trimmed = events.slice(trim); // 버퍼 앞쪽이 절단된 상황
      const inc = parser.sync(trimmed, commands);
      expect(normBase(inc), `seed=${seed} trim=${trim}`).toEqual(normBase(buildBaseItems(trimmed, commands)));
      // 절단 직후 순수 append 재개도 검증
      const more = genEvents(mulberry32(seed + 1), 10).map((e, i) => ({ ...e, id: `x${i}` }));
      const next = [...trimmed, ...more];
      const inc2 = parser.sync(next, commands);
      expect(normBase(inc2), `seed=${seed} append-after-trim`).toEqual(normBase(buildBaseItems(next, commands)));
    }
  });

  it('TodoWrite → 계획 아이템으로 승격되고 짝 tool_result 는 별도 줄이 되지 않는다', () => {
    const events: SubAgentStreamEvent[] = [
      { id: 'p1', subAgentId: 'S', parentAgentId: 'P', timestamp: 100, eventType: 'tool_use', toolName: 'TodoWrite', content: JSON.stringify({ todos: [{ content: '첫 단계', status: 'in_progress' }, { content: '둘째', status: 'pending' }] }) },
      { id: 'p2', subAgentId: 'S', parentAgentId: 'P', timestamp: 101, eventType: 'tool_result', toolName: 'TodoWrite', content: 'Todos have been modified' },
    ];
    const full = buildBaseItems(events, []);
    expect(full.items.map((i) => i.kind)).toEqual(['plan']);
    const planItem = full.items[0]!;
    expect(planItem.kind === 'plan' && planItem.todos).toHaveLength(2);
    const parser = new IncrementalStreamParser();
    expect(normBase(parser.sync(events, []))).toEqual(normBase(full));
  });

  it('TodoWrite 입력이 계획 형식이 아니면 일반 도구 상자로 폴백한다', () => {
    const events: SubAgentStreamEvent[] = [
      { id: 'p1', subAgentId: 'S', parentAgentId: 'P', timestamp: 100, eventType: 'tool_use', toolName: 'TodoWrite', content: '{"unexpected":1}' },
      { id: 'p2', subAgentId: 'S', parentAgentId: 'P', timestamp: 101, eventType: 'tool_result', toolName: 'TodoWrite', content: 'ok' },
    ];
    const full = buildBaseItems(events, []);
    expect(full.items.map((i) => i.kind)).toEqual(['tool']);
    const parser = new IncrementalStreamParser();
    expect(normBase(parser.sync(events, []))).toEqual(normBase(full));
  });

  it('§5.5 #17-15 — thinking 이벤트는 아이템을 만들지 않는다(어느 밀도에도 사고 블록이 없다)', () => {
    const events: SubAgentStreamEvent[] = [
      { id: 'a', subAgentId: 'S', parentAgentId: 'P', timestamp: 100, eventType: 'text', content: '앞' },
      { id: 'b', subAgentId: 'S', parentAgentId: 'P', timestamp: 101, eventType: 'thinking', content: '한참 생각한 내용' },
      { id: 'c', subAgentId: 'S', parentAgentId: 'P', timestamp: 102, eventType: 'text', content: '뒤' },
    ];
    const full = buildBaseItems(events, []);
    // 사고는 아이템이 되지 않고, 본문 어디에도 사고 원문이 남지 않는다.
    expect(full.items.map((i) => i.kind)).toEqual(['text', 'text']);
    expect(JSON.stringify(full.items)).not.toContain('한참 생각한 내용');
    // 다만 텍스트 런의 경계로는 남는다 — 앞뒤 설명이 한 말풍선으로 합쳐지지 않는다.
    expect(full.items.map((i) => (i.kind === 'text' ? i.content : ''))).toEqual(['앞', '뒤']);
    expect(normBase(new IncrementalStreamParser().sync(events, []))).toEqual(normBase(full));
  });

  it('§5.5 #17-15 — 사고를 스트리밍하는 동안 라이브 1줄이 켜지고, 출력이 시작되면 사라진다', () => {
    const busy = [{ id: 'c1', text: 'go', status: 'executing', timestamp: 1 }] as unknown as QueuedCommand[];
    const thinkingNow: SubAgentStreamEvent[] = [
      { id: 'a', subAgentId: 'S', parentAgentId: 'P', timestamp: 100, eventType: 'text', content: '앞' },
      { id: 'b', subAgentId: 'S', parentAgentId: 'P', timestamp: 101, eventType: 'thinking', content: '생각 중…' },
    ];
    const live = buildBaseItems(thinkingNow, busy);
    expect(live.thinkingLive).not.toBeNull();
    const merged = mergeCardsIntoItems(live, busy);
    expect(merged[merged.length - 1]!.kind).toBe('thinking-live');

    // 사고 뒤에 출력이 오면 = 생각이 끝난 것 → 라이브 1줄도 사라진다(나왔다가 사라지는 이펙트).
    const done = buildBaseItems([...thinkingNow, { id: 'c', subAgentId: 'S', parentAgentId: 'P', timestamp: 102, eventType: 'text', content: '답' }], busy);
    expect(done.thinkingLive).toBeNull();
    expect(mergeCardsIntoItems(done, busy).some((i) => i.kind === 'thinking-live')).toBe(false);
  });

  it('§5.5 #17-15 — 에이전트가 멈춰 있으면 사고 이벤트가 마지막이어도 라이브 1줄은 안 뜬다', () => {
    const events: SubAgentStreamEvent[] = [
      { id: 'a', subAgentId: 'S', parentAgentId: 'P', timestamp: 100, eventType: 'thinking', content: '생각' },
    ];
    expect(buildBaseItems(events, []).thinkingLive).toBeNull();
    // SDK 펄스(thinking_tokens)는 종전대로 작동 중일 때 라이브 1줄을 켠다.
    const busy = [{ id: 'c1', text: 'go', status: 'executing', timestamp: 1 }] as unknown as QueuedCommand[];
    const pulse: SubAgentStreamEvent[] = [
      { id: 'p', subAgentId: 'S', parentAgentId: 'P', timestamp: 100, eventType: 'system', content: '[thinking_tokens]' },
    ];
    expect(buildBaseItems(pulse, busy).thinkingLive).not.toBeNull();
  });

  it('폴백: 세션 교체(완전히 다른 배열) 후에도 == 전체', () => {
    const rnd = mulberry32(999);
    const a = genEvents(rnd, 40);
    const b = genEvents(rnd, 40).map((e, i) => ({ ...e, id: `b${i}` }));
    const parser = new IncrementalStreamParser();
    parser.sync(a, []);
    const inc = parser.sync(b, []);
    expect(normBase(inc)).toEqual(normBase(buildBaseItems(b, [])));
  });
});
