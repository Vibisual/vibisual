import { describe, it, expect } from 'vitest';
import { applyStreamDensity, sameDisplayItem, clampStreamText, turnOpeningTextIds, speechRunPositions, type StreamToolGroup } from './streamDensity.js';
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
function result(id: string, content = 'done'): StreamItemFull {
  return { kind: 'result', id, content, timestamp: 1 };
}
function command(id: string): StreamItemFull {
  return { kind: 'command', id, prompt: 'p', result: '', status: 'completed', timestamp: 1 };
}
function error(id: string, content = '[exit:1] boom'): StreamItemFull {
  return { kind: 'error', id, content, timestamp: 1 };
}
/** §5.5 #17-39 — 끝난 사고 런의 자국. `ms` 는 그 자국 하나가 잰 사고 시간. */
function step(id: string, ts: number, ms: number, chars: number, nestedUnderToolUseId?: string): StreamItemFull {
  return { kind: 'step', id, phase: 'thinking', timestamp: ts, endedAt: ts + ms, chars, ...(nestedUnderToolUseId ? { nestedUnderToolUseId } : {}) };
}

describe('applyStreamDensity — 실패 사유(§5.5 #17-12 ③)', () => {
  it('어느 밀도에서도 오류 줄은 사라지지 않는다', () => {
    // 사용자가 읽어야 할 유일한 실패 원인이다 — 간결이라고 지우면 "오류라고만 나온다"로 되돌아간다.
    const items = [command('c1'), tool('a1', 'Bash'), error('e1'), text('t1')];
    for (const density of ['compact', 'standard', 'raw'] as const) {
      const kinds = applyStreamDensity(items, density).map((i) => i.kind);
      expect(kinds).toContain('error');
    }
  });

  it('오류 줄은 도구 묶음에 흡수되지 않고 런을 끊는다', () => {
    const out = applyStreamDensity([tool('a1', 'Bash'), error('e1'), tool('a2', 'Bash')], 'standard');
    expect(out.map((i) => i.kind)).toEqual(['toolgroup', 'error', 'toolgroup']);
  });
});

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

describe('applyStreamDensity — §5.5 #17-21 간결은 진짜 간결하게', () => {
  it('간결에서 완료된 도구 묶음은 화면에서 빠진다(표준에서는 남는다)', () => {
    const items = [text('t1', '설명'), tool('a1', 'Read'), tool('a2', 'Bash'), text('t2', '결론')];
    expect(applyStreamDensity(items, 'compact').map((i) => i.kind)).toEqual(['text', 'text']);
    expect(applyStreamDensity(items, 'standard').map((i) => i.kind)).toEqual(['text', 'toolgroup', 'text']);
  });

  it('§5.5 #17-24 ① — 진행 중인 묶음도 간결에서는 안 나온다(생겼다 사라지며 깜빡이던 줄)', () => {
    const out = applyStreamDensity([tool('a1', 'Read'), tool('a2', 'Bash', true)], 'compact');
    expect(out).toHaveLength(0);
    // 표준에서는 종전대로 진행 중 묶음이 남는다.
    const std = applyStreamDensity([tool('a1', 'Read'), tool('a2', 'Bash', true)], 'standard');
    expect((std[0] as StreamToolGroup).active).toBe(true);
  });

  it('묶음에 흡수된 내용 있는 system 본문은 묶음이 빠져도 남는다(오류·권한 메시지)', () => {
    const items = [
      tool('a1', 'Read'),
      system('s1', '[Read] file not found'),
      tool('a2', 'Bash'),
    ];
    // 표준에선 묶음 안쪽에 있고, 간결에선 묶음이 빠지면서 밖으로 나와 살아남는다.
    expect(applyStreamDensity(items, 'standard').map((i) => i.kind)).toEqual(['toolgroup']);
    expect(applyStreamDensity(items, 'compact').map((i) => i.id)).toEqual(['s1']);
  });

  it('상태 칩만 흡수한 완료 묶음은 흔적 없이 사라진다', () => {
    const items = [tool('a1', 'Read'), system('s1', '[task_started]'), tool('a2', 'Read')];
    expect(applyStreamDensity(items, 'compact')).toHaveLength(0);
  });

  it('간결에서도 대화 본문·계획·결과는 남는다(핵심은 보인다)', () => {
    const items = [plan('p1', '단계'), tool('a1', 'Read'), text('t1', '설명'), result('r1', '끝')];
    expect(applyStreamDensity(items, 'compact').map((i) => i.kind)).toEqual(['plan', 'text', 'result']);
  });
});

