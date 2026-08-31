import { describe, it, expect } from 'vitest';

/**
 * 입력칸 우클릭 메뉴 규약의 **집행** — 앞으로 만들 입력칸도 자동으로 이 규칙 안에 들어오게 한다.
 *
 * 규약 둘.
 *  ① 전역 메뉴(`components/Layout/GlobalTextFieldContextMenu.tsx`)는 **부팅 지점에서 한 번** 마운트한다.
 *     빠지면 앱 전체의 입력칸이 조용히 우클릭 무반응으로 돌아간다(고장이 화면에 안 뜬다).
 *  ② `<input>`·`<textarea>` 가 **자기 `onContextMenu` 를 달았다면** `data-text-menu="own"` 도 달아야 한다.
 *     전역이 capture 단계에서 먼저 가로채므로, 표시가 없으면 그 컴포넌트의 메뉴는 **불리지 않는
 *     죽은 코드**가 된다 — 짠 사람은 배선했다고 믿고, 사용자는 다른 메뉴를 본다.
 *
 * 소스를 읽지만 `node:fs` 를 쓰지 않는다 — 클라이언트 tsconfig 에는 Node 타입이 없다
 * (`popupDismissContract.test.ts` 와 같은 이유·같은 방식).
 */

const tsxSources = import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true });

/** glob 키(이 파일=`src/hooks/` 기준 상대 경로)를 src 기준 경로로 편다. */
function toSrcPath(key: string): string {
  const out: string[] = [];
  for (const part of `hooks/${key}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function collectSources(): { path: string; text: string }[] {
  return Object.entries(tsxSources as Record<string, string>)
    .map(([key, text]) => ({ path: toSrcPath(key), text }))
    .filter(({ path }) => !/[.]test[.]tsx?$/.test(path))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** `<input …>` 여는 태그 하나를 통째로 집는다(속성 안 `=>` 의 `>` 에 속지 않게 중괄호 깊이를 센다). */
function openingTagAt(src: string, start: number): string | null {
  let depth = 0;
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return src.slice(start, i + 1);
  }
  return null;
}

const FIELD_HEAD = /^<(input|textarea)[^A-Za-z]/;

function lineOf(src: string, index: number): number {
  return src.slice(0, index).split('\n').length;
}

describe('입력칸 우클릭 메뉴 규약 집행', () => {
  const sources = collectSources();

  it('스캔 대상 소스를 실제로 읽는다', () => {
    // glob 이 조용히 비면 아래 검사가 항상 통과해 규약이 무력해진다.
    expect(sources.length).toBeGreaterThan(50);
  });

  it('전역 메뉴는 부팅 지점(main.tsx)에서 마운트된다', () => {
    const main = sources.find((s) => s.path === 'main.tsx');
    expect(main, 'main.tsx 를 찾지 못했다').toBeDefined();
    expect(main?.text).toContain('<GlobalTextFieldContextMenu />');
  });

  it('자기 우클릭 메뉴를 단 입력칸은 data-text-menu="own" 으로 전역에 알린다', () => {
    const violations: string[] = [];
    for (const { path, text } of sources) {
      for (let i = 0; i < text.length; i++) {
        if (text[i] !== '<' || !FIELD_HEAD.test(text.slice(i, i + 11))) continue;
        const tag = openingTagAt(text, i);
        if (tag === null) continue;
        const tagStart = i;
        i += tag.length - 1;
        if (!tag.includes('onContextMenu')) continue;
        if (tag.includes('data-text-menu="own"')) continue;
        violations.push(`${path}:${lineOf(text, tagStart)}`);
      }
    }
    expect(
      violations,
      '자기 메뉴를 달았으면 data-text-menu="own" 도 달아야 한다 — 없으면 전역이 먼저 가로채 그 메뉴가 죽는다',
    ).toEqual([]);
  });
});
