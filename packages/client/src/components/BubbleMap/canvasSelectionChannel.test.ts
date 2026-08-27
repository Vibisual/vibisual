import { describe, expect, it } from 'vitest';

import {
  nativeSelectionCount,
  nativeSelectionKey,
  resolveCanvasSelectionConflict,
} from './canvasSelectionChannel.js';
import { useGraphStore } from '../../stores/graphStore.js';

/**
 * "클릭·클릭인데 두 버블이 같이 움직인다"(사용자 보고)의 회귀 방지.
 *
 * 원인은 다중 선택이 아니라 **선택 채널이 둘이라서**였다. React Flow 는 드래그할 때
 * `selectable` 을 보지 않고 `selected` 인 draggable 노드를 전부 함께 집어 든다. 앱·캡처·플레이·
 * 스펙·랩·선반 버블과 메모 상자는 `selectable:false` + store 선택이라, 일반 버블의 네이티브
 * 선택이 켜진 채로 이들을 클릭하면 두 선택이 나란히 살아남아 함께 끌려왔다.
 */
describe('canvas selection channel', () => {
  it('한쪽 채널만 선택을 들고 있으면 손대지 않는다', () => {
    expect(resolveCanvasSelectionConflict({
      storeSelectedId: null, nativeSelectedCount: 3, storeChanged: false, nativeChanged: true,
    })).toBe('none');
    expect(resolveCanvasSelectionConflict({
      storeSelectedId: 'app-1', nativeSelectedCount: 0, storeChanged: true, nativeChanged: false,
    })).toBe('none');
    expect(resolveCanvasSelectionConflict({
      storeSelectedId: null, nativeSelectedCount: 0, storeChanged: false, nativeChanged: false,
    })).toBe('none');
  });

  it('버블을 클릭한 뒤 앱 버블을 클릭하면 네이티브 선택을 내린다(같이 끌려오던 버그)', () => {
    expect(resolveCanvasSelectionConflict({
      storeSelectedId: 'app-1', nativeSelectedCount: 1, storeChanged: true, nativeChanged: false,
    })).toBe('clear-native');
  });

  it('앱 버블 선택 중 박스 드래그로 버블을 고르면 store 선택을 내린다', () => {
    expect(resolveCanvasSelectionConflict({
      storeSelectedId: 'app-1', nativeSelectedCount: 4, storeChanged: false, nativeChanged: true,
    })).toBe('clear-store');
  });

  it('같은 커밋에서 둘 다 바뀌면 사용자가 직접 누른 store 쪽을 남긴다', () => {
    expect(resolveCanvasSelectionConflict({
      storeSelectedId: 'capture-1', nativeSelectedCount: 2, storeChanged: true, nativeChanged: true,
    })).toBe('clear-native');
  });

  it('아무것도 안 바뀐 채 충돌이 남아 있어도 한쪽으로 수렴한다', () => {
    expect(resolveCanvasSelectionConflict({
      storeSelectedId: 'play-1', nativeSelectedCount: 1, storeChanged: false, nativeChanged: false,
    })).toBe('clear-native');
  });

  it('지문은 선택 집합만 본다 — 좌표가 바뀌어도 같은 값', () => {
    const a = nativeSelectionKey(
      [{ id: 'n1', selected: true }, { id: 'n2' }, { id: 'n3', selected: true }],
      [{ id: 'e1', selected: true }, { id: 'e2', selected: false }],
    );
    const b = nativeSelectionKey(
      [{ id: 'n1', selected: true }, { id: 'n2', selected: false }, { id: 'n3', selected: true }],
      [{ id: 'e1', selected: true }, { id: 'e2' }],
    );
    expect(a).toBe(b);
    expect(nativeSelectionCount(a)).toBe(3);
    expect(nativeSelectionCount(nativeSelectionKey([{ id: 'n1' }], []))).toBe(0);
    expect(nativeSelectionCount(nativeSelectionKey([{ id: 'n1', selected: true }], []))).toBe(1);
  });

  it('노드 id 와 엣지 id 가 같아도 서로 다른 선택으로 센다', () => {
    const key = nativeSelectionKey([{ id: 'x', selected: true }], [{ id: 'x', selected: true }]);
    expect(nativeSelectionCount(key)).toBe(2);
  });
});

describe('clearElementSelection', () => {
  it('store 채널만 비우고 방금 켜진 버블 선택(selectedNodeId)은 남긴다', () => {
    useGraphStore.setState({
      selectedNodeId: 'agent-1',
      selectIntentId: 'agent-1',
      selectedAppBubbleId: 'app-1',
      selectedCaptureBubbleId: 'cap-1',
      selectedCommentBoxId: 'box-1',
      selectedPlayBubbleId: 'play-1',
      selectedSpecDocId: 'spec-1',
      selectedLabRunId: 'lab-1',
      selectedShelfBubbleId: 'shelf-1',
      selectedTaskEdgeId: 'edge-1',
    });

    useGraphStore.getState().clearElementSelection();

    const s = useGraphStore.getState();
    expect(s.selectedNodeId).toBe('agent-1');
    expect(s.selectIntentId).toBe('agent-1');
    expect(s.selectedAppBubbleId).toBeNull();
    expect(s.selectedCaptureBubbleId).toBeNull();
    expect(s.selectedCommentBoxId).toBeNull();
    expect(s.selectedPlayBubbleId).toBeNull();
    expect(s.selectedSpecDocId).toBeNull();
    expect(s.selectedLabRunId).toBeNull();
    expect(s.selectedShelfBubbleId).toBeNull();
    expect(s.selectedTaskEdgeId).toBeNull();
  });
});

/**
 * 배선 가드 — 규칙 모듈만 맞고 캔버스가 그걸 안 부르면 버그는 그대로다.
 * DOM 테스트 환경이 없으므로 소스 원문으로 확인한다(이 레포의 다른 배선 가드와 같은 방식).
 */
describe('BubbleMap 배선', () => {
  const SOURCES = import.meta.glob<string>(
    ['/src/components/BubbleMap/BubbleMap.tsx'],
    { query: '?raw', import: 'default', eager: true },
  );
  const src = (): string => SOURCES['/src/components/BubbleMap/BubbleMap.tsx'] ?? '';

  it('캔버스가 조정 규칙을 호출한다', () => {
    expect(src()).toContain('resolveCanvasSelectionConflict({');
  });

  it('store 채널 선택에 드래그 가능한 요소가 모두 들어 있다', () => {
    const s = src();
    const at = s.indexOf('const storeSelectedElementId');
    expect(at).toBeGreaterThan(-1);
    const decl = s.slice(at, at + 400);
    for (const id of [
      'selectedCommentBoxId', 'selectedCaptureBubbleId', 'selectedAppBubbleId',
      'selectedPlayBubbleId', 'selectedSpecDocId', 'selectedLabRunId', 'selectedShelfBubbleId',
    ]) {
      expect(decl).toContain(id);
    }
  });

  it('네이티브를 내릴 때 노드와 엣지의 selected 를 함께 끈다', () => {
    const s = src();
    expect(s).toContain('setFlowNodes((cur) => (cur.some((n) => n.selected)');
    expect(s).toContain('setEdges((cur) => (cur.some((e) => e.selected)');
  });

  it('store 를 내릴 때는 selectedNodeId 를 건드리지 않는 전용 액션을 쓴다', () => {
    expect(src()).toContain('clearElementSelection()');
  });
});