describe('applyStreamDensity — §5.5 #17-43 간결은 명령창만 숨긴다(본문은 전부 남는다)', () => {
  it('턴 안의 본문은 몇 개든 하나도 빠지지 않는다 — 도구 묶음만 사라진다', () => {
    const items = [
      command('c1'),
      text('t1', '요청은 이렇게 이해했습니다'),
      text('t2', 'Now the render body'),
      text('t3', '원인은 캐시가 갱신되지 않아서입니다'),
      text('t4', '작업을 마쳤습니다'),
    ];
    // 간결·표준·원문 모두 본문 개수는 같다(간결이 지우는 것은 명령창뿐).
    expect(applyStreamDensity(items, 'compact').map((i) => i.id)).toEqual(['c1', 't1', 't2', 't3', 't4']);
    expect(applyStreamDensity(items, 'standard').map((i) => i.id)).toEqual(['c1', 't1', 't2', 't3', 't4']);
    expect(applyStreamDensity(items, 'raw').map((i) => i.id)).toEqual(['c1', 't1', 't2', 't3', 't4']);
  });

  it('명령 경계를 여러 번 넘어도 본문은 전부 남는다', () => {
    const items = [
      command('c1'), text('a1', '의도1'), text('a2', '중간1'), text('a3', '결론1'),
      command('c2'), text('b1', '의도2'), text('b2', '중간2'), text('b3', '결론2'),
    ];
    expect(applyStreamDensity(items, 'compact').map((i) => i.id))
      .toEqual(['c1', 'a1', 'a2', 'a3', 'c2', 'b1', 'b2', 'b3']);
  });

  it('사용자에게 알리는 중간 본문(발견·경고)이 살아남는다 — 종전 규칙이 잘라 내던 자리', () => {
    const items = [
      command('c1'),
      text('t1', '의도'),
      text('t2', '다만 이 파일은 권한이 없어 고치지 못했습니다'),
      text('t3', 'A안과 B안 중 무엇으로 갈까요?'),
      text('t4', '결론'),
    ];
    expect(applyStreamDensity(items, 'compact').map((i) => i.id)).toEqual(['c1', 't1', 't2', 't3', 't4']);
  });

  it('카드·계획·결과·내용 있는 system 본문도 그대로 남는다', () => {
    const items = [
      command('c1'),
      text('t1', '의도'),
      plan('p1', '단계'),
      text('t2', '중간 본문'),
      system('s1', '[Read] file not found'),
      result('r1', '끝'),
      text('t3', '결론'),
    ];
    expect(applyStreamDensity(items, 'compact').map((i) => i.id))
      .toEqual(['c1', 't1', 'p1', 't2', 's1', 'r1', 't3']);
  });

  it('본문 사이에 낀 도구 묶음만 빠지고 앞뒤 본문은 둘 다 남는다', () => {
    const items = [
      command('c1'),
      text('t1', '고치겠습니다'),
      tool('g1', 'Edit'),
      text('t2', '고쳤습니다'),
    ];
    expect(applyStreamDensity(items, 'compact').map((i) => i.id)).toEqual(['c1', 't1', 't2']);
    expect(applyStreamDensity(items, 'standard').map((i) => i.kind))
      .toEqual(['command', 'text', 'toolgroup', 'text']);
  });
});

