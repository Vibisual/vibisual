/**
 * §5.5 #17-6 (B) — **오버레이 창의 OS 캡션은 접힌 버블 캔버스 하나만의 것이다.**
 *
 * `html.overlay-window .react-flow__pane { -webkit-app-region: drag }` 는 v2.73 에 **버블 하나만 뜨는
 * 접힌 창**을 위해 쓴 규칙이다. 그런데 선택자가 창 전체를 받으므로, 그 창을 펼치면(= `AgentIDEOverlay`
 * fullWindow) 접힌 버블 캔버스는 아예 렌더되지 않고 **무대(§5.5 #17-17 ⑭)의 지도 캔버스만** 그 규칙에
 * 걸렸다. 캡션 위에서는 손짓이 렌더러에 도착하지 않아(`index.css` 의 `body.vib-pointer-drag` 주석 ②)
 * ⑭(e) 가 약속한 "팬은 왼쪽·가운데 버튼, 확대는 휠"이 **독립 창에서만** 통째로 죽었다(사용자 보고).
 *
 * 같은 부류의 사고가 이미 한 번 있었다 — 캔버스 `EdgeMask` 의 전역 쿼리가 무대 선까지 칠한 일(§11).
 * 캔버스를 겨냥한 전역 선택자는 무대가 같은 React Flow 를 쓰는 한 **항상** 무대를 함께 잡는다.
 *
 * 화면 시험이 없는 자리라(클라 테스트에 DOM 이 없다) 소스 글자로 못 박는다.
 */

import { describe, expect, it } from 'vitest';
// CSS 원문은 설정 파일이 넘겨 준다 — `?raw` 도 `import.meta.glob` 도 CSS 에서는 빈 문자열이 온다
// (`vitest.config.ts` 의 `vibisual:css-source` 주석에 실측과 이유가 있다).
import indexCss from 'virtual:vibisual-css-source/index';

const tsx = import.meta.glob('./OverlayShell.tsx', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;
const ide = import.meta.glob('../IDE/IDEGoalMapView.tsx', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

function source(map: Record<string, string>, key: string): string {
  const found = map[key];
  if (found === undefined) throw new Error(`소스를 못 찾음: ${key} (있는 키: ${Object.keys(map).join(', ')})`);
  // CRLF 트리라 줄끝을 접고 본다 — 줄끝이 판정에 섞이면 같은 글자가 환경마다 다르게 읽힌다.
  return found.replace(/\r\n/g, '\n');
}

const INDEX_CSS = indexCss.replace(/\r\n/g, '\n');
const OVERLAY_SHELL = source(tsx, './OverlayShell.tsx');
const GOAL_MAP = source(ide, '../IDE/IDEGoalMapView.tsx');

/** 접힌 버블 캔버스를 가리키는 표식. 이 이름이 바뀌면 CSS 와 셸이 **함께** 바뀌어야 한다. */
const MARKER = 'overlay-bubble-canvas';

describe('오버레이 창 드래그 영역은 접힌 버블 캔버스에만 걸린다', () => {
  it('index.css 원문을 읽는다(빈 문자열이면 아래 검사가 전부 헛돈다)', () => {
    expect(INDEX_CSS.length, 'index.css 를 못 읽었습니다').toBeGreaterThan(0);
  });

  it('창 전체를 받는 `.react-flow__pane` 드래그 규칙이 없다', () => {
    // `html.overlay-window` 바로 뒤에 React Flow 클래스가 오면 그 창의 **모든** 캔버스가 캡션이 된다.
    expect(INDEX_CSS).not.toMatch(/html\.overlay-window\s+\.react-flow__(pane|node)\s*[,{]/);
  });

  it('드래그 규칙은 표식으로 좁혀져 있다', () => {
    expect(INDEX_CSS).toContain(`html.overlay-window .${MARKER} .react-flow__pane`);
    expect(INDEX_CSS).toContain(`html.overlay-window .${MARKER} .react-flow__node`);
  });

  it('좁혀진 그 규칙은 여전히 drag / no-drag 한 쌍이다 — 버블 클릭·더블클릭이 죽지 않게', () => {
    const paneAt = INDEX_CSS.indexOf(`html.overlay-window .${MARKER} .react-flow__pane`);
    const nodeAt = INDEX_CSS.indexOf(`html.overlay-window .${MARKER} .react-flow__node`);
    expect(paneAt).toBeGreaterThan(-1);
    expect(nodeAt).toBeGreaterThan(paneAt);
    expect(INDEX_CSS.slice(paneAt, nodeAt)).toContain('-webkit-app-region: drag');
    expect(INDEX_CSS.slice(nodeAt, nodeAt + 200)).toContain('-webkit-app-region: no-drag');
  });

  it('`OverlayShell` 의 접힌 버블 컨테이너가 그 표식을 단다', () => {
    expect(OVERLAY_SHELL).toContain(MARKER);
    // 표식은 **접힘 갈래 안**에 있어야 한다 — 펼친 IDE 쪽에 달면 무대가 도로 캡션이 된다.
    const collapsedAt = OVERLAY_SHELL.indexOf('{!expanded && (');
    const overlayIdeAt = OVERLAY_SHELL.indexOf('<AgentIDEOverlay');
    const markerAt = OVERLAY_SHELL.indexOf(`className="${MARKER}`);
    expect(collapsedAt).toBeGreaterThan(-1);
    expect(overlayIdeAt).toBeGreaterThan(-1);
    expect(markerAt).toBeGreaterThan(collapsedAt);
    expect(markerAt).toBeLessThan(overlayIdeAt);
  });

  it('그 표식을 단 컨테이너가 버블 `<ReactFlow>` 를 감싼다', () => {
    const markerAt = OVERLAY_SHELL.indexOf(`className="${MARKER}`);
    const flowAt = OVERLAY_SHELL.indexOf('<ReactFlow', markerAt);
    expect(flowAt).toBeGreaterThan(markerAt);
    // 사이에 다른 컨테이너가 끼어 캔버스가 표식 밖으로 나가지 않았는지 — 여는 태그 하나 분량만 둔다.
    expect(flowAt - markerAt).toBeLessThan(400);
  });

  it('무대 지도는 스스로 드래그 영역을 선언하지 않는다 — 창 종류와 무관하게 캔버스다', () => {
    expect(GOAL_MAP).not.toContain('app-region');
    expect(GOAL_MAP).not.toContain('app-drag');
  });

  it('무대 지도의 팬은 왼쪽·가운데 버튼 그대로다 (⑭(e))', () => {
    expect(GOAL_MAP).toContain('panOnDrag={[0, 1]}');
  });
});
