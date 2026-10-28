import { describe, expect, it } from 'vitest';

/**
 * §5.13 (Y) 40-1 · 40-6 · 40-11 — 소재 공급자는 `studioMedia.ts` 한 곳에서만 선다. 거기서 서야 ① IPC 로 떨어지는 주소가 구간을 묶어 보내고
 * ② 기기 예산(읽개 수·그리기 폭·`UrlSource` 캐시)이 빠지지 않는다. 다른 자리의 `new VideoMediaProvider(` 는 그 둘을 소리 없이 잃는다.
 * 소재 주소도 미디어 모양(`assetUrl`) 하나로만 짓는다.
 */

const SOURCES = import.meta.glob<string>(['/src/**/*.ts', '/src/**/*.tsx', '!/src/**/*.test.ts', '!/src/**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('§5.13 (Y) 40-1 — 소재 공급자를 세우는 자리', () => {
  it('only studioMedia.ts constructs the studio media provider', () => {
    const offenders = Object.entries(SOURCES)
      .filter(([file, src]) => src.includes('new VideoMediaProvider(') && !file.endsWith('/VideoStudio/studioMedia.ts'))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
    expect(Object.entries(SOURCES).some(([file, src]) => file.endsWith('/VideoStudio/studioMedia.ts') && src.includes('new VideoMediaProvider('))).toBe(true);
  });

  it('the studio no longer builds asset URLs from the old byte route', () => {
    const offenders = Object.entries(SOURCES)
      .filter(([file, src]) => file.includes('/VideoStudio/') && /\/api\/app\/vibistudio\/asset\?/.test(src))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});