describe('applyStreamDensity — §5.5 #17-39 ⑩ 간결에서 이어 붙은 사고 자국은 한 줄', () => {
  const steps = (out: ReturnType<typeof applyStreamDensity>) => out.filter((i) => i.kind === 'step');

  it('[회귀] 도구마다 끼어 있던 자국이 간결에서 사다리로 쌓이지 않는다(표준은 그대로)', () => {
    // 사용자 스크린샷 — 도구를 부를 때마다 짧게 생각하는 모델. 간결이 묶음을 빼자 자국끼리 붙었다.
    const items = [
      command('c1'), text('t1', '의도'),
      step('s1', 1_000, 0, 88), tool('a1', 'Read'),
      step('s2', 3_000, 0, 142), tool('a2', 'Grep'),
      step('s3', 5_000, 0, 151), tool('a3', 'Read'),
      text('t2', '결론'),
    ];
    const compact = applyStreamDensity(items, 'compact');
    expect(compact.map((i) => i.id)).toEqual(['c1', 't1', 's1', 't2']);
    expect(steps(compact)[0]).toMatchObject({ chars: 88 + 142 + 151 });
    // 표준은 사이에 명령 묶음이 그대로 있어 "사고 → 명령 → 사고" 로 읽힌다 — 한 줄도 바뀌지 않는다.
    expect(applyStreamDensity(items, 'standard').map((i) => i.kind)).toEqual([
      'command', 'text', 'step', 'toolgroup', 'step', 'toolgroup', 'step', 'toolgroup', 'text',
    ]);
  });

  it('시간은 폭이 아니라 합이다 — 사이의 도구 실행 시간을 사고로 적지 않는다', () => {
    const out = applyStreamDensity([step('s1', 1_000, 500, 100), tool('a1', 'Bash'), step('s2', 60_000, 400, 100)], 'compact');
    const merged = steps(out);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.kind === 'step' && merged[0]!.timestamp).toBe(1_000);
    // 폭(59.4초)이 아니라 두 자국이 잰 사고 시간의 합(0.9초).
    expect(merged[0]!.kind === 'step' && merged[0]!.endedAt - merged[0]!.timestamp).toBe(900);
  });

  it('주인이 다르면(중첩 Task) 섞지 않는다', () => {
    const nestedTool = { ...tool('n9', 'Read'), nestedUnderToolUseId: 'task-1' };
    const out = applyStreamDensity([
      step('p1', 1, 0, 100), tool('a1', 'Agent'),
      step('n1', 2, 0, 100, 'task-1'), nestedTool,
      step('p2', 3, 0, 100),
    ], 'compact');
    expect(steps(out).map((i) => [i.id, i.kind === 'step' && i.chars])).toEqual([['p1', 200], ['n1', 100]]);
  });

  it('간결 화면에 그려지는 것이 끼면 끊긴다(내용 있는 system 본문)', () => {
    const out = applyStreamDensity(
      [step('s1', 1, 0, 100), tool('a1', 'Read'), system('s9', '[Read] file not found'), tool('a2', 'Read'), step('s2', 2, 0, 100)],
      'compact',
    );
    expect(out.map((i) => i.id)).toEqual(['s1', 's9', 's2']);
  });

  it('구간이 자라도 합친 줄의 id 는 첫 자국 그대로 — 줄이 새로 생기지 않고 숫자만 오른다', () => {
    const before = applyStreamDensity([text('t1'), step('s1', 1, 0, 100), tool('a1', 'Read')], 'compact');
    const after = applyStreamDensity([text('t1'), step('s1', 1, 0, 100), tool('a1', 'Read'), step('s2', 2, 0, 50), tool('a2', 'Read')], 'compact');
    expect(before.map((i) => i.id)).toEqual(['t1', 's1']);
    expect(after.map((i) => i.id)).toEqual(['t1', 's1']);
    // 숫자가 바뀌었으니 같은 항목으로 보지 않는다 — 그 줄만 다시 그린다.
    expect(sameDisplayItem(before[1]!, after[1]!)).toBe(false);
  });

  it('합칠 것이 없으면 자국 항목 참조가 그대로다(불필요한 재렌더 ❌)', () => {
    const lone = step('s1', 1, 0, 100);
    const out = applyStreamDensity([text('t1'), lone, text('t2')], 'compact');
    expect(out[1]).toBe(lone);
  });
});

