/**
 * streamItems.test.ts — 증분 파서(IncrementalStreamParser)가 전체 재구축(buildBaseItems)과
 * **항상 동일한 결과**를 내는지 랜덤 시퀀스로 못박는다. Electron 앱 없이 파싱 정확성 검증.
 *
 * 검증 축:
 *  1) 임의 이벤트/명령 시퀀스를 임의 청크로 흘려 넣으며, 매 prefix 마다 증분 == 전체.
 *  2) 폴백 경로 — commands 변경 / 앞쪽 절단(trim) / 세션 교체 시 리셋 후에도 == 전체.
 */
import { describe, it, expect } from 'vitest';
import type { QueuedCommand, SubAgentStreamEvent, AgentReport, AgentList } from '@vibisual/shared';
import { buildBaseItems, IncrementalStreamParser, mergeCardsIntoItems, isHiddenSystem, type StreamItemFull, type BaseItemsResult } from './streamItems.js';

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

type EvtType = 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'result' | 'error' | 'system' | 'pulse' | 'hidden';
const EVT_TYPES: EvtType[] = ['text', 'thinking', 'tool_use', 'tool_result', 'result', 'error', 'system', 'pulse', 'hidden'];
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
      // §5.5 #17-39 — 사고 길이를 문턱 양쪽으로 섞는다. 짧기만 하면 자국이 한 번도 안 생겨
      //   `step` 항목의 증분/전체 등가성이 **한 번도 검증되지 않는다**(구멍이 조용히 열린다).
      case 'thinking': out.push({ ...base, eventType: 'thinking', content: rnd() < 0.5 ? `k${i}_${Math.floor(rnd() * 100)}` : 'k'.repeat(120) }); break;
      case 'tool_use': {
        const toolName = TOOLS[Math.floor(rnd() * TOOLS.length)]!;
        const content = toolName === 'TodoWrite' ? todoInput(rnd, i) : `in${i}`;
        out.push({ ...base, eventType: 'tool_use', toolName, content });
        break;
      }
      case 'tool_result': out.push({ ...base, eventType: 'tool_result', toolName: TOOLS[Math.floor(rnd() * TOOLS.length)]!, content: `out${i}` }); break;
      case 'result': out.push({ ...base, eventType: 'result', content: `r${i}` }); break;
      // §5.5 #17-12 ③ — 실패 사유 줄도 두 파서가 같은 항목으로 만들어야 한다(전용 kind 라 대칭이 깨지기 쉽다).
      case 'error': out.push({ ...base, eventType: 'error', content: `[exit:${i % 3}] boom${i}` }); break;
      case 'system': out.push({ ...base, eventType: 'system', content: rnd() < 0.5 ? `[task_started]` : `plain${i}` }); break;
      case 'pulse': out.push({ ...base, eventType: 'system', content: `[thinking_tokens]` }); break;
      // §5.5 #17-13 ⑤-4 — 숨김은 `status` 뿐 아니라 살림성 통지(`*_changed`)도 포함한다.
      case 'hidden': out.push({ ...base, eventType: 'system', content: rnd() < 0.5 ? `[status]` : `[commands_changed]` }); break;
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
      // §5.5 #17-18 ⑥ — 절반은 "큐에 넣은 뒤 한참 있다 나간" 명령(경계가 timestamp 와 다르다).
      startedAt: rnd() < 0.5 ? ts + Math.floor(rnd() * 30) : undefined,
      result: rnd() < 0.5 ? `res${i}` : undefined,
      error: rnd() < 0.3 ? { code: 'exit' as const, exitCode: 1, detail: `err${i}` } : undefined,
    } as QueuedCommand);
  }
  return cmds;
}

