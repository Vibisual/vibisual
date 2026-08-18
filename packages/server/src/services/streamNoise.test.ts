/**
 * §5.5 v4.92 — 스트림 "복원 예산" 판정 회귀 방지.
 *
 * 배경: IDE 를 다시 열었을 때 되살아나는 대화는 `sub-streams/*.jsonl` 의 **마지막
 * MAX_STREAM_BUFFER 이벤트**가 전부다. 사용자 말풍선·카드는 체크포인트에 따로 남으므로,
 * 이 창이 잡음으로 차면 화면은 "말풍선과 카드만 있고 사이 대화가 통째로 빈" 모양이 된다.
 *
 * 그래서 여기서 지키는 것은 두 줄이다:
 *  ① 화면에 한 글자도 안 그려지는 SDK 상태 칩은 예산에서 뺀다.
 *  ② 사람이 읽어야 하는 것은 **하나도** 빼지 않는다 — 특히 내용이 붙은 system 과 thinking.
 */
import { describe, it, expect } from 'vitest';
import {
  parseSystemSubtype,
  isNeverRenderedStreamEvent,
  formatSystemChip,
  parseSystemTaskInfo,
  foldTaskBookend,
  SYSTEM_CHIP_TEXT_MAX,
} from '@vibisual/shared';
import type { SubAgentStreamEvent, StreamEventType } from '@vibisual/shared';

function evt(eventType: StreamEventType, content: string, n = 0): SubAgentStreamEvent {
  return {
    id: `e-${n}`,
    subAgentId: 'sub-a',
    parentAgentId: 'agent-1',
    timestamp: 1_000 + n,
    eventType,
    content,
  };
}

describe('parseSystemSubtype — subtype 단독 패턴만', () => {
  it('내용 없는 칩은 subtype 을 돌려준다', () => {
    expect(parseSystemSubtype('[task_progress]')).toBe('task_progress');
    expect(parseSystemSubtype('  [thinking_tokens]  ')).toBe('thinking_tokens');
  });

  it('뒤에 내용이 붙으면 칩이 아니다 — 짝 없는 tool_result·권한 결정은 읽어야 할 내용이다', () => {
    expect(parseSystemSubtype('[Bash] npm ERR! code ELIFECYCLE')).toBeNull();
    expect(parseSystemSubtype('[task_progress] 3/7 파일 처리')).toBeNull();
    expect(parseSystemSubtype('사용자가 Write 를 거부했습니다')).toBeNull();
    expect(parseSystemSubtype('')).toBeNull();
  });
});

