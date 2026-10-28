import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppBubble } from '@vibisual/shared';
import { APP_BUBBLE_PENDING_MS } from '@vibisual/shared';

import { useGraphStore } from './graphStore.js';

/** §5.13 (M) — 앱 버블은 `flowNodes` 밖이라 React Flow 선택이 안 닿는다 — 선택은 `selectedAppBubbleId`, 삭제는 Delete·우클릭 공용 `deleteAppBubble`. */

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

/** §5.13 (M) — 이름·핀은 store 한 경로(우클릭·옵션 패널 공용). 각자 fetch 하면 낙관 반영이 갈린다. */
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

/** §5.13 (M) — 앱 버블 선택 시 우측 패널을 띄우는 조건 가드. 조건이 창 셸마다 따로 있어 두 셸과 패널 본체를 소스 수준에서 함께 본다. */
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

/** 공용 선택 손짓이 펼쳐 주는 핸들러 이름(`BubbleSelectGestureHandlers`). */
const GESTURE_HANDLER_PROPS = [
  'onPointerDownCapture',
  'onPointerMove',
  'onPointerUp',
  'onPointerCancel',
  'onContextMenuCapture',
] as const;

/** `const 이름 = …` 한 문장(다음 빈 줄까지). 없으면 빈 문자열. */
function definitionOf(src: string, name: string): string {
  const at = src.indexOf(`const ${name} =`);
  if (at < 0) return '';
  const rest = src.slice(at);
  const end = rest.search(/\r?\n[ \t]*\r?\n/);
  return end < 0 ? rest : rest.slice(0, end);
}

/**
 * `{...gesture.handlers}` 뒤 같은 태그에서 손짓 핸들러를 다시 적은 자리마다 — 그 값이 손짓을 이어 부르는가.
 * 태그는 홀로 선 `>`·`/>` 줄로 닫힌다고 보고, 펼침도 홀로 선 줄만 센다(주석 속 글자를 JSX 로 읽지 않게).
 */
function gestureHandlerOverrides(src: string): { prop: string; value: string; chains: boolean }[] {
  const out: { prop: string; value: string; chains: boolean }[] = [];
  for (const spread of src.matchAll(/^[ \t]*\{\.\.\.gesture\.handlers\}[ \t]*\r?$/gm)) {
    const rest = src.slice(spread.index ?? 0);
    const close = rest.search(/\r?\n[ \t]*\/?>[ \t]*\r?\n/);
    const attrs = close < 0 ? rest : rest.slice(0, close);
    for (const prop of GESTURE_HANDLER_PROPS) {
      const m = new RegExp(`\\b${prop}=\\{([^\\r\\n]*)\\}`).exec(attrs);
      if (!m) continue;
      const value = m[1]!.trim();
      const body = /^[A-Za-z_$][\w$]*$/.test(value) ? definitionOf(src, value) : value;
      out.push({ prop, value, chains: body.includes(`gesture.handlers.${prop}(`) });
    }
  }
  return out;
}

/**
 * §5.13 (M) — 선택은 캡처 단계에서 받는다. 노드 래퍼의 `d3-drag` 가 mousedown 에서 `stopImmediatePropagation()` 을 부르고 React 18 은 루트에 위임해
 * 버블 단계 `onMouseDown` 은 발화하지 못한다. 규칙은 공용 `bubbleSelectGesture` 에 있고, 가드는 ① 공용 모듈이 캡처로 받는가
 * ② 각 버블이 `{...gesture.handlers}` 를 펼쳐 쓰는가(자기 핸들러로 돌아가면 더블클릭 때 선택까지 일어난다).
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

  /**
   * 펼친 묶음을 뒤에서 같은 이름으로 덮어쓰면 위 검사는 통과해도 손짓이 죽는다(예: `onPointerDownCapture={prefetchNow}` → 고르지 못해 Delete 가 못 지운다).
   * 덮어써도 되는 것은 손짓 핸들러를 이어 부르는 핸들러뿐이다(`handlePointerUp` 선례).
   */
  it('펼쳐 넣은 손짓 핸들러를 뒤에서 덮어쓰면, 그 핸들러가 손짓을 이어 부른다', () => {
    const sources = import.meta.glob<string>('/src/components/BubbleMap/*.tsx', {
      query: '?raw',
      import: 'default',
      eager: true,
    });
    const broken: string[] = [];
    let overrides = 0;
    for (const [path, src] of Object.entries(sources)) {
      for (const o of gestureHandlerOverrides(src)) {
        overrides += 1;
        if (!o.chains) broken.push(`${path}: ${o.prop}={${o.value}} 가 gesture.handlers.${o.prop} 를 부르지 않는다`);
      }
    }
    expect(broken).toEqual([]);
    // 헛검사 방지 — 이어 부르는 덮어쓰기는 실제로 있다(에이전트 버블·카드의 뗌, 앱 노드의 누름).
    expect(overrides).toBeGreaterThanOrEqual(4);
  });

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