/** 렌더에 영향 주는 필드만 뽑아 비교 가능한 평문으로. */
function normItem(it: StreamItemFull): unknown {
  switch (it.kind) {
    // §5.5 #17-39 — 본문의 끝 시각(작성 자국)도 렌더에 쓰이므로 등가성 비교에 넣는다.
    case 'text': return { k: 'text', id: it.id, c: it.content, ts: it.timestamp, end: it.endedAt };
    case 'system': case 'result': case 'error': return { k: it.kind, id: it.id, c: it.content, ts: it.timestamp };
    case 'tool': return { k: 'tool', id: it.id, n: it.toolName, in: it.input, out: it.output, a: it.isActive, ts: it.timestamp };
    case 'command': return { k: 'command', id: it.id, p: it.prompt, r: it.result, s: it.status, e: it.error, ts: it.timestamp };
    case 'thinking-live': return { k: 'thinking-live', id: it.id, m: it.mode, ts: it.timestamp };
    case 'plan': return { k: 'plan', id: it.id, todos: it.todos, sup: !!it.superseded, ts: it.timestamp };
    // §5.5 #17-39 — 자국은 시간·분량이 전부다. 한 필드라도 빼면 두 파서가 어긋나도 통과한다.
    case 'step': return { k: 'step', id: it.id, ph: it.phase, ts: it.timestamp, end: it.endedAt, ch: it.chars };
    default: return { k: it.kind, id: it.id, ts: it.timestamp };
  }
}
function normBase(b: BaseItemsResult): unknown {
  return {
    items: b.items.map(normItem),
    agentBusy: b.agentBusy,
    live: b.thinkingLive ? { id: b.thinkingLive.id, m: b.thinkingLive.mode, ts: b.thinkingLive.timestamp } : null,
  };
}

