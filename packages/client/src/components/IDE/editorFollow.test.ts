import { describe, expect, it } from 'vitest';
import type { SubAgentStreamEvent } from '@vibisual/shared';
import {
  FOLLOW_SCAN_LIMIT,
  agentTouchedFileIds,
  findEditedLineRange,
  followOpenSkipReason,
  followSessionKey,
  isFollowableRelPath,
  latestCompletedEdit,
  newestEventTimestamp,
} from './editorFollow.js';

let seq = 0;
/** 테스트용 스트림 이벤트 한 건. */
function evt(part: Partial<SubAgentStreamEvent> & { eventType: SubAgentStreamEvent['eventType']; timestamp: number }): SubAgentStreamEvent {
  seq += 1;
  return {
    id: `e${seq}`,
    subAgentId: 'sub-1',
    parentAgentId: 'agent-1',
    content: '',
    ...part,
  };
}

/** Edit 도구 호출 이벤트(서버는 Edit 계열 input 을 자르지 않고 통째로 보낸다). */
function editCall(filePath: string, newString: string, timestamp: number): SubAgentStreamEvent {
  return evt({
    eventType: 'tool_use',
    toolName: 'Edit',
    content: JSON.stringify({ file_path: filePath, old_string: 'old', new_string: newString }),
    timestamp,
  });
}

/** 도구 결과 이벤트 — 이게 와야 파일이 실제로 바뀐 것이다. */
function result(timestamp: number): SubAgentStreamEvent {
  return evt({ eventType: 'tool_result', content: 'ok', timestamp });
}

describe('agentTouchedFileIds', () => {
  it('양방향 엣지 모두에서 상대편 노드를 모은다', () => {
    const ids = agentTouchedFileIds(
      [
        { source: 'agent-1', target: 'file-a' },
        { source: 'file-b', target: 'agent-1' },
        { source: 'agent-2', target: 'file-c' },
      ],
      'agent-1',
    );
    expect([...ids].sort()).toEqual(['file-a', 'file-b']);
  });

  it('엣지가 없으면 빈 집합', () => {
    expect(agentTouchedFileIds([], 'agent-1').size).toBe(0);
  });
});

describe('followSessionKey', () => {
  it('세션마다 다른 키 — 옆 세션의 켜짐이 넘어오지 않는다', () => {
    expect(followSessionKey('agent-1', 'sub-a')).not.toBe(followSessionKey('agent-1', 'sub-b'));
  });

  it('같은 세션이면 같은 키', () => {
    expect(followSessionKey('agent-1', 'sub-a')).toBe(followSessionKey('agent-1', 'sub-a'));
  });

  it('전체 보기(null)도 자기 칸을 가진다', () => {
    expect(followSessionKey('agent-1', null)).toBe('agent-1::main');
  });

  it('에이전트가 다르면 같은 세션 이름이어도 다른 키', () => {
    expect(followSessionKey('agent-1', null)).not.toBe(followSessionKey('agent-2', null));
  });
});

