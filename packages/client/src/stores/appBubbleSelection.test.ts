import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppBubble } from '@vibisual/shared';

import { useGraphStore } from './graphStore.js';

/**
 * §5.13 (M) v4.61 — 앱 버블의 선택·삭제.
 *
 * 앱 버블은 `flowNodes`(useNodesState) 밖에 사는 노드라 React Flow 의 자동 선택이 닿지 않는다.
 * 선택은 store 한 채널(`selectedAppBubbleId`)로만 이뤄지고 Delete 키·우클릭 메뉴가 같은
 * `deleteAppBubble` 을 쓴다 — 이 배선이 끊기면 "클릭해도 선택 안 되고 지울 수도 없는" 버블이
 * 다시 생긴다(사용자 보고로 드러난 회귀).
 */

function bubble(id: string, over: Partial<AppBubble> = {}): AppBubble {
  return {
    id,
    projectName: 'demo',
    appId: 'vibistudio',
    x: 10,
    y: 20,
    width: 240,
    height: 150,
    createdAt: 1,
    ...over,
  } as AppBubble;
}

describe('app bubble selection', () => {
  beforeEach(() => {
    useGraphStore.setState({
      appBubbles: [],
      selectedAppBubbleId: null,
      selectedNodeId: null,
      selectedCommentBoxId: null,
      selectedCaptureBubbleId: null,
      selectedTaskEdgeId: null,
      draggingAppBubbleIds: [],
    });
  });

  it('다른 선택과 배타 — 앱 버블을 고르면 노드 선택이 풀린다', () => {
    const s = useGraphStore.getState();
    s.selectNode('agent-1');
    expect(useGraphStore.getState().selectedNodeId).toBe('agent-1');

    s.selectAppBubble('app-1');
    const after = useGraphStore.getState();
    expect(after.selectedAppBubbleId).toBe('app-1');
    expect(after.selectedNodeId).toBeNull();
  });

  it('빈 캔버스 클릭(selectNode(null))이 앱 버블 선택도 함께 놓는다', () => {
    useGraphStore.getState().selectAppBubble('app-1');
    useGraphStore.getState().selectNode(null);
    expect(useGraphStore.getState().selectedAppBubbleId).toBeNull();
  });

  it('스냅샷에서 사라진 버블은 선택도 함께 놓는다', () => {
    useGraphStore.setState({ appBubbles: [bubble('app-1')] });
    useGraphStore.getState().selectAppBubble('app-1');

    useGraphStore.getState().applyAppBubbles([]);
    expect(useGraphStore.getState().selectedAppBubbleId).toBeNull();
  });

  it('드래그 중에는 스냅샷이 좌표를 덮지 않는다', () => {
    useGraphStore.setState({ appBubbles: [bubble('app-1')] });
    const s = useGraphStore.getState();
    s.setAppBubbleDragLock('app-1', true);
    s.patchAppBubbleLocal('app-1', { x: 500, y: 600 });

    // 서버가 옛 좌표를 실은 스냅샷을 뒤늦게 보내도 손이 있는 자리를 유지한다.
    useGraphStore.getState().applyAppBubbles([bubble('app-1', { x: 10, y: 20 })]);
    const moved = useGraphStore.getState().appBubbles[0];
    expect(moved?.x).toBe(500);
    expect(moved?.y).toBe(600);

    // 락이 풀린 뒤에는 서버가 권위다.
    useGraphStore.getState().setAppBubbleDragLock('app-1', false);
    useGraphStore.getState().applyAppBubbles([bubble('app-1', { x: 10, y: 20 })]);
    expect(useGraphStore.getState().appBubbles[0]?.x).toBe(10);
  });
});

