import { describe, it, expect } from 'vitest';
import { highlightCode } from './codeHighlight.js';
import { languageFromPath } from './codeLanguages.js';

/**
 * §5.5 #17-27 v4.87 — 문법 강조 토크나이저 테스트.
 *
 * 지키는 것 — (a) 줄 수가 원문과 정확히 같다(줄 번호가 밀리면 편집창이 통째로 어긋난다),
 * (b) 토큰을 이어 붙이면 원문 그 줄이 그대로 나온다(글자가 사라지지 않는다),
 * (c) 주석·문자열·숫자·키워드가 실제로 갈린다, (d) 모르는 언어는 색 없이 평문.
 */

/** 그 줄의 글자를 다시 이어 붙인다 — 손실 여부 검사용. */
function lineText(line: { text: string }[]): string {
  return line.map((t) => t.text).join('');
}

/** 특정 갈래로 칠해진 조각들만 뽑는다. */
function kinds(lines: { text: string; kind: string }[][], kind: string): string[] {
  return lines.flat().filter((t) => t.kind === kind).map((t) => t.text);
}

describe('languageFromPath', () => {
  it('확장자로 언어를 고른다', () => {
    expect(languageFromPath('src/App.tsx')).toBe('ts');
    expect(languageFromPath('C:\\repo\\packages\\shared\\src\\types.ts')).toBe('ts');
    expect(languageFromPath('package.json')).toBe('json');
    expect(languageFromPath('README.md')).toBe('markdown');
    expect(languageFromPath('scripts/run.sh')).toBe('shell');
    expect(languageFromPath('a/b/main.py')).toBe('python');
  });

  it('확장자 없는 잘 알려진 이름도 안다', () => {
    expect(languageFromPath('Dockerfile')).toBe('shell');
    expect(languageFromPath('.gitignore')).toBe('ini');
  });

  it('모르는 확장자는 plain — 아는 척 칠하지 않는다', () => {
    expect(languageFromPath('data.bin')).toBe('plain');
    expect(languageFromPath('LICENSE')).toBe('plain');
  });
});

describe('highlightCode — 손실 없음', () => {
  const source = [
    '// 첫 줄 주석',
    'const greeting = "hello";',
    '',
    '/* 여러',
    '   줄 주석 */',
    'function add(a: number, b: number): number { return a + b; }',
  ].join('\n');

  it('줄 수가 원문과 같다', () => {
    expect(highlightCode(source, 'ts')).toHaveLength(source.split('\n').length);
  });

  it('토큰을 이어 붙이면 원문 그대로다', () => {
    const lines = highlightCode(source, 'ts');
    source.split('\n').forEach((raw, i) => {
      expect(lineText(lines[i]!)).toBe(raw);
    });
  });

  it('빈 줄은 빈 배열', () => {
    expect(highlightCode(source, 'ts')[2]).toEqual([]);
  });

  it('마지막 줄바꿈 뒤의 빈 줄도 한 줄로 센다', () => {
    expect(highlightCode('a\n', 'ts')).toHaveLength(2);
  });
});

describe('highlightCode — 갈래 판정(ts)', () => {
  const lines = highlightCode(
    'const n = 0x1f; // 끝 주석\nlet s = `템플릿 ${n}`;\ntype T = string;\nobj.field = call(1.5e3);',
    'ts',
  );

  it('주석·문자열·숫자를 가른다', () => {
    expect(kinds(lines, 'comment')).toContain('// 끝 주석');
    expect(kinds(lines, 'string').join('')).toContain('템플릿');
    expect(kinds(lines, 'number')).toContain('0x1f');
    expect(kinds(lines, 'number')).toContain('1.5e3');
  });

  it('키워드·타입·함수·속성을 가른다', () => {
    expect(kinds(lines, 'keyword')).toEqual(expect.arrayContaining(['const', 'let', 'type']));
    expect(kinds(lines, 'type')).toContain('string');
    expect(kinds(lines, 'function')).toContain('call');
    expect(kinds(lines, 'property')).toContain('field');
  });
});

