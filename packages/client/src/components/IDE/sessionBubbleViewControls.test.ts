/**
 * §5.5 #17-12 · #17-50 — 대화 칸 보기 묶음([버블]은 밀도 토글의 첫 칸)과 지도 손짓(버블 끌기·위성 따라오기, 가운데 더블클릭 → [표준],
 * 파일은 캔버스와 같은 여는 길 · 판은 이 IDE 오른쪽)을 소스 원문으로 지킨다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const mainArea = read('./IDEMainArea.tsx');
const mapView = read('./SessionBubbleView.tsx');

/** `from` 부터 `until` 직전까지. 둘 다 있어야 한다. */
function slice(src: string, from: string, until: string): string {
  const at = src.indexOf(from);
  expect(at).toBeGreaterThanOrEqual(0);
  const end = src.indexOf(until, at + from.length);
  expect(end).toBeGreaterThan(at);
  return src.slice(at, end);
}

describe('[버블]은 보기 묶음 [버블 | 간결 | 표준 | 원문]의 첫 칸이다', () => {
  it('따로 선 [버블] 단추가 없다', () => {
    expect(mainArea).not.toContain('function StreamBubbleToggle');
    expect(mainArea).not.toContain('<StreamBubbleToggle');
    expect(mainArea).not.toContain('function StreamDensityToggle');
  });

  it('한 묶음 안에 [버블] 다음 밀도 칸들이 서고, 하나만 켜진다', () => {
    const toggle = slice(mainArea, 'function StreamViewToggle(', '\n}\n');
    const bubbleAt = toggle.indexOf("t('ide.bubbles.toggle')");
    const densityAt = toggle.indexOf('STREAM_DENSITIES.map(');
    expect(bubbleAt).toBeGreaterThan(0);
    expect(densityAt).toBeGreaterThan(bubbleAt);
    // 버블이 켜져 있으면 밀도 칸은 꺼져 보이고, 밀도 칸을 누르면 그 밀도로 대화에 돌아온다.
    expect(toggle).toContain('segmentClass(!bubbleOn && density === d)');
    expect(toggle).toMatch(/setDensity\(d\);\s*if \(bubbleOn\) setBubbleView\(viewKey, false\);/);
    const controls = slice(mainArea, 'function StreamControls(', '\n}\n');
    expect(controls).toContain('<StreamViewToggle />');
  });
});

describe('세션 버블 지도의 손짓은 캔버스와 같다', () => {
  it('버블을 끌 수 있고, 위성은 부모와 같은 변위로 따라온다', () => {
    expect(mapView).not.toContain('nodesDraggable={false}');
    expect(mapView).not.toContain('draggable: false');
    expect(mapView).toContain('onNodeDrag={onNodeDrag}');
    const start = slice(mapView, 'const onNodeDragStart = useCallback(', '}, [');
    expect(start).toContain('sat.parentId !== id');
    const drag = slice(mapView, 'const onNodeDrag = useCallback(', '}, [');
    expect(drag).toContain('hand.set(id, { x: p.x + dx, y: p.y + dy })');
  });

  it('가운데 에이전트 더블클릭 = [표준]으로 대화에 돌아간다', () => {
    const dbl = slice(mapView, 'const onNodeDoubleClick = useCallback(', '}, [graph,');
    expect(dbl).toMatch(/node\.id === SESSION_CENTER_NODE_ID\) \{ onShowStandard\(\); return; \}/);
    expect(dbl).toContain("case 'center': onShowStandard(); return;");
    const standard = slice(mainArea, 'const showStandardFromBubbles = useCallback(', '}, [');
    expect(standard).toContain("setStreamDensity('standard')");
    expect(standard).toContain('returnFromBubbles(null)');
    expect(mainArea).toContain('onShowStandard={showStandardFromBubbles}');
  });

  it('파일 더블클릭은 캔버스와 같은 여는 길 — 판 자리만 이 IDE 의 오른쪽 편집 판', () => {
    const dbl = slice(mapView, 'const onNodeDoubleClick = useCallback(', '}, [graph,');
    expect(dbl).toContain("case 'file': openFile(data); return;");
    const open = slice(mapView, 'const openFile = useCallback(', '}, [');
    expect(open).toContain('openFileBubble(node, openPane)');
    const pane = slice(mapView, 'const openPane = useCallback(', '}, [');
    expect(pane).toContain('openEditorFile(editorFileFromAbsPath(absPath, rootPath))');
  });
});