describe('IncrementalStreamParser === buildBaseItems', () => {
  it('매 prefix 마다 증분 == 전체 (랜덤 시퀀스 × 청크)', () => {
    // §5.5 #17-39 — 자국 항목이 실제로 만들어진 횟수. 0 이면 위 등가성이 자국을 **한 번도 안 본** 것이라
    //   구멍이 조용히 열린다(생성기의 사고 길이가 문턱 아래로 내려가면 그렇게 된다).
    let stepsSeen = 0;
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
        if (consumed === events.length) stepsSeen += full.items.filter((i) => i.kind === 'step').length;
      }
    }
    expect(stepsSeen, '랜덤 시퀀스가 자국을 한 번도 만들지 않았다 — 등가성이 step 을 검증하지 못한다').toBeGreaterThan(0);
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

  it('§5.5 #17-39 — 봉인된 긴 사고 런은 그 자리에 **자국 한 줄**을 남긴다(원문은 여전히 없다)', () => {
    const events: SubAgentStreamEvent[] = [
      { id: 'a', subAgentId: 'S', parentAgentId: 'P', timestamp: 1_000, eventType: 'text', content: '앞' },
      { id: 'b', subAgentId: 'S', parentAgentId: 'P', timestamp: 2_000, eventType: 'thinking', content: '한참 생각한 내용'.repeat(20) },
      { id: 'b2', subAgentId: 'S', parentAgentId: 'P', timestamp: 75_000, eventType: 'thinking', content: '더 생각' },
      { id: 'c', subAgentId: 'S', parentAgentId: 'P', timestamp: 76_000, eventType: 'text', content: '뒤' },
    ];
    const full = buildBaseItems(events, []);
    expect(full.items.map((i) => i.kind)).toEqual(['text', 'step', 'text']);
    const step = full.items[1]!;
    expect(step.kind === 'step' && step.timestamp).toBe(2_000);
    expect(step.kind === 'step' && step.endedAt).toBe(75_000);   // 걸린 시간 = 1분 13초
    expect(step.kind === 'step' && step.chars).toBe('한참 생각한 내용'.repeat(20).length + '더 생각'.length);
    // 자국이 생겨도 **사고 원문은 어디에도 남지 않는다**(#17-15 ② 불변).
    expect(JSON.stringify(full.items)).not.toContain('한참 생각한 내용');
    expect(normBase(new IncrementalStreamParser().sync(events, []))).toEqual(normBase(full));
  });

  it('§5.5 #17-39 — 아직 안 끝난 사고 런은 자국이 되지 않는다(자라는 자국 ❌)', () => {
    const open: SubAgentStreamEvent[] = [
      { id: 'a', subAgentId: 'S', parentAgentId: 'P', timestamp: 1_000, eventType: 'text', content: '앞' },
      { id: 'b', subAgentId: 'S', parentAgentId: 'P', timestamp: 2_000, eventType: 'thinking', content: 'z'.repeat(500) },
    ];
    expect(buildBaseItems(open, []).items.map((i) => i.kind)).toEqual(['text']);
    // 뒤이어 무엇이든 오는 순간 자국이 선다 — 그 시각이 곧 끝난 시각이다.
    const sealed = [...open, { id: 'c', subAgentId: 'S', parentAgentId: 'P', timestamp: 9_000, eventType: 'tool_use', toolName: 'Read', content: 'in' } as SubAgentStreamEvent];
    expect(buildBaseItems(sealed, []).items.map((i) => i.kind)).toEqual(['text', 'step', 'tool']);
    // 증분도 같은 순간에 같은 자국을 만든다(한쪽만 봉인하면 화면이 갈린다).
    const parser = new IncrementalStreamParser();
    parser.sync(open, []);
    expect(normBase(parser.sync(sealed, []))).toEqual(normBase(buildBaseItems(sealed, [])));
  });

  it('§5.5 #17-39 — 주인이 바뀌면 사고 런을 끊는다(부모 + 중첩 Task 를 한 덩어리로 재지 않는다)', () => {
    const events: SubAgentStreamEvent[] = [
      { id: 'p1', subAgentId: 'S', parentAgentId: 'P', timestamp: 1_000, eventType: 'thinking', content: 'p'.repeat(200) },
      { id: 'n1', subAgentId: 'S', parentAgentId: 'P', timestamp: 40_000, eventType: 'thinking', content: 'n'.repeat(200), nestedUnderToolUseId: 'task-1' },
      { id: 'z', subAgentId: 'S', parentAgentId: 'P', timestamp: 41_000, eventType: 'text', content: '끝' },
    ];
    const full = buildBaseItems(events, []);
    expect(full.items.map((i) => i.kind)).toEqual(['step', 'step', 'text']);
    const steps = full.items.filter((i) => i.kind === 'step');
    // 부모의 사고는 1,000 에 열려 1,000 에 닫힌다 — 자식이 생각한 40초가 부모 앞으로 달리지 않는다.
    expect(steps.map((i) => [i.timestamp, i.endedAt, i.chars])).toEqual([
      [1_000, 1_000, 200],
      [40_000, 40_000, 200],
    ]);
    expect(normBase(new IncrementalStreamParser().sync(events, []))).toEqual(normBase(full));
  });

  it('§5.5 #17-39 — 본문 말풍선은 마지막 델타 시각을 든다(작성 자국의 걸린 시간)', () => {
    const events: SubAgentStreamEvent[] = [
      { id: 'a', subAgentId: 'S', parentAgentId: 'P', timestamp: 1_000, eventType: 'text', content: '앞' },
      { id: 'b', subAgentId: 'S', parentAgentId: 'P', timestamp: 22_000, eventType: 'text', content: '뒤' },
    ];
    const full = buildBaseItems(events, []);
    const txt = full.items[0]!;
    expect(txt.kind === 'text' && txt.timestamp).toBe(1_000);
    expect(txt.kind === 'text' && txt.endedAt).toBe(22_000);
    expect(normBase(new IncrementalStreamParser().sync(events, []))).toEqual(normBase(full));
  });

  it('§5.5 #17-24 ② — 라이브 1줄은 작동 중 내내 떠 있고, 이벤트 종류는 라벨(mode)만 고른다', () => {
    const busy = [{ id: 'c1', text: 'go', status: 'executing', timestamp: 1 }] as unknown as QueuedCommand[];
    const thinkingNow: SubAgentStreamEvent[] = [
      { id: 'a', subAgentId: 'S', parentAgentId: 'P', timestamp: 100, eventType: 'text', content: '앞' },
      { id: 'b', subAgentId: 'S', parentAgentId: 'P', timestamp: 101, eventType: 'thinking', content: '생각 중…' },
    ];
    const live = buildBaseItems(thinkingNow, busy);
    expect(live.thinkingLive?.mode).toBe('thinking');
    const merged = mergeCardsIntoItems(live, busy);
    expect(merged[merged.length - 1]!.kind).toBe('thinking-live');

    // 사고 뒤에 출력이 와도 줄은 그대로 있고 라벨만 `작업 중` 으로 바뀐다(깜빡임 제거 — #17-24 ②).
    const done = buildBaseItems([...thinkingNow, { id: 'c', subAgentId: 'S', parentAgentId: 'P', timestamp: 102, eventType: 'text', content: '답' }], busy);
    expect(done.thinkingLive?.mode).toBe('working');
    expect(done.thinkingLive?.id).toBe(live.thinkingLive?.id); // 항목 id 고정 → remount ❌
    expect(mergeCardsIntoItems(done, busy).some((i) => i.kind === 'thinking-live')).toBe(true);
  });

  it('§5.5 #17-24 ② — 에이전트가 멈춰 있으면(작동 중 아님) 라이브 1줄은 안 뜬다', () => {
    const events: SubAgentStreamEvent[] = [
      { id: 'a', subAgentId: 'S', parentAgentId: 'P', timestamp: 100, eventType: 'thinking', content: '생각' },
    ];
    expect(buildBaseItems(events, []).thinkingLive).toBeNull();
    // 작동 중이면 이벤트가 아직 하나도 없어도(스폰 직후) `작업 중` 으로 켜진다.
    const busy = [{ id: 'c1', text: 'go', status: 'executing', timestamp: 1 }] as unknown as QueuedCommand[];
    expect(buildBaseItems([], busy).thinkingLive?.mode).toBe('working');
    // SDK 펄스(thinking_tokens)는 종전대로 `생각 중` 라벨.
    const pulse: SubAgentStreamEvent[] = [
      { id: 'p', subAgentId: 'S', parentAgentId: 'P', timestamp: 100, eventType: 'system', content: '[thinking_tokens]' },
    ];
    expect(buildBaseItems(pulse, busy).thinkingLive?.mode).toBe('thinking');
  });

  // ─── §5.5 #17-18 ⑥ 덧말 말풍선의 자리 ───
  //   대기 중엔 꼬리(계속 아래로 밀린다), dispatch 되는 순간 그 시각에 고정 = 턴 경계선.

  const txt = (id: string, ts: number, content: string): SubAgentStreamEvent =>
    ({ id, subAgentId: 'S', parentAgentId: 'P', timestamp: ts, eventType: 'text', content });
  const mkCmd = (over: Partial<QueuedCommand>): QueuedCommand =>
    ({ id: 'c', text: 'go', status: 'completed', timestamp: 0, subAgentId: 'S', ...over } as QueuedCommand);
  const idsOf = (items: StreamItemFull[]): string[] => items.map((i) => i.id);

  it('§5.5 #17-18 ⑥-1 — 대기 중 말풍선은 정렬 밖에서 맨 끝(라이브 1줄보다도 아래)에 선다', () => {
    const events = [txt('a', 100, '앞'), txt('b', 300, '뒤')];
    const commands = [
      mkCmd({ id: 'run', status: 'executing', timestamp: 90, startedAt: 90 }),
      mkCmd({ id: 'q', status: 'queued', timestamp: 200 }), // 도는 턴 한가운데서 넣은 덧말
    ];
    const items = mergeCardsIntoItems(buildBaseItems(events, commands), commands);
    expect(items[items.length - 1]!.id).toBe('cmd-q');
    expect(items[items.length - 2]!.kind).toBe('thinking-live');
    // 아직 아무것도 안 끊었으므로 본문 런도 가르지 않는다(앞뒤가 한 말풍선).
    expect(items.filter((i) => i.kind === 'text')).toHaveLength(1);
  });

  it('§5.5 #17-18 ⑥-2 — dispatch 시각에 자리를 고정한다(이전 출력은 위, 이후 출력은 아래)', () => {
    const events = [txt('a', 100, '앞 턴 출력'), txt('b', 300, '이 덧말의 출력')];
    const commands = [
      mkCmd({ id: 'prev', status: 'completed', timestamp: 50, startedAt: 50 }),
      // 앞 턴 도중(120)에 넣어 뒀다가 200 에 나간 덧말 — 종전엔 120 자리에 앉아 경계가 어긋났다.
      mkCmd({ id: 'follow', status: 'executing', timestamp: 120, startedAt: 200 }),
    ];
    const items = mergeCardsIntoItems(buildBaseItems(events, commands), commands);
    expect(idsOf(items.filter((i) => i.kind !== 'thinking-live')))
      .toEqual(['cmd-prev', 'a', 'cmd-follow', 'b']);
  });

  it('§5.5 #17-18 ⑥-4 — startedAt 이 없는 옛 명령은 종전대로 큐 투입 시각으로 정렬한다', () => {
    const events = [txt('a', 100, 'x'), txt('b', 300, 'y')];
    const commands = [mkCmd({ id: 'old', status: 'completed', timestamp: 200 })];
    const items = mergeCardsIntoItems(buildBaseItems(events, commands), commands);
    expect(idsOf(items)).toEqual(['a', 'cmd-old', 'b']);
  });

  // ─── §5.5 #17-18 ⑥-5 — 앱이 내려갔다 재개한 명령 ───
  //   2026-08-26 사용자 보고: "강제 종료 후 멈춰있던 에이전트를 다시 열었는데 내가 명령 내린 텍스트가
  //   아래로 내려와 있다". 재개는 그 명령을 `queued` 로 되돌리므로, "queued = 아직 안 나갔다" 로만
  //   읽으면 이미 출력을 한참 뱉어 놓은 말풍선이 화면 꼬리로 끌려간다.

  /** 텍스트 런을 끊어 두 출력이 한 말풍선으로 합쳐지지 않게 하는 사이 줄. */
  const sysLine = (id: string, ts: number, content: string): SubAgentStreamEvent =>
    ({ id, subAgentId: 'S', parentAgentId: 'P', timestamp: ts, eventType: 'system', content });

  it('§5.5 #17-18 ⑥-5 — 재개 대기(queued)로 돌아가도 이미 나간 말풍선은 꼬리로 끌려가지 않는다', () => {
    const events = [txt('a', 100, '끊기기 전 출력'), sysLine('s', 300, '끊김')];
    const commands = [
      // 50 에 나가서 출력을 뱉다가 앱이 죽었고, 부팅 reconcile 이 재개하려고 큐로 되돌린 명령.
      mkCmd({ id: 'resumed', status: 'queued', timestamp: 40, startedAt: 50, restartResumed: true }),
    ];
    const items = mergeCardsIntoItems(buildBaseItems(events, commands), commands);
    // 종전에는 이 말풍선이 정렬 밖 꼬리로 빠져 자기 출력 **아래**에 섰다.
    expect(idsOf(items.filter((i) => i.kind !== 'thinking-live')))
      .toEqual(['cmd-resumed', 'a', 's']);
  });

  it('§5.5 #17-18 ⑥-5 — 재개된 뒤 새로 나오는 출력도 그 말풍선 아래에 이어 쌓인다', () => {
    // 끊기기 전 출력(100)과 재개 후 출력(5000) 사이에 서버는 startedAt 을 다시 찍지 않는다.
    const events = [txt('a', 100, '끊기기 전'), sysLine('s', 4_000, '재개'), txt('b', 5_000, '재개 후')];
    const commands = [
      mkCmd({ id: 'resumed', status: 'executing', timestamp: 40, startedAt: 50, restartResumed: true }),
    ];
    const items = mergeCardsIntoItems(buildBaseItems(events, commands), commands);
    expect(idsOf(items.filter((i) => i.kind !== 'thinking-live')))
      .toEqual(['cmd-resumed', 'a', 's', 'b']);
  });

  it('§5.5 #17-18 ⑥-5 — 재개 대기 명령도 턴 경계로 센다(본문 런이 그 자리에서 갈린다)', () => {
    const events = [txt('a', 100, '앞 턴'), txt('b', 300, '재개된 턴')];
    const commands = [
      mkCmd({ id: 'prev', status: 'completed', timestamp: 50, startedAt: 50 }),
      mkCmd({ id: 'resumed', status: 'queued', timestamp: 120, startedAt: 200, restartResumed: true }),
    ];
    const items = mergeCardsIntoItems(buildBaseItems(events, commands), commands);
    expect(idsOf(items.filter((i) => i.kind !== 'thinking-live')))
      .toEqual(['cmd-prev', 'a', 'cmd-resumed', 'b']);
    expect(items.filter((i) => i.kind === 'text')).toHaveLength(2);
  });

  it('§5.5 #17-18 ⑥-5 — 한 번도 안 나간 덧말은 종전대로 꼬리다(재개 예외가 새 덧말까지 끌어올리지 않는다)', () => {
    const events = [txt('a', 100, '출력')];
    const commands = [
      mkCmd({ id: 'resumed', status: 'queued', timestamp: 40, startedAt: 50, restartResumed: true }),
      mkCmd({ id: 'fresh', status: 'queued', timestamp: 200 }), // startedAt 없음 = 아직 안 나갔다
    ];
    const items = mergeCardsIntoItems(buildBaseItems(events, commands), commands);
    expect(items[items.length - 1]!.id).toBe('cmd-fresh');
    expect(idsOf(items.filter((i) => i.kind !== 'thinking-live')))
      .toEqual(['cmd-resumed', 'a', 'cmd-fresh']);
  });

  it('§5.5 #17-18 ⑥-3 — 카드는 dispatch 시각을 턴 끝으로 삼고, 대기 말풍선보다 위에 선다', () => {
    const events = [txt('a', 100, '앞 턴')];
    const commands = [
      mkCmd({ id: 'prev', status: 'completed', timestamp: 50, startedAt: 50 }),
      mkCmd({ id: 'q', status: 'queued', timestamp: 120 }),
    ];
    const report = { id: 'r1', agentId: 'P', subAgentId: 'S', createdAt: 110, did: ['했다'], userActions: [] };
    const items = mergeCardsIntoItems(buildBaseItems(events, commands), commands, [report as unknown as AgentReport]);
    const ids = idsOf(items);
    expect(ids.indexOf('report-r1')).toBeGreaterThan(ids.indexOf('a'));
    expect(ids.indexOf('report-r1')).toBeLessThan(ids.indexOf('cmd-q'));
    expect(ids[ids.length - 1]).toBe('cmd-q');
  });

  // §5.5 #17-18 ⑦ — 카드의 자리. 옛 `turnEndSortTs` 는 도는 턴에 뒤에 올 명령이 없어 MAX_SAFE_INTEGER 로
  //   떨어졌고, 그래서 카드가 화면 바닥에 붙박여 **이후 출력이 전부 카드 위로** 들어갔다.
  const toolUse = (id: string, ts: number): SubAgentStreamEvent =>
    ({ id, subAgentId: 'S', parentAgentId: 'P', timestamp: ts, eventType: 'tool_use', content: '{}', toolName: 'Read' } as SubAgentStreamEvent);
  const mkList = (createdAt: number): AgentList =>
    ({ id: 'l1', agentId: 'P', subAgentId: 'S', createdAt, items: ['하나', '둘'] } as unknown as AgentList);

  it('§5.5 #17-18 ⑦-1 — 카드는 신고된 그 자리에 못 박히고, 그 뒤 출력은 카드 아래로 쌓인다', () => {
    const events = [txt('a', 100, '카드 앞'), toolUse('t', 300)];
    const commands = [mkCmd({ id: 'run', status: 'executing', timestamp: 50, startedAt: 50 })];
    const items = mergeCardsIntoItems(buildBaseItems(events, commands), commands, undefined, undefined, undefined, [mkList(200)]);
    const ids = idsOf(items);
    const cardIdx = ids.indexOf('list-l1');
    expect(cardIdx).toBeGreaterThan(ids.indexOf('a'));
    // 카드보다 **뒤에** 온 도구 출력은 카드 아래에 온다(종전엔 카드가 맨 아래라 위로 들어갔다).
    expect(items.findIndex((i) => i.kind === 'tool')).toBeGreaterThan(cardIdx);
    // ⑦-2 — 그 턴이 아직 도는 중이면 `작업 중` 배지가 붙는다(끝난 줄 착각 방지).
    expect(items[cardIdx]).toMatchObject({ live: true });
  });

  it('§5.5 #17-18 ⑦-2 — 턴이 끝나면(실행 중인 명령 없음) `작업 중` 배지는 사라진다', () => {
    const commands = [mkCmd({ id: 'run', status: 'completed', timestamp: 50, startedAt: 50 })];
    const items = mergeCardsIntoItems(buildBaseItems([txt('a', 100, 'x')], commands), commands, undefined, undefined, undefined, [mkList(200)]);
    expect(items.find((i) => i.id === 'list-l1')).toMatchObject({ live: false });
  });

  it('§5.5 #17-18 ⑦-1 — 다음 턴이 와도 카드는 그 자리에 그대로 있다(위로 밀려 올라가지 않는다)', () => {
    const events = [txt('a', 100, '앞 턴'), txt('b', 400, '다음 턴')];
    const commands = [
      mkCmd({ id: 'prev', status: 'completed', timestamp: 50, startedAt: 50 }),
      mkCmd({ id: 'next', status: 'executing', timestamp: 300, startedAt: 300 }),
    ];
    const items = mergeCardsIntoItems(buildBaseItems(events, commands), commands, undefined, undefined, undefined, [mkList(200)]);
    expect(idsOf(items.filter((i) => i.kind !== 'thinking-live')))
      .toEqual(['cmd-prev', 'a', 'list-l1', 'cmd-next', 'b']);
    // 앞 턴에서 나온 카드는 지금 도는 턴의 것이 아니므로 배지가 없다.
    expect(items.find((i) => i.id === 'list-l1')).toMatchObject({ live: false });
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

// §5.5 #17-13 ⑤-4 — "명령 목록 변경" 같은 살림성 칩은 어느 밀도에서도 안 그린다.
describe('isHiddenSystem — 살림성 통지는 항목이 되지 않는다', () => {
  const sys = (content: string): SubAgentStreamEvent => ({
    id: 'x', subAgentId: 'S', parentAgentId: 'P', timestamp: 1, eventType: 'system', content,
  });

  it('`status` 와 `*_changed` 는 숨긴다 — 이름을 모르는 새 살림성 칩도 어미로 걸린다', () => {
    for (const c of ['[status]', '[commands_changed]', '[background_tasks_changed]', '[mcp_servers_changed]']) {
      expect(isHiddenSystem(sys(c))).toBe(true);
    }
  });

  // §5.5 #17-13 ⑤-5 — 이미 `task_started` 로 한 줄을 차지한 작업의 심장박동이라 겹겹이 쌓이기만 했다.
  it('작업 심장박동(`task_progress`)도 숨긴다 — 작업 줄은 ⑤-3 의 한 줄이 이미 보여준다', () => {
    expect(isHiddenSystem(sys('[task_progress]'))).toBe(true);
  });

  it('뜻이 있는 칩과 내용 있는 system 본문은 그대로 남긴다', () => {
    for (const c of ['[task_started]', '[task_updated]', '[api_retry]', '[Bash] npm ERR!', '사용자가 Write 를 거부했습니다']) {
      expect(isHiddenSystem(sys(c))).toBe(false);
    }
  });

  it('숨김 칩은 두 파서 어디에서도 항목이 되지 않는다', () => {
    const events = [
      sys('[commands_changed]'),
      { id: 't', subAgentId: 'S', parentAgentId: 'P', timestamp: 2, eventType: 'text', content: '설명' } as SubAgentStreamEvent,
      { ...sys('[commands_changed]'), id: 'y', timestamp: 3 },
    ];
    const full = buildBaseItems(events, []);
    expect(full.items.some((it) => it.kind === 'system')).toBe(false);
    const parser = new IncrementalStreamParser();
    expect(normBase(parser.sync(events, []))).toEqual(normBase(full));
  });
});
