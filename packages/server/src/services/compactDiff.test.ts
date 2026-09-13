import { describe, it, expect } from 'vitest';
import type { CompactWorkingSet } from '@vibisual/shared';
import {
  RECOVERY_BRIEF_LABELS_KO,
  buildRecoveryBlock,
  diffAgainstSummary,
  emptyNotCarried,
  emptyWorkingSet,
  extractSummaryText,
  hasNotCarried,
} from './compactDiff.js';

// SCENARIO.md §5.26 (D)(E) — 압축 전후 대조 + 복원 브리핑.
//
// **판정에 모델이 없다.** 그래서 이 시험이 지키는 것은 정확도가 아니라 **정직함**이다:
// 요약이 다른 말로 옮겼을 뿐인데 "안 실렸다"고 적으면 사용자는 없는 손실을 복구하려 든다.
// 그래서 판정은 "실린 쪽"으로 기울어야 한다.

function ws(over: Partial<CompactWorkingSet> = {}): CompactWorkingSet {
  return { ...emptyWorkingSet(), ...over };
}

describe('§5.26 (D) diffAgainstSummary — 경로', () => {
  it('전체 경로가 그대로 나오면 실린 것', () => {
    const r = diffAgainstSummary(
      ws({ openFiles: ['C:/proj/src/a.ts'] }),
      'we edited C:/proj/src/a.ts today',
    );
    expect(r.notCarried.openFiles).toEqual([]);
    expect(r.carriedCount).toBe(1);
  });

  it('구분자가 달라도(윈도우 역슬래시) 같은 경로로 읽는다', () => {
    const r = diffAgainstSummary(
      ws({ openFiles: ['C:\\proj\\src\\a.ts'] }),
      'edited c:/proj/src/a.ts',
    );
    expect(r.notCarried.openFiles).toEqual([]);
  });

  it('`부모/파일` 조각만 나와도 실린 것으로 본다', () => {
    const r = diffAgainstSummary(
      ws({ openFiles: ['/srv/proj/src/parser.ts'] }),
      'refactored src/parser.ts',
    );
    expect(r.notCarried.openFiles).toEqual([]);
  });

  it('파일명만 나와도 실린 것으로 본다 — 안 실렸다고 잘못 말하는 쪽이 더 나쁘다', () => {
    const r = diffAgainstSummary(ws({ openFiles: ['/a/b/index.ts'] }), 'touched index.ts');
    expect(r.notCarried.openFiles).toEqual([]);
  });

  it('어디에도 안 나오면 notCarried', () => {
    const r = diffAgainstSummary(ws({ openFiles: ['/a/b/parser.ts'] }), 'we talked about tests');
    expect(r.notCarried.openFiles).toEqual(['/a/b/parser.ts']);
    expect(r.carriedCount).toBe(0);
  });
});

describe('§5.26 (D) diffAgainstSummary — 문장형 항목', () => {
  it('제목 앞머리만 맞아도 실린 것으로 본다', () => {
    const r = diffAgainstSummary(
      ws({ runningTasks: ['컨텍스트 보험 5단계 구현을 끝까지 밀어붙인다'] }),
      '진행: 컨텍스트 보험 5단계 구현을 이어감',
    );
    expect(r.notCarried.runningTasks).toEqual([]);
  });

  it('여덟 자 미만 앞머리는 앞머리 매칭을 쓰지 않는다 — 짧은 조각은 어디에나 있다', () => {
    const r = diffAgainstSummary(ws({ goalSteps: ['배선'] }), '이번 턴에는 배 를 그렸다');
    expect(r.notCarried.goalSteps).toEqual(['배선']);
  });

  it('목표가 요약에 없으면 goal 에 담긴다', () => {
    const r = diffAgainstSummary(ws({ goal: '컨텍스트 보험을 한 묶음으로 끝낸다' }), '무관한 요약');
    expect(r.notCarried.goal).toBe('컨텍스트 보험을 한 묶음으로 끝낸다');
  });
});

describe('§5.26 (D) 대조하지 않는 축', () => {
  it('queuedCommands·lastTool·lastAssistantTail 은 결과에 영향을 주지 않는다', () => {
    const r = diffAgainstSummary(
      ws({ queuedCommands: 7, lastTool: 'Bash', lastAssistantTail: '...꼬리...' }),
      '',
    );
    expect(hasNotCarried(r.notCarried)).toBe(false);
    expect(r.carriedCount).toBe(0);
  });
});

describe('§5.26 (D) extractSummaryText — 판본이 달라도 본문을 찾는다', () => {
  it('`summary` 키', () => {
    expect(extractSummaryText('{"type":"summary","summary":"압축된 요약"}')).toContain('압축된 요약');
  });

  it('`message.content[].text` 중첩', () => {
    const line = JSON.stringify({ message: { content: [{ type: 'text', text: '중첩 본문' }] } });
    expect(extractSummaryText(line)).toContain('중첩 본문');
  });

  it('잘린 마지막 줄은 건너뛴다 — 다음 스윕이 온전한 줄로 다시 본다', () => {
    const good = JSON.stringify({ summary: '온전한 줄' });
    expect(extractSummaryText(`${good}\n{"summary":"잘린`)).toBe('온전한 줄');
  });

  it('JSON 이 아닌 줄은 무시한다', () => {
    expect(extractSummaryText('not json\n')).toBe('');
  });
});

describe('§5.26 (E) buildRecoveryBlock — 한 턴짜리 브리핑', () => {
  it('실을 것이 없으면 빈 문자열 — 없는 손실을 알리지 않는다', () => {
    expect(buildRecoveryBlock(emptyNotCarried())).toBe('');
  });

  it('항목이 있으면 머리말·꼬리말과 함께 실린다', () => {
    const block = buildRecoveryBlock({
      ...emptyNotCarried(),
      openFiles: ['/a/b/parser.ts'],
      goal: '보험을 끝낸다',
    });
    expect(block).toContain(RECOVERY_BRIEF_LABELS_KO.goal);
    expect(block).toContain('/a/b/parser.ts');
    expect(block).toContain('이번 턴만');
  });

  it('상한을 넘으면 줄을 덜어내되 머리말·꼬리말은 남긴다', () => {
    const many = Array.from({ length: 40 }, (_, i) => `/very/long/path/segment/number/${i}/file-${i}.ts`);
    const block = buildRecoveryBlock({ ...emptyNotCarried(), openFiles: many, recentEdits: many, runningTasks: many }, 200);
    expect(block.length).toBeLessThanOrEqual(200);
    expect(block.length).toBeGreaterThan(0);
  });

  it('목록이 길면 개수로 접는다', () => {
    const items = Array.from({ length: 20 }, (_, i) => `task-${i}`);
    const block = buildRecoveryBlock({ ...emptyNotCarried(), runningTasks: items });
    expect(block).toContain(RECOVERY_BRIEF_LABELS_KO.more(14));
  });
});
