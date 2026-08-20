import { describe, it, expect } from 'vitest';
import { REVIEW_REJECT_FILES_MAX } from '@vibisual/shared';

import { buildReviewRejectPrompt } from './reviewRejectPrompt.js';

describe('§5.16 — 반려 사유를 그 에이전트의 다음 프롬프트로 만드는 조립', () => {
  it('사유가 비면 빈 문자열 — 보낼 것이 없다(사유 없는 반려는 고칠 근거가 없다)', () => {
    expect(buildReviewRejectPrompt({ reason: '' }, 'H')).toBe('');
    expect(buildReviewRejectPrompt({ reason: '   ' }, 'H')).toBe('');
  });

  it('머리말 + 사유 + 브랜치 + 파일 목록을 그대로 싣는다', () => {
    const out = buildReviewRejectPrompt(
      {
        reason: '에러 처리가 빠졌어. try/catch 로 감싸줘.',
        branch: 'wt-a',
        baseBranch: 'main',
        files: ['src/a.ts', 'src/b.ts'],
      },
      '이 변경은 반려됐어. 아래 사유대로 고쳐줘.',
    );
    expect(out).toBe(
      '이 변경은 반려됐어. 아래 사유대로 고쳐줘.\n\n'
      + '에러 처리가 빠졌어. try/catch 로 감싸줘.\n\n'
      + 'review: wt-a -> main\n'
      + 'files:\n'
      + '- src/a.ts\n'
      + '- src/b.ts',
    );
  });

  it('base 브랜치를 모르면 화살표 없이 브랜치만 적는다', () => {
    const out = buildReviewRejectPrompt({ reason: 'r', branch: 'wt-a' }, 'H');
    expect(out).toContain('review: wt-a');
    expect(out).not.toContain('->');
  });

  it('브랜치를 모르면 브랜치 줄 없이 파일 목록만 붙는다', () => {
    const out = buildReviewRejectPrompt({ reason: 'r', files: ['x.ts'] }, 'H');
    expect(out).not.toContain('review:');
    expect(out).toBe('H\n\nr\n\nfiles:\n- x.ts');
  });

  it('파일이 많으면 상한까지만 싣고 나머지는 개수로 말한다', () => {
    const many = Array.from({ length: REVIEW_REJECT_FILES_MAX + 5 }, (_, i) => `f${i}.ts`);
    const out = buildReviewRejectPrompt({ reason: 'r', files: many }, 'H');
    expect(out).toContain(`- f${REVIEW_REJECT_FILES_MAX - 1}.ts`);
    expect(out).not.toContain(`- f${REVIEW_REJECT_FILES_MAX}.ts\n`);
    expect(out).toContain('- … +5');
  });

  it('사유·경로 문자열은 손대지 않는다(공백 포함 경로·여러 줄 사유)', () => {
    const out = buildReviewRejectPrompt(
      { reason: '첫 줄\n둘째 줄', files: ['packages/a b/c.ts'] },
      'H',
    );
    expect(out).toContain('첫 줄\n둘째 줄');
    expect(out).toContain('- packages/a b/c.ts');
  });
});
