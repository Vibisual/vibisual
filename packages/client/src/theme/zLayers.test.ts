import { describe, expect, it } from 'vitest';
import { Z_LAYER, Z_LAYER_CLASS_TOKENS, type ZLayerName } from './zLayers.js';
// CSS 원문은 설정 파일이 넘겨 준다 — `?raw` 는 CSS 에서 빈 문자열이 온다.
import indexCss from 'virtual:vibisual-css-source/index';

/** §4 겹침 층 표 — 순서가 곧 기획이다. 값을 바꿔도 이 순서는 지켜져야 한다. */
const ORDER: ZLayerName[] = [
  'CANVAS_DRAG', 'IDE_PANE', 'IDE', 'BOARD', 'WINDOW', 'DIALOG', 'DIALOG_OVER', 'USAGE', 'USAGE_OVER', 'HEADER', 'OVERLAY', 'LIGHTBOX', 'PERMISSION',
  'GATE', 'GATE_LOGIN', 'GATE_SETUP', 'GATE_ENGINE', 'GATE_NOTICE', 'GATE_LANGUAGE',
  'MENU', 'TOAST', 'TOOLTIP', 'DRAG', 'IMMERSIVE_EXIT', 'APP_DIALOG', 'STUDIO_POPOVER', 'DRAG_GHOST',
];

describe('§4 겹침 층 표', () => {
  it('표의 모든 층이 정해진 순서로 오른다', () => {
    expect([...ORDER].sort()).toEqual(Object.keys(Z_LAYER).sort());
    for (let i = 1; i < ORDER.length; i += 1) {
      expect(Z_LAYER[ORDER[i]!], `${ORDER[i - 1]} < ${ORDER[i]}`).toBeGreaterThan(Z_LAYER[ORDER[i - 1]!]);
    }
  });

  it('사용량 팝업은 앱 안 창과 다른 모달보다 위, 권한 요청·게이트보다는 아래다', () => {
    expect(Z_LAYER.USAGE).toBeGreaterThan(Z_LAYER.DIALOG_OVER);
    expect(Z_LAYER.USAGE_OVER).toBeLessThan(Z_LAYER.PERMISSION);
  });

  it('앱 안 창 스택이 자라도 모달 층에 닿지 않는다', () => {
    // 누를 때마다 1씩 자란다 — 한 세션에 닿을 수 없는 간격이어야 한다.
    expect(Z_LAYER.DIALOG - Z_LAYER.WINDOW).toBeGreaterThan(10_000_000);
  });

  it('권한 요청 스택과 게이트의 언어 목록(+100)이 다음 층을 넘지 않는다', () => {
    expect(Z_LAYER.PERMISSION + 10_000).toBeLessThan(Z_LAYER.GATE);
    expect(Z_LAYER.GATE_LANGUAGE + 100).toBeLessThan(Z_LAYER.MENU);
  });

  it('Tailwind 이름표(index.css @theme)가 표와 같은 값이다', () => {
    expect(indexCss.length, 'index.css 를 못 읽었습니다').toBeGreaterThan(0);
    const css: Record<string, number> = {};
    for (const m of indexCss.matchAll(/--z-index-([a-z-]+):\s*(\d+);/g)) css[m[1]!] = Number(m[2]);
    const expected = Object.fromEntries(Object.entries(Z_LAYER_CLASS_TOKENS).map(([token, name]) => [token, Z_LAYER[name]]));
    expect(css).toEqual(expected);
  });
});
