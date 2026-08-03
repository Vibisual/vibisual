import { describe, it, expect } from 'vitest';
import { applyStreamDensity, sameDisplayItem, type StreamToolGroup } from './streamDensity.js';
import type { StreamGroup, StreamItemFull, StreamPlan } from './streamItems.js';

function tool(id: string, toolName: string, isActive = false): StreamGroup {
  return { kind: 'tool', id, toolName, input: '{}', output: 'ok', timestamp: Number(id.replace(/\D/g, '')) || 1, isActive };
}
function text(id: string, content = 'hi'): StreamItemFull {
  return { kind: 'text', id, content, timestamp: 1 };
}
function system(id: string, content = '[task_started]'): StreamItemFull {
  return { kind: 'system', id, content, timestamp: 1 };
}
function plan(id: string, content: string): StreamPlan {
  return { kind: 'plan', id, todos: [{ content, status: 'in_progress' }], timestamp: 1 };
}
function command(id: string): StreamItemFull {
  return { kind: 'command', id, prompt: 'p', result: '', status: 'completed', timestamp: 1 };
}

describe('applyStreamDensity — 도구 실행 묶기', () => {
  it('연속 도구는 한 묶음으로 접힌다', () => {
    const items = [text('t1'), tool('a1', 'Read'), tool('a2', 'Read'), tool('a3', 'Read'), text('t2')];
    const out = applyStreamDensity(items, 'standard');
    expect(out.map((i) => i.kind)).toEqual(['text', 'toolgroup', 'text']);
    const group = out[1] as StreamToolGroup;
    expect(group.toolCount).toBe(3);
    expect(group.children).toHaveLength(3);
  });

  it('[회귀] 도구 이름이 달라도 끊지 않고 한 묶음으로 잇는다', () => {
    const out = applyStreamDensity([tool('a1', 'Bash'), tool('b1', 'Read'), tool('a2', 'Bash')], 'standard');
    expect(out).toHaveLength(1);
    const group = out[0] as StreamToolGroup;
    expect(group.toolCount).toBe(3);
    expect(group.toolNames).toEqual(['Bash', 'Read']);
  });

  it('[회귀] 사이에 낀 빈 줄·상태 칩·도구 출력 줄은 런을 끊지 않는다', () => {
    const items = [
      tool('a1', 'Bash'), system('s1'), text('e1', '   '), system('s2', '[Read] output'),
      tool('a2', 'Bash'), text('t1', '설명'),
    ];
    const out = applyStreamDensity(items, 'standard');
    expect(out.map((i) => i.kind)).toEqual(['toolgroup', 'text']);
    const group = out[0] as StreamToolGroup;
    expect(group.toolCount).toBe(2);
    // 상태 칩(s1)은 아예 걸러지고, 내용 있는 줄은 묶음 안에 원 순서로 보존된다.
    expect(group.children.map((c) => c.id)).toEqual(['a1', 'e1', 's2', 'a2']);
  });

  it('런 꼬리에 붙은 잡음은 묶음에 넣지 않는다(다음 대화의 머리)', () => {
    const out = applyStreamDensity(
      [tool('a1', 'Bash'), tool('a2', 'Bash'), text('e1', '  '), text('t1', '설명')],
      'standard',
    );
    expect(out.map((i) => i.kind)).toEqual(['toolgroup', 'text', 'text']);
    expect((out[0] as StreamToolGroup).children.map((c) => c.id)).toEqual(['a1', 'a2']);
  });

  it('내용 있는 텍스트는 런을 끊는다(대화는 잡음이 아니다)', () => {
    const out = applyStreamDensity([tool('a1', 'Read'), text('t1', '설명'), tool('a2', 'Read')], 'standard');
    expect(out.map((i) => i.kind)).toEqual(['toolgroup', 'text', 'toolgroup']);
    expect((out[0] as StreamToolGroup).children.map((c) => c.id)).toEqual(['a1']);
    expect((out[2] as StreamToolGroup).children.map((c) => c.id)).toEqual(['a2']);
  });

  it('[#17-16] 홑 도구도 처음부터 묶음 안에서 태어난다(문턱 없음)', () => {
    const out = applyStreamDensity([tool('a1', 'Read')], 'standard');
    expect(out.map((i) => i.kind)).toEqual(['toolgroup']);
    expect((out[0] as StreamToolGroup).toolCount).toBe(1);
  });

  it('[#17-16 회귀] 도구가 하나 늘어도 묶음 id 가 그대로다(상자 교체 = 화면 출렁임 없음)', () => {
    const one = applyStreamDensity([tool('a1', 'Bash')], 'standard')[0] as StreamToolGroup;
    const two = applyStreamDensity([tool('a1', 'Bash'), tool('a2', 'Read')], 'standard')[0] as StreamToolGroup;
    expect(one.id).toBe(two.id);
    expect(two.toolCount).toBe(2);
  });

  it('[#17-16] 진행 중 도구도 묶음 안으로 들어가고 묶음이 active 로 표시된다', () => {
    const out = applyStreamDensity([tool('a1', 'Read'), tool('a2', 'Read'), tool('a3', 'Read', true)], 'standard');
    expect(out.map((i) => i.kind)).toEqual(['toolgroup']);
    const group = out[0] as StreamToolGroup;
    expect(group.toolCount).toBe(3);
    expect(group.active).toBe(true);
    // 활성 도구가 완료돼도 같은 묶음·같은 id — 흡수로 인한 재배치가 없다.
    const done = applyStreamDensity([tool('a1', 'Read'), tool('a2', 'Read'), tool('a3', 'Read')], 'standard')[0] as StreamToolGroup;
    expect(done.id).toBe(group.id);
    expect(done.toolCount).toBe(3);
    expect(done.active).toBe(false);
  });

  it('[#17-16] 활성만 바뀌면 다른 묶음으로 본다(최근 도구 줄이 다시 그려져야 한다)', () => {
    const a = applyStreamDensity([tool('a1', 'Read', true)], 'standard')[0]!;
    const b = applyStreamDensity([tool('a1', 'Read', false)], 'standard')[0]!;
    expect(sameDisplayItem(a, b)).toBe(false);
  });

  it('[회귀] SDK 상태 칩(Task started)은 단독으로 떠도 간결/표준에서 안 보인다', () => {
    const items = [text('t1', '설명'), system('s1', '[task_started]'), text('t2', '다음')];
    for (const d of ['standard', 'compact'] as const) {
      expect(applyStreamDensity(items, d).map((i) => i.id)).toEqual(['t1', 't2']);
    }
    // 원문 밀도에서는 그대로 보인다.
    expect(applyStreamDensity(items, 'raw').map((i) => i.id)).toEqual(['t1', 's1', 't2']);
  });

  it('내용이 있는 system 본문은 어느 밀도에서도 남는다(숨김 대상은 상태 표식뿐)', () => {
    const items = [system('s1', '[Read] file not found'), system('s2', '권한 허용됨')];
    expect(applyStreamDensity(items, 'compact').map((i) => i.id)).toEqual(['s1', 's2']);
  });

  it('원문 밀도에서는 아무것도 접지 않는다', () => {
    const items = [tool('a1', 'Read'), tool('a2', 'Read'), plan('p1', 'x'), plan('p2', 'y')];
    const out = applyStreamDensity(items, 'raw');
    expect(out).toEqual(items);
  });
});

