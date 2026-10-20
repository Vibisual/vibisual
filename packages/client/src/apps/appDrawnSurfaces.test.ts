import { describe, expect, it } from 'vitest';

/**
 * §5.4 #15 (C) — 앱 창 안의 **그린 화면**(캔버스 · WebGL · 그림을 그리는 SVG)은 Alt 인스펙터 집기 공급자를 단다.
 *
 * 브라우저는 그린 화면의 판 하나만 안다. 공급자가 없으면 그 위 어디를 가리켜도 판이 통째로 집히고, 사용자는 "이 글자 · 이 클립 ·
 * 이 바퀴"를 가리켜 고치라고 말할 수 없다(사용자 보고 — 같은 지시 세 번). 영상 미리보기만 고쳐 두면 다른 앱이 같은 자리에서 또
 * 막히므로, 앱 폴더의 화면 파일이 판을 그리면 공급자도 다는지 소스로 센다.
 *
 * 앱 폴더는 레지스트리의 늦은 로더가 가리키는 곳에서 읽는다 — 목록을 따로 적으면 새 앱이 빠진다. 소스는 `import.meta.glob`
 * (`?raw`)로 읽는다(클라이언트 tsconfig 에는 Node 타입이 없다 — `inspectorOverlayLayer.test.ts` 와 같은 방식).
 */

const registry = import.meta.glob('./registry.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const components = import.meta.glob('../components/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** 판을 그리는 자리 — 2D·WebGL 캔버스, 문서 크기를 viewBox 로 받는 SVG(아이콘의 고정 `viewBox="0 0 24 24"` 는 아니다). */
const DRAWN = /<canvas\b|\bWebGLRenderer\(|\bviewBox=\{/;
const PICKS = /\buseInspectorPicker\(|\bregisterInspectorPicker\(/;

/**
 * 판을 그리지만 공급자가 필요 없는 화면 — 파일 경로(glob 열쇠)와 이유. 넣을 때는 사람이 가리킬 안쪽이 정말 없는지부터 본다.
 */
const EXEMPT: Readonly<Record<string, string>> = {};

function appFolders(): string[] {
  const text = Object.values(registry)[0] ?? '';
  return [...new Set([...text.matchAll(/import\('\.\.\/components\/([^/']+)\//g)].map((m) => m[1]!))];
}

describe('앱 창 안의 그린 화면은 Alt 인스펙터 집기 공급자를 단다', () => {
  it('reads the app folders from the registry loaders', () => {
    expect(appFolders().length).toBeGreaterThan(0);
  });

  it('every drawn surface in an app folder registers a pick provider (or is exempt with a reason)', () => {
    const folders = appFolders();
    const missing = Object.entries(components)
      .filter(([file]) => !/\.test\.tsx$/.test(file) && folders.some((folder) => file.startsWith(`../components/${folder}/`)))
      .filter(([file, text]) => DRAWN.test(text) && !PICKS.test(text) && !(file in EXEMPT))
      .map(([file]) => file);
    expect(missing, 'draw on a canvas/SVG → add useInspectorPicker (utils/inspectorPick.ts, §5.4 #15 (C))').toEqual([]);
  });

  it('keeps the exemption list honest — every entry still draws and has a reason', () => {
    for (const [file, reason] of Object.entries(EXEMPT)) {
      expect(components[file], file).toBeDefined();
      expect(DRAWN.test(components[file] ?? ''), file).toBe(true);
      expect(reason.trim().length, file).toBeGreaterThan(10);
    }
  });
});