describe('app bubble delete', () => {
  beforeEach(() => {
    useGraphStore.setState({
      appBubbles: [bubble('app-1')],
      selectedAppBubbleId: 'app-1',
      draggingAppBubbleIds: [],
    });
  });

  it('성공하면 버블과 선택이 함께 사라진다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const ok = await useGraphStore.getState().deleteAppBubble('app-1');
    expect(ok).toBe(true);
    const after = useGraphStore.getState();
    expect(after.appBubbles).toHaveLength(0);
    expect(after.selectedAppBubbleId).toBeNull();
    vi.unstubAllGlobals();
  });

  it('핀으로 거절(409)되면 화면에서 지우지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409 }));
    const ok = await useGraphStore.getState().deleteAppBubble('app-1');
    expect(ok).toBe(false);
    expect(useGraphStore.getState().appBubbles).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it('연결이 끊겨도 지운 척하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const ok = await useGraphStore.getState().deleteAppBubble('app-1');
    expect(ok).toBe(false);
    expect(useGraphStore.getState().appBubbles).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});

/**
 * §5.13 (M) v4.68 — 이름·핀은 store 한 경로로. 우클릭 메뉴와 우측 옵션 패널이 같은 함수를 쓴다.
 * 각자 fetch 를 들고 있으면 낙관 반영 규칙이 갈라져 한쪽에서만 되돌아간다.
 */
describe('app bubble rename / pin', () => {
  beforeEach(() => {
    useGraphStore.setState({
      appBubbles: [bubble('app-1')],
      selectedAppBubbleId: 'app-1',
      draggingAppBubbleIds: [],
    });
  });

  it('이름은 화면에 먼저 반영하고 서버에 PATCH 한다', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    useGraphStore.getState().renameAppBubble('app-1', '  내 영상 작업  ');

    expect(useGraphStore.getState().appBubbles[0]?.title).toBe('내 영상 작업');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/app-bubbles/app-1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ title: '내 영상 작업' });
    vi.unstubAllGlobals();
  });

  it('이름을 비우면 앱 기본 이름으로 되돌아간다(빈 문자열 저장)', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    useGraphStore.getState().renameAppBubble('app-1', '   ');
    expect(useGraphStore.getState().appBubbles[0]?.title).toBe('');
    vi.unstubAllGlobals();
  });

  it('고정 토글도 같은 경로 — 화면 먼저, 서버 PATCH', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    useGraphStore.getState().setAppBubblePin('app-1', true);

    expect(useGraphStore.getState().appBubbles[0]?.preservePinned).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ preservePinned: true });
    vi.unstubAllGlobals();
  });
});

/**
 * §5.13 (M) v4.68 — "선택하면 오른쪽에 옵션이 뜬다"는 배선 가드.
 *
 * 선택 store 는 v4.61 부터 있었지만 **패널을 띄우는 조건에 앱 버블이 빠져 있어서** 눌러도
 * 우측 패널이 열리지 않았다(사용자 보고). 이 조건은 창 셸마다 따로 적혀 있어 한쪽만 고치면
 * 창에 따라 동작이 갈린다 — 두 셸과 패널 본체를 함께 못 박는다. DOM 테스트 환경이 없으므로
 * 소스 수준에서 확인한다(독립 규약 테스트와 같은 방식).
 */
describe('app bubble detail panel wiring', () => {
  // 소스를 원문으로 읽는다 — 클라 패키지는 node 타입이 없으므로 fs 대신 vite 의 `?raw` 글롭.
  const SOURCES = import.meta.glob<string>(
    ['/src/App.tsx', '/src/components/Layout/DetachedShell.tsx', '/src/components/Panel/DetailPanel.tsx'],
    { query: '?raw', import: 'default', eager: true },
  );

  it('본 창(App.tsx)이 앱 버블 선택에도 DetailPanel 을 띄우고 닫을 때 선택을 놓는다', () => {
    const src = SOURCES['/src/App.tsx'] ?? '';
    expect(src).toContain('selectedAppBubbleId !== null');
    expect(src).toContain('s.selectAppBubble(null)');
  });

  it('별창(DetachedShell.tsx)도 같은 조건을 쓴다', () => {
    const src = SOURCES['/src/components/Layout/DetachedShell.tsx'] ?? '';
    expect(src).toContain('selectedAppBubbleId !== null');
    expect(src).toContain('s.selectAppBubble(null)');
  });

  it('DetailPanel 이 앱 버블 전용 섹션을 렌더한다', () => {
    const src = SOURCES['/src/components/Panel/DetailPanel.tsx'] ?? '';
    expect(src).toContain('if (selectedAppBubbleId)');
    expect(src).toContain('<AppBubbleDetail bubble={bubble} />');
  });
});

/**
 * §5.13 (M) v4.69 — **선택 이벤트를 받는 단계**.
 *
 * v4.61(스토어 배선)·v4.68(패널 조건)을 다 맞췄는데도 화면에서는 여전히 "눌러도 선택이 안
 * 되는" 버블이었다. 진짜 원인은 배선이 아니라 이벤트가 도달하지 못한 것이다 — 드래그 가능한
 * 노드 래퍼에 걸린 `d3-drag` 가 mousedown 에서 `stopImmediatePropagation()` 을 부르고,
 * React 18 은 핸들러를 루트 컨테이너에 위임하므로 **버블 단계 `onMouseDown` 은 발화 자체를
 * 못 한다**(우클릭·더블클릭만 살아 있던 이유이기도 하다). 캡처 단계로 받아야 뚫린다.
 * 되돌리면 세 증상(선택·선택 이펙트·Delete 삭제·패널)이 한꺼번에 다시 죽으므로 못 박는다.
 *
 * ⚠ 그 규칙은 이제 **캔버스 공용 상태기계 한 벌**(`bubbleSelectGesture`)에 들어 있고, 캔버스의
 * 모든 버블이 그것을 펼쳐 쓴다(`{...gesture.handlers}`). 그래서 가드도 두 겹이다 — ① 공용
 * 모듈이 캡처 단계로 받는가, ② 각 버블이 그 묶음을 실제로 펼쳐 쓰는가. 어느 버블 하나가
 * 자기만의 핸들러로 되돌아가면 손버릇이 다시 갈린다(사용자 지적: "더블클릭할 때 선택 동작도
 * 같이 일어난다" — 자기만의 즉시 선택이 남아 있던 버블들이 그랬다).
 */
