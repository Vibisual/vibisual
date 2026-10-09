/**
 * §5.4 #31 (K) 2026-10-09 — 선택 초점의 상시 비용에 관한 소스 계약.
 *
 * 코로나의 회전을 SVG 요소에 걸면 화면 배율이 100% 가 아닐 때(Windows 150% 등) Chromium 이 합성으로
 * 못 돌려(compositeFailed 1024) 초점이 켜져 있는 내내 메인 스레드가 매 프레임 캔버스 레이어를 다시 짰다.
 * 흐르는 선을 매 프레임 옮기면 그 선이 지나는 타일이 밑의 흐려진 버블까지 매 프레임 다시 그려졌다.
 * 둘 다 렌더에서만 드러나는데 클라 시험에는 DOM 이 없어서, 되돌아가면 결함이 되살아나는 자리를 소스로 못 박는다.
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