describe('latestCompletedEdit', () => {
  it('결과가 온 편집만 따라간다 — 호출만 있으면 아직 파일이 안 바뀐 것', () => {
    const events = [editCall('C:/repo/a.ts', 'const a = 1;', 100)];
    expect(latestCompletedEdit(events, 0)).toBeNull();
  });

  it('결과가 오면 그 편집을 돌려주고, 시각은 결과 시각이다', () => {
    const events = [editCall('C:/repo/a.ts', 'const a = 1;', 100), result(140)];
    expect(latestCompletedEdit(events, 0)).toEqual({
      filePath: 'C:/repo/a.ts', newString: 'const a = 1;', at: 140, toolName: 'Edit',
    });
  });

  it('완료가 여러 건이면 가장 최근 것', () => {
    const events = [
      editCall('C:/repo/a.ts', 'A', 100), result(110),
      editCall('C:/repo/b.ts', 'B', 200), result(210),
    ];
    expect(latestCompletedEdit(events, 0)?.filePath).toBe('C:/repo/b.ts');
  });

  it('기준 시각보다 옛 편집은 따라가지 않는다', () => {
    const events = [editCall('C:/repo/a.ts', 'A', 100), result(110)];
    expect(latestCompletedEdit(events, 110)).toBeNull();
  });

  it('편집이 아닌 도구의 결과에 편집이 잘못 붙지 않는다(호출 순서대로 짝짓기)', () => {
    const events = [
      evt({ eventType: 'tool_use', toolName: 'Bash', content: '{"command":"ls"}', timestamp: 100 }),
      editCall('C:/repo/a.ts', 'A', 110),
      result(120), // ← Bash 의 결과
    ];
    expect(latestCompletedEdit(events, 0)).toBeNull();
    // Edit 의 결과가 와야 비로소 따라간다.
    expect(latestCompletedEdit([...events, result(130)], 0)?.filePath).toBe('C:/repo/a.ts');
  });

  it('창 밖에서 시작된 호출의 결과는 버린다 — 남의 결과에 엉뚱한 파일이 붙지 않는다', () => {
    const events = [result(100), editCall('C:/repo/a.ts', 'A', 110)];
    expect(latestCompletedEdit(events, 0)).toBeNull();
  });

  it('Write(파일 생성)도 따라간다 — 본문 전체가 새 글자', () => {
    const events = [
      evt({
        eventType: 'tool_use', toolName: 'Write', timestamp: 100,
        content: JSON.stringify({ file_path: 'C:/repo/new.ts', content: 'hello' }),
      }),
      result(120),
    ];
    expect(latestCompletedEdit(events, 0)).toMatchObject({ filePath: 'C:/repo/new.ts', newString: 'hello' });
  });

  it('MultiEdit 은 마지막 조각을 따라간다(커서가 가야 할 곳)', () => {
    const events = [
      evt({
        eventType: 'tool_use', toolName: 'MultiEdit', timestamp: 100,
        content: JSON.stringify({
          file_path: 'C:/repo/m.ts',
          edits: [{ old_string: 'a', new_string: 'A' }, { old_string: 'b', new_string: 'B' }],
        }),
      }),
      result(120),
    ];
    expect(latestCompletedEdit(events, 0)?.newString).toBe('B');
  });

  it('스캔 창을 넘는 옛 이벤트는 보지 않는다(긴 세션에서 전량 재스캔 ❌)', () => {
    const events = [
      editCall('C:/repo/old.ts', 'OLD', 10), result(20),
      evt({ eventType: 'text', content: 'x', timestamp: 30 }),
      evt({ eventType: 'text', content: 'y', timestamp: 40 }),
    ];
    expect(latestCompletedEdit(events, 0, 2)).toBeNull();
  });

  it('편집이 하나도 없는 스트림이면 null', () => {
    expect(latestCompletedEdit([evt({ eventType: 'text', content: 'hi', timestamp: 100 })], 0)).toBeNull();
  });
});

/**
 * §5.5 #17-27 ⑪ — `tool_use_id` 짝짓기. 호출 순서(FIFO)만으로 맞추던 판이 실제 세션에서 어긋났던
 * 상황들을 그대로 재현한다(실측: 한 세션에서 `tool_use` 31 : `tool_result` 30 · 순서 어긋남 2건).
 */
