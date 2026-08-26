/**
 * §4 (스트림 3종 ①) — **중첩 서브에이전트가 한 말이 부모 말과 섞이지 않는가.**
 *
 * 전달을 켜는 순간 자식의 말이 부모 스트림에 그대로 흘러든다. 우리 말풍선은 연속된 text 를 하나로
 * 합치므로, 주인을 따지지 않으면 자식이 한 말과 부모가 한 말이 **한 덩어리**가 되어 "누가 한 말인지"가
 * 사라진다 — 화면상 아무 오류도 안 나면서 대화록만 조용히 뒤섞이는 종류의 사고다.
 *
 * 전량 빌더(`buildBaseItems`)와 증분 빌더(`IncrementalStreamParser`)가 **같은 결과**를 내야 하므로
 * 두 경로를 나란히 검사한다 — 한쪽만 고치면 여기서 걸린다.
 */
import { describe, it, expect } from 'vitest';
import type { SubAgentStreamEvent } from '@vibisual/shared';
import { buildBaseItems, IncrementalStreamParser } from './streamItems';
import { applyStreamDensity } from './streamDensity';

let seq = 0;
const evt = (
  eventType: SubAgentStreamEvent['eventType'],
  content: string,
  extra: Partial<SubAgentStreamEvent> = {},
): SubAgentStreamEvent => ({
  id: `e${++seq}`,
  subAgentId: 'sub-1',
  parentAgentId: 'agent-1',
  timestamp: 1000 + seq,
  eventType,
  content,
  ...extra,
});

/** 두 빌더의 결과를 같은 모양으로 뽑는다. */
const bothWays = (events: SubAgentStreamEvent[]) => ({
  full: buildBaseItems(events, []).items,
  incremental: new IncrementalStreamParser().sync(events, []).items,
});

describe('중첩 서브에이전트 말풍선 분리', () => {
  it('부모 말과 자식 말이 한 덩어리로 붙지 않는다', () => {
    const events = [
      evt('text', '자식을 부르겠습니다'),
      evt('text', 'PONG', { nestedUnderToolUseId: 'toolu_p' }),
      evt('text', '끝났습니다'),
    ];
    for (const [label, items] of Object.entries(bothWays(events))) {
      const texts = items.filter((i) => i.kind === 'text');
      expect(texts, label).toHaveLength(3);
      expect(texts.map((t) => (t as { content: string }).content), label)
        .toEqual(['자식을 부르겠습니다', 'PONG', '끝났습니다']);
    }
  });

  it('같은 주인끼리는 종전처럼 한 말풍선으로 합쳐진다', () => {
    const events = [
      evt('text', 'PO', { nestedUnderToolUseId: 'toolu_p' }),
      evt('text', 'NG', { nestedUnderToolUseId: 'toolu_p' }),
    ];
    for (const [label, items] of Object.entries(bothWays(events))) {
      const texts = items.filter((i) => i.kind === 'text');
      expect(texts, label).toHaveLength(1);
      expect((texts[0] as { content: string }).content, label).toBe('PONG');
      expect((texts[0] as { nestedUnderToolUseId?: string }).nestedUnderToolUseId, label).toBe('toolu_p');
    }
  });

  it('주인이 다른 두 자식도 서로 섞이지 않는다', () => {
    const events = [
      evt('text', 'A', { nestedUnderToolUseId: 'toolu_a' }),
      evt('text', 'B', { nestedUnderToolUseId: 'toolu_b' }),
    ];
    for (const [label, items] of Object.entries(bothWays(events))) {
      expect(items.filter((i) => i.kind === 'text'), label).toHaveLength(2);
    }
  });

  it('표식이 없으면 종전과 완전히 같다 — 켜지 않은 사람의 화면은 안 변한다', () => {
    const events = [evt('text', '가'), evt('text', '나')];
    for (const [label, items] of Object.entries(bothWays(events))) {
      const texts = items.filter((i) => i.kind === 'text');
      expect(texts, label).toHaveLength(1);
      expect((texts[0] as { content: string }).content, label).toBe('가나');
      expect((texts[0] as { nestedUnderToolUseId?: string }).nestedUnderToolUseId, label).toBeUndefined();
    }
  });
});

describe('중첩 도구 묶기', () => {
  it('부모가 부른 도구와 자식이 부른 도구는 한 묶음이 되지 않는다', () => {
    const events = [
      evt('tool_use', 'a.ts', { toolName: 'Read', toolUseId: 'p1' }),
      evt('tool_use', 'b.ts', { toolName: 'Read', toolUseId: 'c1', nestedUnderToolUseId: 'toolu_p' }),
    ];
    const items = applyStreamDensity(buildBaseItems(events, []).items, 'standard');
    const groups = items.filter((i) => i.kind === 'toolgroup');
    expect(groups).toHaveLength(2);
    expect((groups[0] as { nestedUnderToolUseId?: string }).nestedUnderToolUseId).toBeUndefined();
    expect((groups[1] as { nestedUnderToolUseId?: string }).nestedUnderToolUseId).toBe('toolu_p');
  });

  it('같은 주인의 연속 도구는 종전처럼 하나로 묶인다', () => {
    const events = [
      evt('tool_use', 'a.ts', { toolName: 'Read', toolUseId: 'c1', nestedUnderToolUseId: 'toolu_p' }),
      evt('tool_use', 'b.ts', { toolName: 'Read', toolUseId: 'c2', nestedUnderToolUseId: 'toolu_p' }),
    ];
    const items = applyStreamDensity(buildBaseItems(events, []).items, 'standard');
    const groups = items.filter((i) => i.kind === 'toolgroup');
    expect(groups).toHaveLength(1);
    expect((groups[0] as { toolCount: number }).toolCount).toBe(2);
  });
});
