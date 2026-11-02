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

describe('지도는 [버블]을 누른 세션 하나다 — 세션을 합치지 않는다', () => {
  it('메인 탭은 상태바가 가리키는 명령의 세션 · 재료·이름·도는가가 모두 그 세션 것', () => {
    const bar = slice(mainArea, 'function StreamStatusBar(', '\n}\n');
    expect(bar).toContain('const targetSessionId = target?.subAgentId ?? null;');
    expect(bar).toContain('onTargetSession?.(targetSessionId)');
    expect(mainArea).toContain('onTargetSession={setStatusBarSessionId}');
    expect(mainArea).toContain('bubbleMapSessionOf(activeSessionId, statusBarSessionId, subAgents)');
    expect(mainArea).toContain('sessionBubbleStreamsOf(streams, originalCommands, bubbleSessionId)');
    // 그 에이전트의 세션 전부를 지도에 넣지 않는다.
    expect(mainArea).not.toContain('subAgents.map((s) => s.id)),');
    const view = slice(mainArea, '<SessionBubbleView', '/>');
    expect(view).toContain('sessionId={bubbleSessionId}');
    expect(view).toContain('running={bubbleSessionRunning}');
  });

  it('지도를 보는 동안 상태바는 재지 않는다 — 재면 바닥으로 읽혀 지도가 최신 세션으로 튄다', () => {
    const bar = slice(mainArea, 'function StreamStatusBar(', '\n}\n');
    expect(bar).toContain('const onMap = returnToStream !== undefined;');
    expect(bar).toMatch(/useEffect\(\(\) => \{\s*if \(onMap\) return;\s*const container = scrollRef\.current;/);
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

  it('누름 = 캔버스의 오른쪽 디테일 창(DetailPanel) — 지도 전용 정보 상자는 없다', () => {
    expect(mapView).not.toContain('function SessionBubbleInfo');
    expect(mapView).not.toContain('<SessionBubbleInfo');
    expect(mapView).toContain("import { DetailPanel } from '../Panel/DetailPanel.js';");
    expect(mapView).toMatch(/<DetailPanel\s+onClose=\{resetSelection\}\s+hosted=\{\{/);
    // 고르기는 그 판이 받는다 — 캔버스 전역 선택(selectNode)을 건드리지 않는다.
    const host = slice(mapView, 'const host = useMemo<BubbleHost>(', '}), []);');
    expect(host).toContain('select: (nodeId) => { setRingId(nodeId); setInfoId(nodeId); }');
    expect(mapView).not.toContain('selectNode(');
    const panel = read('../Panel/DetailPanel.tsx');
    // 남의 판 안에서는 그 판의 오른쪽 · 캔버스의 다른 선택(메모 상자·캡처·앱·Task Edge·콘티)이 끼어들지 않는다.
    expect(panel).toContain('const dockInsets = hosted ? NO_DOCK_INSETS : canvasDockInsets;');
    for (const sel of ['selectedCommentBoxId', 'selectedCaptureBubbleId', 'selectedAppBubbleId', 'selectedTaskEdgeId']) {
      expect(panel).toContain(`if (!hosted && ${sel}) {`);
    }
  });

  it('미리보기는 이 지도의 판으로 고른다 — 지도 배율·움직임을 따른다(캔버스 판 ❌)', () => {
    expect(mapView).toContain('const previews = useMemo(() => createPreviewBudget(), []);');
    expect(mapView).toContain('useEffect(() => registerPreviewSurface(previews), [previews]);');
    expect(mapView).toMatch(/<PreviewBudgetProvider value=\{previews\}>\s*<ReactFlow/);
    expect(mapView).toContain('onMoveStart={onMoveStart}');
    expect(mapView).toContain('onMoveEnd={onMoveEnd}');
    expect(slice(mapView, 'const onMoveStart = useCallback(', '}, [')).toContain('previews.setMoving(true, viewport.zoom)');
    expect(slice(mapView, 'const onMoveEnd = useCallback(', '}, [')).toContain('previews.setMoving(false, viewport.zoom)');
    // 버블의 미리보기 허가는 가장 가까운 판을 쓴다.
    const budget = read('../../apps/previewBudget.ts');
    expect(budget).toContain('const budget = useContext(PreviewBudgetContext);');
  });

  it('폴더 더블클릭 = 안으로(별도 창 ❌) · 묶음 더블클릭 = 묶음 안', () => {
    const dbl = slice(mapView, 'const onNodeDoubleClick = useCallback(', '}, [graph,');
    expect(dbl).toContain("case 'folder': enterFolder(entry.folder.id); return;");
    expect(dbl).toContain("if (data.bubbleType === 'bundle') { enterBundle(node, data); return; }");
    const enter = slice(mapView, 'const enterFolder = useCallback(', ', [goTo]);');
    expect(enter).toContain("goTo({ kind: 'folder', id })");
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