describe('latestCompletedEdit — tool_use_id 짝짓기', () => {
  /** id 를 단 편집 호출. */
  function editCallId(id: string, filePath: string, newString: string, timestamp: number): SubAgentStreamEvent {
    return evt({
      eventType: 'tool_use',
      toolName: 'Edit',
      toolUseId: id,
      content: JSON.stringify({ file_path: filePath, old_string: 'old', new_string: newString }),
      timestamp,
    });
  }
  /** id 를 단 결과. */
  function resultId(id: string, timestamp: number): SubAgentStreamEvent {
    return evt({ eventType: 'tool_result', toolUseId: id, content: 'ok', timestamp });
  }

  it('결과가 끝내 오지 않는 호출이 있어도 그 뒤가 밀리지 않는다(중지·거부된 도구)', () => {
    const events = [
      evt({ eventType: 'tool_use', toolName: 'Bash', toolUseId: 'tu-dead', content: '{"command":"ls"}', timestamp: 100 }),
      editCallId('tu-edit', 'C:/repo/a.ts', 'A', 110),
      resultId('tu-edit', 120), // ← 죽은 호출은 결과가 영영 안 온다
    ];
    // FIFO 라면 이 결과가 Bash 것으로 소비돼 편집을 영영 못 따라간다.
    expect(latestCompletedEdit(events, 0)).toMatchObject({ filePath: 'C:/repo/a.ts', at: 120 });
  });

  it('결과가 호출 순서와 다르게 와도 각자 제 짝을 찾는다(병렬 도구 호출)', () => {
    const events = [
      editCallId('tu-a', 'C:/repo/a.ts', 'A', 100),
      editCallId('tu-b', 'C:/repo/b.ts', 'B', 101),
      resultId('tu-b', 110),
      resultId('tu-a', 120),
    ];
    // 마지막에 완료된 것은 a — FIFO 라면 b 가 a 의 결과를 먹어 시각이 뒤집힌다.
    expect(latestCompletedEdit(events, 0)).toMatchObject({ filePath: 'C:/repo/a.ts', at: 120 });
  });

  it('짝 없는 결과는 큐를 밀지 않고 버린다 — 남의 결과에 엉뚱한 파일이 붙지 않는다', () => {
    const events = [
      editCallId('tu-edit', 'C:/repo/a.ts', 'A', 100),
      resultId('tu-outside', 110), // 창 밖에서 시작된 호출의 결과
    ];
    expect(latestCompletedEdit(events, 0)).toBeNull();
    expect(latestCompletedEdit([...events, resultId('tu-edit', 130)], 0)).toMatchObject({ at: 130 });
  });

  it('id 가 없는 옛 버퍼는 종전대로 FIFO 로 맞춘다(서버 재시작 전 이벤트 호환)', () => {
    const events = [editCall('C:/repo/a.ts', 'A', 100), result(120)];
    expect(latestCompletedEdit(events, 0)).toMatchObject({ filePath: 'C:/repo/a.ts', at: 120 });
  });

  it('id 있는 호출과 없는 결과가 섞여도 한 줄로 이어진다', () => {
    const events = [editCallId('tu-a', 'C:/repo/a.ts', 'A', 100), result(120)];
    expect(latestCompletedEdit(events, 0)).toMatchObject({ filePath: 'C:/repo/a.ts', at: 120 });
  });
});

/**
 * 건수는 세지 않는다 — 스캔 창(`scanLimit`) 밖으로 밀릴 때마다 저절로 줄어 화면에서 흔들렸다.
 * 돌려주는 것은 언제나 **마지막 한 건**이고, 그 값만은 창 안에 있는 한 흔들리지 않아야 한다.
 */
describe('latestCompletedEdit — 흔들리지 않는 마지막 한 건', () => {
  it('편집이 여러 건 쌓여도 마지막 한 건만 돌려준다', () => {
    const events = [
      editCall('C:/repo/a.ts', 'A', 100), result(110),
      editCall('C:/repo/b.ts', 'B', 200), result(210),
      editCall('C:/repo/c.ts', 'C', 300), result(310),
    ];
    expect(latestCompletedEdit(events, 0)).toMatchObject({ filePath: 'C:/repo/c.ts', at: 310 });
  });

  it('창이 좁아져 옛 편집이 밀려나도 마지막 한 건은 그대로다(표시가 흔들리지 않는다)', () => {
    const events = [
      editCall('C:/repo/a.ts', 'A', 100), result(110),
      editCall('C:/repo/b.ts', 'B', 200), result(210),
      editCall('C:/repo/c.ts', 'C', 300), result(310),
    ];
    for (const limit of [2, 4, 6, FOLLOW_SCAN_LIMIT]) {
      expect(latestCompletedEdit(events, 0, limit)).toMatchObject({ filePath: 'C:/repo/c.ts', at: 310 });
    }
  });

  it('따라갈 것이 없으면 null', () => {
    expect(latestCompletedEdit([], 0)).toBeNull();
  });
});

