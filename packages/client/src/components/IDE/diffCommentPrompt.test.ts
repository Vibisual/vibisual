import { describe, it, expect } from 'vitest';

import { buildDiffCommentPrompt, makeDiffCommentId, DIFF_COMMENT_LINE_MAX, type DiffComment } from './diffCommentPrompt.js';

function c(over: Partial<DiffComment> = {}): DiffComment {
  return {
    id: 'dc-1',
    filePath: 'packages/client/src/App.tsx',
    side: 'after',
    lineNo: 12,
    lineText: '  const x = 1;',
    comment: '이 상수는 config 로 빼줘',
    createdAt: 0,
    ...over,
  };
}

describe('§5.5 #17-30 — diff 리뷰 코멘트 프롬프트 조립', () => {
  it('코멘트가 없으면 빈 문자열 — 호출부가 아무 것도 보내지 않는다', () => {
    expect(buildDiffCommentPrompt([], '고쳐줘')).toBe('');
  });

  it('파일:줄 + 인용 + 코멘트 3줄 한 벌로 조립한다', () => {
    const out = buildDiffCommentPrompt([c()], 'Fix the following review comments.');
    expect(out).toBe(
      'Fix the following review comments.\n\n' +
      '1. packages/client/src/App.tsx:12\n' +
      '   >   const x = 1;\n' +
      '   이 상수는 config 로 빼줘',
    );
  });

  it('여러 건은 번호가 이어지고 빈 줄로 갈린다 — 한 명령에 모아 보낸다', () => {
    const out = buildDiffCommentPrompt([c(), c({ id: 'dc-2', lineNo: 30, comment: '여기도' })], 'H');
    expect(out).toContain('1. packages/client/src/App.tsx:12');
    expect(out).toContain('2. packages/client/src/App.tsx:30');
    expect(out.split('\n\n')).toHaveLength(3); // 머리말 + 2건
  });

  it('줄 번호가 없으면(대응 줄 없는 diff 빈 칸) 경로만 적는다', () => {
    expect(buildDiffCommentPrompt([c({ lineNo: null })], 'H')).toContain('1. packages/client/src/App.tsx\n');
  });

  it('파일 경로는 화면에 보이는 문자열 그대로 — 정규화하지 않는다', () => {
    const out = buildDiffCommentPrompt([c({ filePath: 'C:\\repo\\a b\\App.tsx' })], 'H');
    expect(out).toContain('C:\\repo\\a b\\App.tsx:12');
  });

  it('긴 줄은 잘라 말줄임 — 인용 한 줄이 프롬프트를 삼키지 않는다', () => {
    const out = buildDiffCommentPrompt([c({ lineText: 'x'.repeat(DIFF_COMMENT_LINE_MAX + 50) })], 'H');
    expect(out).toContain(`   > ${'x'.repeat(DIFF_COMMENT_LINE_MAX)}…`);
  });

  it('여러 줄이 들어와도 인용은 한 줄로 눕힌다', () => {
    const out = buildDiffCommentPrompt([c({ lineText: 'a\nb' })], 'H');
    expect(out).toContain('   > a b');
  });

  it('빈 줄(빈 칸)에는 인용 줄을 넣지 않는다', () => {
    const out = buildDiffCommentPrompt([c({ lineText: '' })], 'H');
    expect(out).toBe('H\n\n1. packages/client/src/App.tsx:12\n   이 상수는 config 로 빼줘');
  });

  it('코멘트 앞뒤 공백은 다듬는다', () => {
    expect(buildDiffCommentPrompt([c({ comment: '  손봐줘  ' })], 'H')).toContain('   손봐줘');
  });

  it('id 는 같은 ms 에 만들어도 겹치지 않는다', () => {
    const ids = new Set(Array.from({ length: 200 }, () => makeDiffCommentId()));
    expect(ids.size).toBe(200);
  });
});