describe('canvas store-driven bubbles — 선택은 캡처 단계에서 받는다', () => {
  const NODE_PATHS = [
    '/src/components/BubbleMap/AppBubbleNode.tsx',
    '/src/components/BubbleMap/PlayNode.tsx',
    '/src/components/BubbleMap/PlayPreviewNode.tsx',
    '/src/components/BubbleMap/SpecNode.tsx',
    '/src/components/BubbleMap/LabNode.tsx',
    '/src/components/BubbleMap/ShelfNode.tsx',
    '/src/components/BubbleMap/CaptureNode.tsx',
    '/src/components/BubbleMap/CommentBoxNode.tsx',
    // 에이전트(IDE) 버블 — 이 규칙의 기준이자, 나머지가 맞춰야 할 대상.
    '/src/components/BubbleMap/BubbleNode.tsx',
  ];

  const NODE_SOURCES = import.meta.glob<string>(
    [
      '/src/components/BubbleMap/AppBubbleNode.tsx',
      '/src/components/BubbleMap/PlayNode.tsx',
      '/src/components/BubbleMap/PlayPreviewNode.tsx',
      '/src/components/BubbleMap/SpecNode.tsx',
      '/src/components/BubbleMap/LabNode.tsx',
      '/src/components/BubbleMap/ShelfNode.tsx',
      '/src/components/BubbleMap/CaptureNode.tsx',
      '/src/components/BubbleMap/CommentBoxNode.tsx',
      '/src/components/BubbleMap/BubbleNode.tsx',
      '/src/components/BubbleMap/bubbleSelectGesture.ts',
    ],
    { query: '?raw', import: 'default', eager: true },
  );

  it('공용 상태기계가 누름을 캡처 단계로 받는다', () => {
    const src = NODE_SOURCES['/src/components/BubbleMap/bubbleSelectGesture.ts'] ?? '';
    expect(src).not.toBe('');
    expect(src).toContain('onPointerDownCapture');
    expect(src).not.toContain('onMouseDown');
  });

  for (const path of NODE_PATHS) {
    it(`${path} — 공용 선택 제스처를 펼쳐 쓰고 자기만의 즉시 선택을 들지 않는다`, () => {
      const src = NODE_SOURCES[path] ?? '';
      expect(src).not.toBe('');
      expect(src).toContain("from './bubbleSelectGesture.js'");
      expect(src).toContain('{...gesture.handlers}');
      // 자기만의 누름 핸들러로 되돌아가면 더블클릭 1타가 다시 선택을 발동한다.
      expect(src).not.toContain('onPointerDownCapture={handleSelect}');
      expect(src).not.toContain('onMouseDown={handleSelect}');
    });
  }

  it('앱 버블은 선택되면 눈에 보이는 선택 이펙트(흰 테 + 헤일로)를 낸다', () => {
    const src = NODE_SOURCES['/src/components/BubbleMap/AppBubbleNode.tsx'] ?? '';
    expect(src).toContain('boxShadow: isSelected');
    expect(src).toContain('const isSelected =');
  });

  it('더블클릭 핸들러는 첫 줄에서 보류 단일선택을 접는다(선택이 함께 발동하지 않게)', () => {
    for (const path of [
      '/src/components/BubbleMap/AppBubbleNode.tsx',
      '/src/components/BubbleMap/SpecNode.tsx',
      '/src/components/BubbleMap/LabNode.tsx',
      '/src/components/BubbleMap/ShelfNode.tsx',
      '/src/components/BubbleMap/CaptureNode.tsx',
      '/src/components/BubbleMap/CommentBoxNode.tsx',
      '/src/components/BubbleMap/BubbleNode.tsx',
    ]) {
      const src = NODE_SOURCES[path] ?? '';
      expect(src, path).toContain('gesture.cancelPendingSelect()');
    }
  });
});