describe('applyStreamDensity — 옛 계획 접기', () => {
  it('같은 턴의 마지막 계획만 펼치고 앞선 계획은 superseded', () => {
    const out = applyStreamDensity([plan('p1', 'first'), text('t1'), plan('p2', 'second')], 'standard');
    expect((out[0] as StreamPlan).superseded).toBe(true);
    expect((out[2] as StreamPlan).superseded).toBeFalsy();
  });

  it('명령(턴 경계)을 넘으면 계획을 새로 센다', () => {
    const out = applyStreamDensity([plan('p1', 'first'), command('c1'), plan('p2', 'second')], 'standard');
    expect((out[0] as StreamPlan).superseded).toBeFalsy();
    expect((out[2] as StreamPlan).superseded).toBeFalsy();
  });

  it('계획이 하나뿐이면 접지 않는다', () => {
    const out = applyStreamDensity([plan('p1', 'only')], 'compact');
    expect((out[0] as StreamPlan).superseded).toBeFalsy();
  });
});

describe('sameDisplayItem', () => {
  it('같은 내용의 묶음은 동일로 본다', () => {
    const a = applyStreamDensity([tool('a1', 'Read'), tool('a2', 'Read')], 'standard')[0]!;
    const b = applyStreamDensity([tool('a1', 'Read'), tool('a2', 'Read')], 'standard')[0]!;
    expect(sameDisplayItem(a, b)).toBe(true);
  });

  it('묶음 안 도구의 출력이 바뀌면 다르다고 본다', () => {
    const a = applyStreamDensity([tool('a1', 'Read'), tool('a2', 'Read')], 'standard')[0]!;
    const changed = { ...tool('a2', 'Read'), output: 'different' };
    const b = applyStreamDensity([tool('a1', 'Read'), changed], 'standard')[0]!;
    expect(sameDisplayItem(a, b)).toBe(false);
  });

  it('묶음과 일반 아이템은 다르다고 본다', () => {
    const group = applyStreamDensity([tool('a1', 'Read'), tool('a2', 'Read')], 'standard')[0]!;
    expect(sameDisplayItem(group, text('t1'))).toBe(false);
  });
});
