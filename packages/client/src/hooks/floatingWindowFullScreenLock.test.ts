import { describe, expect, it } from 'vitest';

/**
 * 앱 안의 떠 있는 창은 폰 폭·터치 기기에서 화면 전체로 고정한다(`useFloatingWindowFullScreenLock` — hooks/useIsMobile.ts).
 * `lockFullScreen` 을 빠뜨린 창은 폰에서 320px 하한 창에 앱 화면이 짓눌리고, 터치에서는 끌기·크기 조절이 마우스 이벤트라 손가락으로 옮길 수 없다 — 그래서 소스로 못 박는다.
 * `node:fs` 대신 `import.meta.glob(?raw)` — 클라이언트 tsconfig 에 Node 타입이 없다(`typographyFloor.test.ts` 와 같은 제약).
 */
const sources = import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const CALLS_HOOK = /\buseFloatingWindow\(\{/;
const PASSES_LOCK = /useFloatingWindowFullScreenLock\(\)[\s\S]*\blockFullScreen\b/;

const callers = Object.keys(sources)
  .filter((path) => !path.endsWith('.test.tsx') && CALLS_HOOK.test(sources[path]!))
  .sort();

describe('떠 있는 창은 폰·터치에서 화면 전체로 고정한다', () => {
  it('useFloatingWindow 를 쓰는 창을 실제로 찾는다(빈 glob 헛통과 방지 — 앱·캡처·클립·검증 시연 창)', () => {
    expect(callers.length).toBeGreaterThanOrEqual(4);
  });

  it('판정식이 잠금을 빠뜨린 소스를 실제로 잡는다', () => {
    const forgot = 'const fw = useFloatingWindow({ cascade: 0, onInteractStart: bring });';
    expect(CALLS_HOOK.test(forgot)).toBe(true);
    expect(PASSES_LOCK.test(forgot)).toBe(false);
  });

  it.each(callers)('%s — 공용 판정을 lockFullScreen 으로 넘긴다', (path) => {
    expect(sources[path]).toMatch(PASSES_LOCK);
  });
});