describe('highlightCode — 여러 줄에 걸친 토큰', () => {
  it('블록 주석은 줄 경계에서 잘려 각 줄에 남는다', () => {
    const lines = highlightCode('a;\n/* 주석\n계속 */\nb;', 'ts');
    expect(lines).toHaveLength(4);
    expect(lines[1]![0]!.kind).toBe('comment');
    expect(lines[2]![0]!.kind).toBe('comment');
    expect(lineText(lines[2]!)).toBe('계속 */');
  });

  it('닫히지 않은 문자열이 파일 나머지를 삼키지 않는다(줄 끝에서 끊긴다)', () => {
    const lines = highlightCode('const a = "안 닫힘\nconst b = 2;', 'ts');
    expect(lines).toHaveLength(2);
    expect(kinds(lines, 'keyword')).toContain('const');
    expect(lineText(lines[1]!)).toBe('const b = 2;');
  });
});

describe('highlightCode — 언어별', () => {
  it('json 은 키를 속성으로, 값 문자열을 문자열로 가른다', () => {
    const lines = highlightCode('{\n  "name": "vibisual",\n  "ok": true\n}', 'json');
    expect(kinds(lines, 'string')).toEqual(expect.arrayContaining(['"name"', '"vibisual"']));
    expect(kinds(lines, 'keyword')).toContain('true');
  });

  it('shell 은 # 주석과 $변수를 가른다', () => {
    const lines = highlightCode('# 설명\necho "$HOME"', 'shell');
    expect(kinds(lines, 'comment')).toContain('# 설명');
    expect(kinds(lines, 'keyword')).toContain('echo');
  });

  it('python 은 삼중 따옴표를 여러 줄 문자열로 본다', () => {
    const lines = highlightCode('def f():\n    """문서\n    문자열"""\n    return 1', 'python');
    expect(lines).toHaveLength(4);
    // 들여쓰기는 평문, 그 뒤 삼중 따옴표부터가 문자열(다음 줄까지 이어진다).
    expect(lines[1]!.at(-1)!.kind).toBe('string');
    expect(lines[2]!.at(-1)!.kind).toBe('string');
    expect(kinds(lines, 'keyword')).toEqual(expect.arrayContaining(['def', 'return']));
  });

  it('markdown 은 제목·코드펜스·인라인 코드를 가른다', () => {
    const lines = highlightCode('# 제목\n본문 `코드` 끝\n```ts\nconst a = 1;\n```', 'markdown');
    expect(lines[0]![0]!.kind).toBe('keyword');
    expect(kinds(lines, 'string')).toContain('`코드`');
    expect(lineText(lines[3]!)).toBe('const a = 1;');
  });

  it('markup 은 태그 이름과 속성을 가른다', () => {
    const lines = highlightCode('<div class="x">hi</div>', 'html');
    expect(kinds(lines, 'keyword')).toEqual(expect.arrayContaining(['div']));
    expect(kinds(lines, 'property')).toContain('class');
    expect(kinds(lines, 'string')).toContain('"x"');
    expect(lineText(lines[0]!)).toBe('<div class="x">hi</div>');
  });

  it('sql 은 대소문자를 가리지 않고 키워드를 잡는다', () => {
    const lines = highlightCode('SELECT * FROM t -- 메모', 'sql');
    expect(kinds(lines, 'keyword')).toEqual(expect.arrayContaining(['SELECT', 'FROM']));
    expect(kinds(lines, 'comment')).toContain('-- 메모');
  });

  it('plain 은 색 없이 한 덩어리', () => {
    const lines = highlightCode('const a = 1;', 'plain');
    expect(lines[0]).toEqual([{ text: 'const a = 1;', kind: 'plain' }]);
  });
});