describe('§5.5 #17-13 ⑤-3 작업 칩 payload', () => {
  it('payload 가 붙어도 같은 subtype 으로 읽힌다 — 밀도 필터·복원 예산 판정이 갈라지면 안 된다', () => {
    const chip = formatSystemChip('task_started', { id: 't1', description: 'pnpm build' });
    expect(chip).toBe('[task_started] {"id":"t1","description":"pnpm build"}');
    expect(parseSystemSubtype(chip)).toBe('task_started');
    expect(isNeverRenderedStreamEvent(evt('system', chip))).toBe(false);
  });

  it('payload 자리가 JSON 이 아니면 칩이 아니다 — 임의 본문을 삼키지 않는다', () => {
    expect(parseSystemSubtype('[task_started] {깨진 payload')).toBeNull();
    expect(parseSystemSubtype('[task_started] 사용자가 읽어야 하는 글')).toBeNull();
    expect(parseSystemTaskInfo('[task_started] {깨진 payload')).toBeNull();
  });

  it('payload 왕복 — 넣은 값이 그대로 나온다', () => {
    const info = { id: 't2', description: '테스트 실행', status: 'failed' as const, summary: '3건 실패', durationMs: 12_345 };
    expect(parseSystemTaskInfo(formatSystemChip('task_notification', info))).toEqual(info);
  });

  it('payload 없는 옛 칩은 종전 그대로 — null 을 돌려줄 뿐 칩 판정은 유지', () => {
    expect(formatSystemChip('task_started')).toBe('[task_started]');
    expect(parseSystemTaskInfo('[task_started]')).toBeNull();
    expect(parseSystemSubtype('[task_started]')).toBe('task_started');
  });

  it('id 없는 payload 는 없는 것으로 본다 — 짝지을 열쇠가 없으면 접을 수 없다', () => {
    expect(parseSystemTaskInfo('[task_started] {"description":"이름만 있음"}')).toBeNull();
    expect(formatSystemChip('task_started', { id: '', description: 'x' })).toBe('[task_started]');
  });

  it('모르는 status 는 버린다 — 화면이 그릴 수 있는 세 가지만', () => {
    expect(parseSystemTaskInfo('[task_notification] {"id":"t3","status":"weird"}')?.status).toBeUndefined();
  });

  it('긴 글은 잘라서 싣는다 — 칩 하나가 복원 예산을 많이 먹지 않게', () => {
    const long = 'ㄱ'.repeat(SYSTEM_CHIP_TEXT_MAX + 50);
    const info = parseSystemTaskInfo(formatSystemChip('task_started', { id: 't4', description: long }));
    expect(info?.description).toHaveLength(SYSTEM_CHIP_TEXT_MAX + 1); // 말줄임표 1자
  });

  it('개행이 있어도 한 줄을 유지한다 — JSONL 한 줄 = 이벤트 하나', () => {
    const chip = formatSystemChip('task_started', { id: 't5', description: '첫 줄\n둘째 줄' });
    expect(chip).not.toContain('\n');
    expect(parseSystemTaskInfo(chip)?.description).toBe('첫 줄\n둘째 줄');
  });

  it('시작·끝을 합치면 이름은 시작 쪽, 결과·시간은 끝 쪽', () => {
    const merged = foldTaskBookend(
      { id: 't6', description: 'pnpm test' },
      { id: 't6', status: 'completed', summary: '616 통과', durationMs: 8_400 },
    );
    expect(merged).toEqual({ id: 't6', description: 'pnpm test', status: 'completed', summary: '616 통과', durationMs: 8_400 });
  });
});

describe('isNeverRenderedStreamEvent — 예산에서 뺄 것과 뺄 수 없는 것', () => {
  it('어느 밀도에서도 안 그려지는 두 종류를 뺀다 — 실측 164,214줄의 45%', () => {
    expect(isNeverRenderedStreamEvent(evt('system', '[thinking_tokens]'))).toBe(true);
    expect(isNeverRenderedStreamEvent(evt('system', '[status]'))).toBe(true);
  });

  // §5.5 #17-13 ⑤-4 — 살림성 통지는 "안쪽 목록이 다시 훑였다"만 알린다(무엇이 바뀌었는지도 없다).
  //   유휴 시간대에는 이 칩만 들어와 대화록 끝에 똑같은 줄이 연달아 쌓였다 — 어미로 잡아 통째로 뺀다.
  it('살림성 통지(`*_changed`)는 이름을 몰라도 뺀다 — 판올림마다 새 이름이 늘어난다', () => {
    for (const subtype of ['commands_changed', 'background_tasks_changed', 'mcp_servers_changed']) {
      expect(isNeverRenderedStreamEvent(evt('system', `[${subtype}]`))).toBe(true);
    }
  });

  // §5.5 #17-13 ⑤-5 — `task_progress` 는 새 작업이 아니라 **이미 화면에 선 작업의 심장박동**이고,
  //   우리에게 오는 것은 전부 payload 없는 민 칩이라 고정 라벨 한 낱말만 그려졌다(실측 2,454건 전부).
  it('작업 심장박동(`task_progress`)은 뺀다 — 같은 작업 줄 위에 겹겹이 쌓이던 것', () => {
    expect(isNeverRenderedStreamEvent(evt('system', '[task_progress]'))).toBe(true);
  });

  it('원문 밀도에서 뜻이 보이는 상태 칩은 남긴다 — 저장에서 빼면 되살린 화면만 달라진다', () => {
    for (const subtype of ['task_started', 'task_notification', 'task_updated', 'compact_boundary']) {
      expect(isNeverRenderedStreamEvent(evt('system', `[${subtype}]`))).toBe(false);
    }
  });

  it('대화·도구·오류는 어떤 경우에도 남긴다', () => {
    expect(isNeverRenderedStreamEvent(evt('text', '이렇게 고치겠습니다'))).toBe(false);
    expect(isNeverRenderedStreamEvent(evt('tool_use', 'Read(streamItems.ts)'))).toBe(false);
    expect(isNeverRenderedStreamEvent(evt('tool_result', '파일 내용…'))).toBe(false);
    expect(isNeverRenderedStreamEvent(evt('result', '완료'))).toBe(false);
    expect(isNeverRenderedStreamEvent(evt('error', '[spawn:1] 실패'))).toBe(false);
  });

  it('thinking 은 본문으로 안 그려져도 남긴다 — 텍스트 런의 경계라 빼면 문단이 뭉친다', () => {
    expect(isNeverRenderedStreamEvent(evt('thinking', '사고 원문'))).toBe(false);
  });

  it('내용이 있는 system 은 남긴다 — 권한 결정·짝 없는 도구 출력은 사용자가 읽어야 한다', () => {
    expect(isNeverRenderedStreamEvent(evt('system', '[Bash] npm ERR! code ELIFECYCLE'))).toBe(false);
    expect(isNeverRenderedStreamEvent(evt('system', 'Write 권한이 거부되었습니다'))).toBe(false);
  });
});

