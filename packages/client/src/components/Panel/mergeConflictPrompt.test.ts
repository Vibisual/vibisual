import { describe, it, expect } from 'vitest';

import { buildMergeConflictPrompt, MERGE_CONFLICT_FILES_MAX } from './mergeConflictPrompt.js';

describe('§7.6 — 워크트리 합치기 충돌을 에이전트에게 넘기는 명령', () => {
  it('충돌 파일이 없으면 빈 문자열 — 보낼 것이 없다', () => {
    expect(buildMergeConflictPrompt({ branch: 'wt-a', conflicts: [] }, 'H')).toBe('');
    expect(buildMergeConflictPrompt({ branch: 'wt-a', conflicts: ['  ', ''] }, 'H')).toBe('');
  });

  it('브랜치와 충돌 파일 목록을 그대로 싣는다', () => {
    const out = buildMergeConflictPrompt(
      { branch: 'wt-a', baseBranch: 'main', conflicts: ['src/a.ts', 'src/b.ts'] },
      '본선에 합치려는데 충돌했어. 해결해줘.',
    );
    expect(out).toBe(
      '본선에 합치려는데 충돌했어. 해결해줘.\n\n' +
      'merge: wt-a -> main\n' +
      'conflicts:\n' +
      '- src/a.ts\n' +
      '- src/b.ts',
    );
  });

  it('base 브랜치를 모르면 화살표 없이 브랜치만 적는다', () => {
    const out = buildMergeConflictPrompt({ branch: 'wt-a', conflicts: ['x.ts'] }, 'H');
    expect(out).toContain('merge: wt-a\n');
    expect(out).not.toContain('->');
  });

  it('파일이 많으면 상한까지만 싣고 나머지는 개수로 말한다', () => {
    const many = Array.from({ length: MERGE_CONFLICT_FILES_MAX + 7 }, (_, i) => `f${i}.ts`);
    const out = buildMergeConflictPrompt({ branch: 'wt-a', conflicts: many }, 'H');
    expect(out).toContain(`- f${MERGE_CONFLICT_FILES_MAX - 1}.ts`);
    expect(out).not.toContain(`- f${MERGE_CONFLICT_FILES_MAX}.ts\n`);
    expect(out).toContain('- … +7');
  });

  it('경로 문자열은 손대지 않는다(윈도우 경로·공백 포함)', () => {
    const out = buildMergeConflictPrompt({ branch: 'wt-a', conflicts: ['packages/a b/c.ts'] }, 'H');
    expect(out).toContain('- packages/a b/c.ts');
  });
});