describe('clampStreamText — §5.5 #17-46 머리 + 꼬리, 가운데만 접기', () => {
  const SPEC = { headLines: 4, headChars: 420, tailLines: 3, tailChars: 240, minHiddenChars: 120 };
  const FENCE = '`'.repeat(3);

  it('짧은 본문은 자르지 않는다(null)', () => {
    expect(clampStreamText('한 줄', SPEC)).toBeNull();
    expect(clampStreamText('a\nb\nc\nd', SPEC)).toBeNull();
  });

  it('머리(4줄)와 꼬리(3줄)가 본문을 다 덮으면 접지 않는다', () => {
    // 7줄까지는 감출 것이 없는데 버튼 한 줄만 늘어난다(§5.5 #17-46 ②).
    expect(clampStreamText('1\n2\n3\n4\n5\n6\n7', SPEC)).toBeNull();
  });

  it('가운데가 생기면 머리와 꼬리를 남기고 그 사이만 접는다', () => {
    const out = clampStreamText('1\n2\n3\n4\n5\n6\n7\n8\n9\n10', SPEC);
    expect(out?.head).toBe('1\n2\n3\n4');
    expect(out?.tail).toBe('8\n9\n10'); // 끝 멘트는 접혀도 보인다
    expect(out?.hiddenLines).toBe(3);
  });

  it('줄바꿈 없는 긴 문단도 글자 수로 머리·꼬리가 나뉜다', () => {
    const out = clampStreamText('ㄱ'.repeat(900), SPEC);
    expect(out).not.toBeNull();
    expect(out!.head.length).toBe(420);
    expect(out!.tail.length).toBe(240);
    expect(out!.hiddenLines).toBe(1);
  });

  it('감추는 것이 짧은 한 줄뿐이면 접지 않는다(버튼 한 줄과 상쇄)', () => {
    expect(clampStreamText('1\n2\n3\n4\n5\n6\n7\n8', SPEC)).toBeNull();
  });

  it('감추는 것이 한 줄이어도 충분히 길면 접는다', () => {
    const out = clampStreamText(`1\n2\n3\n4\n${'ㄱ'.repeat(200)}\n6\n7\n8`, SPEC);
    expect(out?.hiddenLines).toBe(1);
    expect(out?.tail).toBe('6\n7\n8');
  });

  it('꼬리가 코드블록 안에서 시작하면 여는 펜스를 덧대 넘긴다(markdown)', () => {
    const content = [
      '첫 줄', '둘', '셋', '넷',
      `${FENCE}ts`, 'const a = 1;', 'const b = 2;', 'const c = 3;', 'const d = 4;', FENCE,
      '결론입니다',
    ].join('\n');
    const md = clampStreamText(content, { ...SPEC, markdown: true });
    expect(md?.tail.startsWith(`${FENCE}\n`)).toBe(true);
    expect(md?.tail.endsWith('결론입니다')).toBe(true);
    // 평문으로 그리는 메인 탭은 보정하지 않는다(펜스 글자가 그대로 보이면 안 된다).
    expect(clampStreamText(content, SPEC)?.tail.startsWith(`${FENCE}\n`)).toBe(false);
  });

  it('코드블록이 닫힌 채 잘리면 꼬리에 펜스를 덧대지 않는다', () => {
    const content = [
      '첫 줄', '둘', '셋', '넷',
      FENCE, 'const a = 1;', FENCE,
      '가운데 설명', '또 한 줄',
      '마무리 1', '마무리 2', '마무리 3',
    ].join('\n');
    const md = clampStreamText(content, { ...SPEC, markdown: true });
    expect(md?.tail).toBe('마무리 1\n마무리 2\n마무리 3');
  });
});

