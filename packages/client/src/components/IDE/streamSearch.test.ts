/**
 * streamSearch.test.ts — 인-페이지 검색(Ctrl+F)이 **본문 텍스트만** 훑는지 못박는다.
 *
 * 회귀 방지 지점: 명령창(사용자 프롬프트)·도구 입출력·시스템 줄·계획·결과·오류가 다시 검색에
 * 걸리기 시작하면(넓히는 쪽으로의 회귀), 사용자가 찾던 문장 대신 그 앞의 도구 출력으로 끌려간다.
 */
import { describe, it, expect } from 'vitest';
import { isFindableTextKind, streamItemFindText, findTextMatches } from './streamSearch.js';
import type { StreamDisplayItem } from './streamDensity.js';

const ts = 1_700_000_000_000;

describe('isFindableTextKind', () => {
  it('본문 텍스트만 검색 대상이다', () => {
    expect(isFindableTextKind('text')).toBe(true);
  });

  it('명령·도구·시스템·결과·오류·사고는 대상이 아니다', () => {
    for (const kind of ['command', 'tool_use', 'tool_result', 'result', 'system', 'error', 'thinking', 'plan', 'toolgroup', 'tool']) {
      expect(isFindableTextKind(kind)).toBe(false);
    }
  });
});

describe('streamItemFindText', () => {
  it('text 항목은 본문을 그대로 준다', () => {
    const item: StreamDisplayItem = { kind: 'text', id: 't1', content: '검색 이동 경로를 넣겠습니다', timestamp: ts };
    expect(streamItemFindText(item)).toBe('검색 이동 경로를 넣겠습니다');
  });

  it('명령(프롬프트)은 검색에 걸리지 않는다', () => {
    const item: StreamDisplayItem = { kind: 'command', id: 'cmd-1', prompt: '검색 고쳐줘', result: '검색 완료', status: 'completed', timestamp: ts };
    expect(streamItemFindText(item)).toBe('');
  });

  it('도구 입출력은 검색에 걸리지 않는다', () => {
    const item: StreamDisplayItem = { kind: 'tool', id: 'tool-1', toolName: 'Grep', input: '검색어', output: '검색 결과 3건', timestamp: ts, isActive: false };
    expect(streamItemFindText(item)).toBe('');
  });

  it('도구 묶음은 자식 도구의 내용까지 안 걸린다', () => {
    const child: StreamDisplayItem = { kind: 'tool', id: 'tool-2', toolName: 'Read', input: '검색', output: '검색', timestamp: ts, isActive: false };
    const item: StreamDisplayItem = { kind: 'toolgroup', id: 'tg-1', toolCount: 1, toolNames: ['Read'], children: [child], active: false, timestamp: ts };
    expect(streamItemFindText(item)).toBe('');
  });

  it('시스템 줄·결과·오류는 검색에 걸리지 않는다', () => {
    expect(streamItemFindText({ kind: 'system', id: 's1', content: '검색 시스템 줄', timestamp: ts })).toBe('');
    expect(streamItemFindText({ kind: 'result', id: 'r1', content: '검색 결과 블록', timestamp: ts })).toBe('');
    expect(streamItemFindText({ kind: 'error', id: 'e1', content: '검색 실패', timestamp: ts })).toBe('');
  });

  it('계획 블록은 검색에 걸리지 않는다', () => {
    const item: StreamDisplayItem = {
      kind: 'plan', id: 'p1', timestamp: ts,
      todos: [{ content: '검색 좁히기', status: 'pending' }],
    };
    expect(streamItemFindText(item)).toBe('');
  });
});

describe('findTextMatches', () => {
  it('대소문자·앞뒤 공백을 무시하고 부분 일치로 찾는다', () => {
    expect(findTextMatches('Now 검색 이동 경로', '  검색 ')).toBe(true);
    expect(findTextMatches('navigateSearch 를 넣었다', 'NAVIGATESEARCH')).toBe(true);
  });

  it('빈 질의는 아무것도 찾지 않는다', () => {
    expect(findTextMatches('아무 본문', '')).toBe(false);
    expect(findTextMatches('아무 본문', '   ')).toBe(false);
  });

  it('없는 말은 안 걸린다', () => {
    expect(findTextMatches('본문 텍스트', '명령창')).toBe(false);
  });
});