/** §5.4 #36 (F) — 앱 위성은 고르는 즉시 선다(클라가 지은 id 로 먼저 넣고 같은 id 로 POST). 만들기 전에 출발한 스냅샷이 그 노드를 지우면 한 프레임 깜빡인다. */
describe('app bubble optimistic create', () => {
  const input = {
    projectName: 'demo',
    appId: 'vibistudio',
    x: 1,
    y: 2,
    width: 208,
    height: 130,
    linkedAgentIds: ['agent-1'],
  };
  const pending = (): Promise<never> => new Promise<never>(() => undefined);
  async function flush(): Promise<void> {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  }

  beforeEach(() => {
    useGraphStore.setState({ appBubbles: [], pendingAppBubbles: {}, selectedAppBubbleId: null, draggingAppBubbleIds: [] });
  });

  it('화면에 먼저 서고, 같은 id 로 POST 한다', () => {
    const fetchMock = vi.fn().mockImplementation(pending);
    vi.stubGlobal('fetch', fetchMock);
    const id = useGraphStore.getState().createAppBubble(input);
    expect(useGraphStore.getState().appBubbles.map((b) => b.id)).toEqual([id]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/app-bubbles');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body['id']).toBe(id);
    expect(body['linkedAgentIds']).toEqual(['agent-1']);
    vi.unstubAllGlobals();
  });

  it('서버 확인 전 스냅샷은 낙관본을 지우지 않고, 서버 목록에 나타나면 서버가 권위다', () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(pending));
    const id = useGraphStore.getState().createAppBubble(input);
    useGraphStore.getState().applyAppBubbles([]); // 만들기 전에 출발한 스냅샷
    expect(useGraphStore.getState().appBubbles.map((b) => b.id)).toEqual([id]);

    const confirmed = { ...useGraphStore.getState().appBubbles[0]!, x: 99 };
    useGraphStore.getState().applyAppBubbles([confirmed]);
    expect(useGraphStore.getState().pendingAppBubbles).toEqual({});
    expect(useGraphStore.getState().appBubbles[0]?.x).toBe(99);
    vi.unstubAllGlobals();
  });

  it('붙드는 시간이 지나도 서버 목록에 없으면 걷는다(만들기 실패)', () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(pending));
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    useGraphStore.getState().createAppBubble(input);
    now.mockReturnValue(1_000 + APP_BUBBLE_PENDING_MS + 1);
    useGraphStore.getState().applyAppBubbles([]);
    expect(useGraphStore.getState().appBubbles).toHaveLength(0);
    expect(useGraphStore.getState().pendingAppBubbles).toEqual({});
    now.mockRestore();
    vi.unstubAllGlobals();
  });

  it('서버가 다른 id 를 지으면 낙관본을 걷는다 — 진짜는 스냅샷으로 온다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, data: { id: 'app-zzz-1' } }) }));
    useGraphStore.getState().createAppBubble(input);
    await flush();
    expect(useGraphStore.getState().appBubbles).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('서버가 거절하면 낙관본을 걷는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    useGraphStore.getState().createAppBubble(input);
    await flush();
    expect(useGraphStore.getState().appBubbles).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('잇기로 명패가 화면이 되면 같은 PATCH 에 가운데를 지킨 좌표를 싣는다', () => {
    useGraphStore.setState({ appBubbles: [bubble('app-1', { x: 0, y: 0, width: 80, height: 50 })] });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    useGraphStore.getState().linkAppBubbleAgent('app-1', 'agent-1', { x: -64, y: -40 });
    expect(useGraphStore.getState().appBubbles[0]).toMatchObject({ x: -64, y: -40, linkedAgentIds: ['agent-1'] });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ linkedAgentIds: ['agent-1'], x: -64, y: -40 });
    vi.unstubAllGlobals();
  });
});