describe('followOpenSkipReason', () => {
  it('루트 밖 파일은 열지 않고 그 사유를 말한다', () => {
    expect(followOpenSkipReason('D:/other/a.ts', false, true)).toBe('outside-root');
  });

  it('폰 폭에서 편집창이 닫혀 있으면 대화를 덮지 않고 그 사유를 말한다', () => {
    expect(followOpenSkipReason('src/a.ts', true, false)).toBe('editor-closed');
  });

  it('폰 폭이어도 편집창이 이미 떠 있으면 따라간다', () => {
    expect(followOpenSkipReason('src/a.ts', true, true)).toBeNull();
  });

  it('데스크톱에서는 편집창이 닫혀 있어도 따라간다(형제로 붙는다)', () => {
    expect(followOpenSkipReason('src/a.ts', false, false)).toBeNull();
  });
});

describe('newestEventTimestamp', () => {
  it('토글을 켠 순간의 기준선 = 지금 스트림의 가장 최근 시각', () => {
    const events = [evt({ eventType: 'text', content: 'a', timestamp: 100 }), result(420)];
    expect(newestEventTimestamp(events)).toBe(420);
  });

  it('빈 스트림이면 0', () => {
    expect(newestEventTimestamp([])).toBe(0);
  });
});

describe('isFollowableRelPath', () => {
  it('루트 기준 상대 경로는 따라간다', () => {
    expect(isFollowableRelPath('packages/client/src/App.tsx')).toBe(true);
  });

  it('윈도우 드라이브 절대 경로(=루트 밖)는 따라가지 않는다', () => {
    expect(isFollowableRelPath('D:/other/note.md')).toBe(false);
    expect(isFollowableRelPath('C:\\repo\\a.ts')).toBe(false);
  });

  it('POSIX 절대 경로도 따라가지 않는다', () => {
    expect(isFollowableRelPath('/etc/hosts')).toBe(false);
  });

  it('상위로 빠져나가는 경로와 빈 경로는 따라가지 않는다', () => {
    expect(isFollowableRelPath('../outside/a.ts')).toBe(false);
    expect(isFollowableRelPath('')).toBe(false);
  });
});

describe('findEditedLineRange', () => {
  const text = ['const a = 1;', 'const b = 2;', 'const c = 3;', 'const d = 4;'].join('\n');

  it('새 글자가 놓인 줄을 1-based 로 돌려준다', () => {
    expect(findEditedLineRange(text, 'const c = 3;')).toEqual({ start: 3, end: 3 });
  });

  it('여러 줄이면 시작~끝 범위', () => {
    expect(findEditedLineRange(text, 'const b = 2;\nconst c = 3;')).toEqual({ start: 2, end: 3 });
  });

  it('첫 줄이면 1', () => {
    expect(findEditedLineRange(text, 'const a = 1;')).toEqual({ start: 1, end: 1 });
  });

  it('디스크가 CRLF 여도 찾는다', () => {
    const crlf = text.replace(/\n/g, '\r\n');
    expect(findEditedLineRange(crlf, 'const c = 3;')).toEqual({ start: 3, end: 3 });
  });

  it('신고가 CRLF 여도 찾는다', () => {
    expect(findEditedLineRange(text, 'const b = 2;\r\nconst c = 3;')).toEqual({ start: 2, end: 3 });
  });

  it('통째로 못 찾으면 내용 있는 첫 줄로 다시 찾는다', () => {
    expect(findEditedLineRange(text, '\nconst c = 3;\nconst ZZZ = 9;')).toEqual({ start: 3, end: 3 });
  });

  it('본문에 아예 없으면 null — 엉뚱한 줄로 끌고 가지 않는다', () => {
    expect(findEditedLineRange(text, 'const nope = 0;')).toBeNull();
  });

  it('빈 새 글자·빈 본문은 null', () => {
    expect(findEditedLineRange(text, '   ')).toBeNull();
    expect(findEditedLineRange('', 'a')).toBeNull();
  });

  it('파일 통째 생성처럼 범위가 크면 강조 폭만 자른다(시작 줄은 그대로)', () => {
    const many = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    expect(findEditedLineRange(many, many, 10)).toEqual({ start: 1, end: 10 });
  });

  it('끝에 붙은 빈 줄은 범위를 늘리지 않는다', () => {
    expect(findEditedLineRange(text, 'const b = 2;\n')).toEqual({ start: 2, end: 2 });
  });
});
