/**
 * §5.4 #31 (K) — 선택 초점의 상시 비용 계약(DOM 없는 시험이라 소스로 못 박는다).
 * SVG 요소에 회전을 걸면 배율 ≠100%(Windows 150% 등)에서 Chromium 이 합성을 못 해(compositeFailed 1024) 매 프레임 레이어를 다시 짠다.
 * 흐르는 선을 매 프레임 옮기면 밑의 흐린 버블까지 다시 그린다.
 */
import { describe, expect, it } from 'vitest';
// CSS 원문은 설정 파일이 넘겨 준다 — `?raw` 도 `import.meta.glob` 도 CSS 에서는 빈 문자열이 온다
// (`vitest.config.ts` 의 `vibisual:css-source` 주석).
import indexCss from 'virtual:vibisual-css-source/index';

const sources = import.meta.glob('./*.tsx', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const INDEX_CSS = indexCss.replace(/\r\n/g, '\n');

function source(path: string): string {
  const found = sources[path];
  if (found === undefined) throw new Error(`소스를 못 찾음: ${path}`);
  return found;
}

describe('선택 코로나는 HTML 요소가 돌린다 (§5.4 #31 (K))', () => {
  it('어떤 SVG 요소에도 회전을 걸지 않는다', () => {
    for (const [path, text] of Object.entries(sources)) {
      expect(text, path).not.toMatch(/<svg[^>]*animate-sun-spin/);
    }
  });

  it('버블과 첫 선택 예열이 같은 코로나를 그린다 — 모양이 어긋나면 예열이 헛돈다', () => {
    expect(source('./SunCorona.tsx')).toMatch(/<div\s+className=\{`animate-sun-spin /);
    expect(source('./BubbleNode.tsx')).toMatch(/<SunCorona\b/);
    expect(source('./CoronaWarmup.tsx')).toMatch(/<SunCorona\b/);
  });
});

describe('흐르는 선은 초당 24번 옮긴다 (§5.4 #31 (K))', () => {
  it('React Flow 기본 CSS 가 어느 순서로 실려도 이기는 선택자로 계단을 건다', () => {
    expect(INDEX_CSS.length, 'index.css 를 못 읽었습니다').toBeGreaterThan(0);
    expect(INDEX_CSS).toMatch(/\.react-flow \.react-flow__edge\.animated path \{\s*animation-timing-function: steps\(12, end\);/);
  });
});
