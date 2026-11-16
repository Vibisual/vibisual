import { describe, expect, it } from 'vitest';
import { splitCardTextPaths, type CardTextSegment } from './cardTextPaths.js';

/** §5.5 #17-27 ⑬ (l) — 카드 평문의 경로 후보: 묶음·낱말·문장부호·조사·경로가 아닌 것, 그리고 이어 붙이면 원문 그대로. */

const ROOT = 'C:/repo';

const paths = (segments: CardTextSegment[]): string[] =>
  segments.flatMap((s) => (s.kind === 'path' ? [s.text] : []));
const joined = (segments: CardTextSegment[]): string =>
  segments.map((s) => s.text).join('');

describe('splitCardTextPaths — 낱말', () => {
  it('문장 속 절대 폴더 경로(한글 포함)를 한 후보로 집는다', () => {
    const text = '폴더 C:/repo/test/실험-3/out-clones/listen/ 의 8개를 들어 보세요.';
    const segments = splitCardTextPaths(text, ROOT);
    expect(paths(segments)).toEqual(['C:/repo/test/실험-3/out-clones/listen/']);
    expect(segments.find((s) => s.kind === 'path')).toMatchObject({
      candidate: { scope: 'inside', relPath: 'test/실험-3/out-clones/listen' },
    });
  });

  it('역슬래시 경로와 루트 밖 경로·POSIX 경로도 후보다', () => {
    expect(paths(splitCardTextPaths('열기 C:\\repo\\docs\\a.md 완료', ROOT))).toEqual(['C:\\repo\\docs\\a.md']);
    expect(splitCardTextPaths('D:/other/out 에 저장', ROOT).find((s) => s.kind === 'path'))
      .toMatchObject({ candidate: { scope: 'outside', absPath: 'D:/other/out' } });
    expect(splitCardTextPaths('/srv/work/out 에 저장', '/srv/work/proj').find((s) => s.kind === 'path'))
      .toMatchObject({ candidate: { scope: 'outside', absPath: '/srv/work/out' } });
  });

  it('상대 경로·확장자 있는 이름·줄 표기를 받는다', () => {
    expect(paths(splitCardTextPaths('out-clones/listen 확인', ROOT))).toEqual(['out-clones/listen']);
    expect(paths(splitCardTextPaths('README.md 확인', ROOT))).toEqual(['README.md']);
    expect(splitCardTextPaths('src/App.tsx:42 수정', ROOT).find((s) => s.kind === 'path'))
      .toMatchObject({ text: 'src/App.tsx:42', candidate: { relPath: 'src/App.tsx', lines: { start: 42, end: 42 } } });
  });

  it('끝의 문장부호·둘러싼 괄호는 경로에 넣지 않는다', () => {
    expect(paths(splitCardTextPaths('결과는 docs/a.md.', ROOT))).toEqual(['docs/a.md']);
    expect(paths(splitCardTextPaths('(docs/a.md), docs/b.md: 끝', ROOT))).toEqual(['docs/a.md', 'docs/b.md']);
    expect(paths(splitCardTextPaths('**docs/a.md**', ROOT))).toEqual(['docs/a.md']);
  });
});

describe('splitCardTextPaths — 묶인 조각', () => {
  it('백틱·큰따옴표·낫표 안의 공백 든 절대 경로를 한 덩어리로 읽는다', () => {
    for (const text of ['`C:/repo/my docs/a.txt` 입니다', '"C:/repo/my docs/a.txt" 입니다', '「C:/repo/my docs/a.txt」 입니다']) {
      expect(paths(splitCardTextPaths(text, ROOT))).toEqual(['C:/repo/my docs/a.txt']);
    }
  });

  it('묶음 기호는 평문으로 남고, 묶인 조각에서는 조사를 떼지 않는다', () => {
    const segments = splitCardTextPaths('`docs/a.md`를 보세요', ROOT);
    expect(joined(segments)).toBe('`docs/a.md`를 보세요');
    expect(segments.find((s) => s.kind === 'path')).toMatchObject({ text: 'docs/a.md', core: null });
  });
});

describe('splitCardTextPaths — 붙은 조사', () => {
  it('조사가 바로 붙으면 통째 후보와 뗀 후보를 함께 들고 간다(디스크가 고른다)', () => {
    const segment = splitCardTextPaths('docs/listen/의 파일', ROOT).find((s) => s.kind === 'path');
    expect(segment).toMatchObject({
      text: 'docs/listen/의',
      candidate: { relPath: 'docs/listen/의' },
      core: { text: 'docs/listen/', tail: '의', candidate: { relPath: 'docs/listen' } },
    });
  });

  it('확장자 뒤 조사 — 통째로는 경로 모양이 아니어도 뗀 경로로 후보가 된다', () => {
    const segment = splitCardTextPaths('보고서.md를 고쳤습니다', ROOT).find((s) => s.kind === 'path');
    expect(segment).toMatchObject({ text: '보고서.md를', candidate: null, core: { text: '보고서.md', tail: '를' } });
  });

  it('긴 조사가 짧은 조사보다 먼저 걸린다', () => {
    const segment = splitCardTextPaths('C:/repo/살아남기에서 작업', ROOT).find((s) => s.kind === 'path');
    expect(segment).toMatchObject({ core: { text: 'C:/repo/살아남기', tail: '에서' } });
  });
});

describe('splitCardTextPaths — 경로가 아닌 것', () => {
  it('평범한 글·명령·주소·플래그는 평문이다', () => {
    for (const text of ['그냥 문장입니다', 'pnpm build 통과', 'https://example.com/a.txt 참고', '--effort 값', '@vibisual/shared 패키지']) {
      expect(paths(splitCardTextPaths(text, ROOT))).toEqual([]);
    }
  });

  it('루트를 모르면 아무것도 손잡이가 되지 않는다', () => {
    expect(splitCardTextPaths('C:/repo/a.md', null)).toEqual([{ kind: 'text', text: 'C:/repo/a.md' }]);
  });

  it('빈 글도 깨지지 않는다', () => {
    expect(splitCardTextPaths('', ROOT)).toEqual([]);
  });
});

describe('splitCardTextPaths — 원문 보존·상한', () => {
  it('이어 붙이면 원문과 한 글자도 다르지 않다', () => {
    const text = '폴더 C:/repo/a/ 의 파일, `docs/b.md` 와 "C:/repo/c d/e.txt" 그리고 src/f.ts를\n다음 줄 docs/g.md.';
    expect(joined(splitCardTextPaths(text, ROOT))).toBe(text);
  });

  it('후보 수에 상한이 있고, 넘는 부분은 평문으로 남는다', () => {
    const text = Array.from({ length: 200 }, (_, i) => `docs/f${i}.md`).join(' ');
    const segments = splitCardTextPaths(text, ROOT);
    expect(paths(segments)).toHaveLength(64);
    expect(joined(segments)).toBe(text);
  });
});