describe('복원 예산 — 같은 창에 실제 대화가 더 들어온다', () => {
  /** 실측 분포를 흉내 낸 시퀀스 — 펄스(`thinking_tokens`)가 압도적이라는 점이 핵심이다. */
  function realisticStream(): SubAgentStreamEvent[] {
    const out: SubAgentStreamEvent[] = [];
    let n = 0;
    // 한 턴 = 펄스 다수 + 상태 칩 + 도구 왕복 + 사고 + 본문 한 조각.
    for (let turn = 0; turn < 60; turn += 1) {
      for (let k = 0; k < 6; k += 1) out.push(evt('system', '[thinking_tokens]', n++));
      out.push(evt('system', '[status]', n++));
      out.push(evt('system', '[task_progress]', n++));
      out.push(evt('system', '[task_started]', n++));
      out.push(evt('tool_use', `Read(f${turn}.ts)`, n++));
      out.push(evt('tool_result', 'contents…', n++));
      out.push(evt('thinking', '…', n++));
      out.push(evt('text', `턴 ${turn} 설명`, n++));
    }
    return out;
  }

  it('칩을 빼면 마지막 N 슬롯에 남는 본문 수가 늘어난다', () => {
    const all = realisticStream();
    const WINDOW = 100;

    const before = all.slice(-WINDOW).filter((e) => e.eventType === 'text').length;
    const after = all.filter((e) => !isNeverRenderedStreamEvent(e)).slice(-WINDOW).filter((e) => e.eventType === 'text').length;

    expect(after).toBeGreaterThan(before);
    // 화면에 안 그려지는 것들이 창의 절반 이상을 먹고 있었다는 뜻.
    expect(after).toBeGreaterThanOrEqual(before * 2);
  });

  it('빼는 것은 안 그려지는 칩뿐 — 대화·도구·원문에 뜨는 칩은 한 개도 사라지지 않는다', () => {
    const all = realisticStream();
    const kept = all.filter((e) => !isNeverRenderedStreamEvent(e));
    for (const kind of ['text', 'thinking', 'tool_use', 'tool_result'] as const) {
      expect(kept.filter((e) => e.eventType === kind)).toHaveLength(all.filter((e) => e.eventType === kind).length);
    }
    // 원문 밀도에서 그려지는 `[task_started]` 는 그대로 남아야 한다(⑤-3 의 작업 1건당 한 줄).
    expect(kept.filter((e) => e.content === '[task_started]')).toHaveLength(60);
    // 반대로 심장박동(⑤-5)은 한 개도 남지 않는다.
    expect(kept.filter((e) => e.content === '[task_progress]')).toHaveLength(0);
  });
});