describe('turnOpeningTextIds — §5.5 #17-12 ①-2 여는 본문은 간결에서도 안 접힌다', () => {
  const seq = (...rows: [string, 'command' | 'text' | 'other'][]) => rows.map(([id, role]) => ({ id, role }));

  it('내 말풍선 바로 다음의 첫 본문이 그 턴의 의도 선언이다', () => {
    const out = turnOpeningTextIds(seq(['c1', 'command'], ['t1', 'text'], ['t2', 'text']));
    expect([...out]).toEqual(['t1']);
  });

  it('턴이 여러 개면 턴마다 하나씩 잡는다', () => {
    const out = turnOpeningTextIds(seq(
      ['c1', 'command'], ['t1', 'text'], ['x1', 'other'], ['t2', 'text'],
      ['c2', 'command'], ['t3', 'text'], ['t4', 'text'],
    ));
    expect([...out]).toEqual(['t1', 't3']);
  });

  it('말풍선과 본문 사이에 도구·생각이 끼어도 첫 본문을 잡는다', () => {
    const out = turnOpeningTextIds(seq(['c1', 'command'], ['x1', 'other'], ['x2', 'other'], ['t1', 'text']));
    expect([...out]).toEqual(['t1']);
  });

  it('첫 명령 이전의 본문은 잡지 않는다(짝지을 말풍선이 없다)', () => {
    const out = turnOpeningTextIds(seq(['t0', 'text'], ['c1', 'command'], ['t1', 'text']));
    expect([...out]).toEqual(['t1']);
  });

  it('본문 없이 끝난 턴은 아무것도 잡지 않는다', () => {
    expect([...turnOpeningTextIds(seq(['c1', 'command'], ['x1', 'other']))]).toEqual([]);
    expect([...turnOpeningTextIds(seq())]).toEqual([]);
  });

  it('말풍선이 연달아 오면 마지막 말풍선의 다음 본문 하나만 잡는다(대기 명령 묶음)', () => {
    const out = turnOpeningTextIds(seq(['c1', 'command'], ['c2', 'command'], ['t1', 'text'], ['t2', 'text']));
    expect([...out]).toEqual(['t1']);
  });
});

describe('speechRunPositions — §5.5 #17-45 연달아 온 본문은 한 발화로 묶인다', () => {
  const seq = (...rows: ([string, boolean] | [string, boolean, string])[]) =>
    rows.map(([id, text, owner]) => ({ id, text, owner }));

  it('본문이 연달아 오면 첫 문단만 말머리를 달고 나머지는 이어 붙는다', () => {
    const out = speechRunPositions(seq(['t1', true], ['t2', true], ['t3', true], ['t4', true]));
    expect([...out]).toEqual([['t1', 'head'], ['t2', 'mid'], ['t3', 'mid'], ['t4', 'tail']]);
  });

  it('앞뒤가 끊긴 홑 문단은 solo — 종전과 한 픽셀도 다르지 않다', () => {
    const out = speechRunPositions(seq(['x0', false], ['t1', true], ['x1', false]));
    expect(out.get('t1')).toBe('solo');
  });

  it('두 문단짜리 런은 head + tail 뿐이다(mid 없음)', () => {
    const out = speechRunPositions(seq(['t1', true], ['t2', true]));
    expect([...out]).toEqual([['t1', 'head'], ['t2', 'tail']]);
  });

  it('본문이 아닌 것(내 말풍선·카드·오류·라이브 1줄)은 런을 끊는다', () => {
    const out = speechRunPositions(seq(['t1', true], ['t2', true], ['c1', false], ['t3', true], ['t4', true]));
    expect([...out]).toEqual([['t1', 'head'], ['t2', 'tail'], ['t3', 'head'], ['t4', 'tail']]);
  });

  it('주인이 다르면(중첩 서브에이전트·다른 세션) 런을 끊는다 — 남의 말을 내 발화에 붙이지 않는다', () => {
    const out = speechRunPositions(seq(['t1', true], ['t2', true, 'task-1'], ['t3', true, 'task-1'], ['t4', true]));
    expect([...out]).toEqual([['t1', 'solo'], ['t2', 'head'], ['t3', 'tail'], ['t4', 'solo']]);
  });

  it('본문이 아닌 항목에는 자리를 매기지 않는다(맵에 없으면 부르는 쪽이 solo 로 읽는다)', () => {
    const out = speechRunPositions(seq(['x1', false], ['x2', false]));
    expect(out.size).toBe(0);
    expect([...speechRunPositions(seq())]).toEqual([]);
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
