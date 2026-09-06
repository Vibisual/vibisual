/**
 * §5.5 #17-7 v3.46 — **인-페이지 검색이 찾은 자리를 "드래그 선택처럼" 칠하고 그리로 옮기는가.**
 *
 * 사용자 지시: "내가 검색한거 선택으로 해당 위치 잘보이게 칠해줘야지 그러니까 이용자가 드래그해서
 * 텍스트 선택한것 처럼 그리고 해당 위치로 포커싱".
 *
 * 종전 결함 둘 — ① 매칭 **판정**(`streamSearch.findTextMatches`)은 대소문자를 무시하는데 칠할 자리를
 * 찾는 쪽(`findTextRangeInContainer`)은 대소문자를 그대로 봐서, `Error` 를 `error` 로 검색하면 이동은
 * 하는데 아무것도 안 칠해졌다. ② 칠하더라도 **항목 전체**를 화면 중앙에 놓았기 때문에, 카드가 화면보다
 * 길면 정작 검색어가 든 줄은 화면 밖에 남았다.
 *
 * 이 두 결함은 DOM Range 위에서 산다 — 클라이언트 테스트에는 jsdom 이 없어(`vitest.config.ts`) Range 를
 * 실제로 만들어 볼 수 없다. 그래서 되돌아가면 결함이 그대로 되살아나는 **배선과 CSS 계약**을 고정한다.
 */

import { describe, expect, it } from 'vitest';
// CSS 원문은 설정 파일이 넘겨 준다 — `?raw` 도 `import.meta.glob` 도 CSS 에서는 빈 문자열이 온다
// (`vitest.config.ts` 의 `vibisual:css-source` 주석에 실측과 이유가 있다).
import indexCss from 'virtual:vibisual-css-source/index';
import { findTextMatches } from './streamSearch.js';

const sources = import.meta.glob('./*.{ts,tsx}', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

function source(name: string): string {
  const found = sources[`./${name}`];
  if (found === undefined) throw new Error(`소스를 못 찾음: ${name}`);
  return found;
}

/** `::highlight(<이름>) { … }` 블록의 본문. 없으면 null. */
function highlightBlock(name: string): string | null {
  const at = indexCss.indexOf(`::highlight(${name})`);
  if (at < 0) return null;
  const open = indexCss.indexOf('{', at);
  const close = indexCss.indexOf('}', open);
  if (open < 0 || close < 0) return null;
  return indexCss.slice(open + 1, close);
}

describe('검색 하이라이트 — CSS 계약', () => {
  it('활성 매칭과 나머지 매칭이 각각 제 규칙을 갖는다', () => {
    // 둘 중 하나라도 없으면 그 층은 레지스트리에만 올라가고 화면에는 아무것도 안 보인다.
    expect(highlightBlock('vibisual-find')).not.toBeNull();
    expect(highlightBlock('vibisual-find-all')).not.toBeNull();
  });

  it('두 층의 배경색이 서로 다르다 — 같으면 몇 번째로 이동했는지 구분할 수 없다', () => {
    const active = highlightBlock('vibisual-find') ?? '';
    const rest = highlightBlock('vibisual-find-all') ?? '';
    const bg = (block: string): string =>
      (/background-color:\s*([^;]+);/.exec(block)?.[1] ?? '').trim();
    expect(bg(active)).not.toBe('');
    expect(bg(rest)).not.toBe('');
    expect(bg(active)).not.toBe(bg(rest));
  });

  it('활성 매칭은 앰버(찾기막대)가 아니라 선택 톤 파랑이다', () => {
    // 사용자 지시의 핵심 — "드래그해서 텍스트 선택한 것처럼". 앰버로 되돌리면 여기서 걸린다.
    const active = highlightBlock('vibisual-find') ?? '';
    expect(active).not.toMatch(/#fbbf24/i); // amber-400
    expect(active.toLowerCase()).toContain('#2563eb'); // blue-600
  });
});

describe('검색 하이라이트 — 배선 계약', () => {
  const bookmarkScroll = source('bookmarkScroll.ts');

  it('검색용 탐색기는 대소문자를 무시한다 — 판정(findTextMatches)과 짝이 맞아야 한다', () => {
    // 판정 쪽은 실제로 무시한다(여기가 기준).
    expect(findTextMatches('An Error occurred', 'error')).toBe(true);
    // 칠하는 쪽도 같아야 한다 — findAllTextRanges 가 양쪽을 소문자로 접는지 원문에서 확인.
    const fn = /export function findAllTextRanges[\s\S]*?\n}/.exec(bookmarkScroll)?.[0] ?? '';
    expect(fn).not.toBe('');
    expect(fn).toContain('.toLowerCase()');
  });

  it('검색용 탐색기는 검색어를 60자로 자르지 않는다 — 그 절단은 북마크 전용이다', () => {
    const fn = /export function findAllTextRanges[\s\S]*?\n}/.exec(bookmarkScroll)?.[0] ?? '';
    expect(fn).not.toContain('slice(0, 60)');
  });

  it('검색용 탐색기는 모든 출현을 모은다 — 첫 하나만 찾고 끝내지 않는다', () => {
    const fn = /export function findAllTextRanges[\s\S]*?\n}/.exec(bookmarkScroll)?.[0] ?? '';
    expect(fn).toContain('Range[]');
    expect(fn).toMatch(/while|for/);
  });

  it('하이라이트 지우기는 두 층을 다 거둔다 — 한쪽만 지우면 옅은 칠이 남아 떠다닌다', () => {
    const fn = /export function clearFindHighlight[\s\S]*?\n}/.exec(bookmarkScroll)?.[0] ?? '';
    expect(fn).toContain('FIND_HIGHLIGHT_NAME');
    expect(fn).toContain('FIND_ALL_HIGHLIGHT_NAME');
  });

  it('highlightSearchMatches 는 항목이 아니라 찾은 Range 를 중앙에 놓는다', () => {
    const fn = /export function highlightSearchMatches[\s\S]*?\n}/.exec(bookmarkScroll)?.[0] ?? '';
    expect(fn).not.toBe('');
    expect(fn).toContain('scrollRectIntoCenter');
    expect(fn).toContain('getBoundingClientRect');
    // 항목 중앙 정렬로 되돌아가면(= 검색어가 화면 밖에 남는 종전 결함) 여기서 걸린다.
    expect(fn).not.toContain('scrollElementIntoCenter');
  });

  it('두 탭(메인·Sub)이 모두 검색 경로에서 highlightSearchMatches 를 탄다', () => {
    // 한쪽만 고치면 같은 검색어가 탭에 따라 다르게 연출된다(streamSearch.ts 와 같은 이유).
    for (const file of ['IDEMainArea.tsx', 'StreamRenderer.tsx']) {
      const text = source(file);
      expect(text, file).toContain('highlightSearchMatches');
      // preserveFocus(= 인-페이지 검색)일 때만 타야 한다 — 북마크 "이동" 은 종전 selection 연출 유지.
      expect(text, file).toMatch(/preserveFocus && highlightSearchMatches/);
    }
  });

  it('북마크 "이동" 은 종전대로 selection 으로 잡는다 — 검색 연출이 그쪽을 덮어쓰지 않는다', () => {
    // markRange(range, false) 경로가 살아 있어야 도착 즉시 복사할 수 있다.
    const fn = /export function markRange[\s\S]*?\n}/.exec(bookmarkScroll)?.[0] ?? '';
    expect(fn).toContain('window.getSelection()');
    expect(fn).toContain('sel.addRange(range)');
  });
});
