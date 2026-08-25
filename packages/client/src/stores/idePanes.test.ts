import { beforeEach, describe, expect, it } from 'vitest';
import type { BubbleData } from '@vibisual/shared';

import {
  useGraphStore,
  selectProjectIDEPaneKeys,
  selectRenderedIDEPaneKeys,
  selectVisibleDockedPanes,
  selectOrphanIDEPanes,
  selectIDEOverlay,
  selectIDEPane,
} from './graphStore.js';
import { IDE_MAX_PANES } from '../components/IDE/ideDockLayout.js';

/**
 * §5.5 #17-1 (판올림 번호 발급 대기) — **IDE 창은 하나가 아니다**.
 *
 * 사용자 지시: "또 다른 버블을 클릭하면 해당 버블을 창이 열리게 하고 … 창을 여러 개 켜서 여기저기
 * 붙여서 듀얼창으로 보고싶어". 종전 규약(창 하나 · 자리는 그대로 두고 내용만 교체)이 조용히
 * 돌아오면 그 요구가 통째로 사라지므로, "언제 새 창이 서고 언제 자리를 재사용하는가"를 여기서 못 박는다.
 */

const PROJ = 'proj';
const A1 = 'agent-1';
const A2 = 'agent-2';
const A3 = 'agent-3';

/** 도크가 "실제로 그려지는가" 판정은 `nodeMap` 을 본다 — 버블이 없으면 자리를 안 먹는다. */
function agentNode(id: string): BubbleData {
  return { id, label: id, bubbleType: 'agent', path: id, status: 'idle', activity: 0 };
}

function reset(): void {
  const nodeMap: Record<string, BubbleData> = {};
  for (const id of [A1, A2, A3, ...Array.from({ length: 10 }, (_, i) => `agent-${i}`)]) {
    nodeMap[id] = agentNode(id);
  }
  useGraphStore.setState({
    activeProject: PROJ,
    nodeMap,
    ideOverlays: {},
    idePaneSeq: 0,
    subAgents: {},
    agentConfigs: {},
    selectedSubByAgent: {},
    defaultSubAgents: {},
  });
}

function open(agentId: string, pane?: 'new' | 'reuse'): void {
  useGraphStore.getState().openIDEOverlay(agentId, pane ? { pane } : undefined);
}

function panes(): string[] {
  return selectProjectIDEPaneKeys(useGraphStore.getState());
}

function agentsOnScreen(): string[] {
  const s = useGraphStore.getState();
  return panes().map((k) => s.ideOverlays[k]?.agentId ?? '');
}

describe('IDE 창 여러 개 (§5.5 #17-1)', () => {
  beforeEach(reset);

  it('첫 창은 종전대로 프로젝트 이름을 슬롯 키로 쓰고 모달로 뜬다', () => {
    open(A1, 'new');
    expect(panes()).toEqual([PROJ]);
    expect(selectIDEPane(useGraphStore.getState(), PROJ).openMode).toBe('modal');
  });

  it('캔버스에서 다른 버블을 열면 **새 창**이 선다(자리 교체 ❌)', () => {
    open(A1, 'new');
    open(A2, 'new');
    expect(panes()).toHaveLength(2);
    expect(agentsOnScreen().sort()).toEqual([A1, A2]);
    // 둘째 창은 모달로 뜨지 않는다 — 모달은 옆 창을 통째로 덮는다.
    const second = panes().find((k) => k !== PROJ)!;
    expect(selectIDEPane(useGraphStore.getState(), second).openMode).toBe('floating');
  });

  it('같은 에이전트를 다시 열면 창을 두 벌로 만들지 않고 앞으로 올린다', () => {
    open(A1, 'new');
    open(A2, 'new');
    const before = panes();
    open(A1, 'new');
    expect(panes()).toHaveLength(before.length);
    // 앞으로 올라왔다 = 컨텍스트 밖에서 "그 IDE" 라고 할 때 이 창을 가리킨다.
    expect(selectIDEOverlay(useGraphStore.getState()).agentId).toBe(A1);
  });

  it('북마크 점프 같은 진입점(기본 reuse)은 창을 쌓지 않고 맨 앞 창을 교체한다', () => {
    open(A1, 'new');
    open(A2, 'new');
    open(A3);
    expect(panes()).toHaveLength(2);
    expect(agentsOnScreen()).toContain(A3);
    expect(agentsOnScreen()).not.toContain(A2); // 맨 앞이던 A2 자리를 A3 가 받았다
  });

  it('창 수 상한을 넘으면 **가장 오래 안 만진 창**을 재사용한다(무한 증식 ❌)', () => {
    for (let i = 0; i < IDE_MAX_PANES + 2; i += 1) open(`agent-${i}`, 'new');
    expect(panes()).toHaveLength(IDE_MAX_PANES);
    // 가장 먼저 연 창(agent-0)이 먼저 밀려난다.
    expect(agentsOnScreen()).not.toContain('agent-0');
    expect(agentsOnScreen()).toContain(`agent-${IDE_MAX_PANES + 1}`);
  });

  it('창 하나를 닫아도 나머지 창은 그대로 남는다', () => {
    open(A1, 'new');
    open(A2, 'new');
    const second = panes().find((k) => k !== PROJ)!;
    useGraphStore.getState().closeIDEOverlay(second);
    expect(panes()).toEqual([PROJ]);
    expect(agentsOnScreen()).toEqual([A1]);
  });

  it('붙인 변·두께는 창마다 따로 간다 — 한 창을 붙여도 옆 창은 그대로', () => {
    open(A1, 'new');
    open(A2, 'new');
    const second = panes().find((k) => k !== PROJ)!;
    useGraphStore.getState().setIDEPaneDock(second, { side: 'left', size: 400, order: 0 });
    const st = useGraphStore.getState();
    expect(selectIDEPane(st, second).dockSide).toBe('left');
    expect(selectIDEPane(st, PROJ).dockSide).toBeNull();
  });

  it('도크 두께는 **같은 변에 붙은 창 전원**이 함께 바뀐다(한 칸을 나눠 쓰므로)', () => {
    open(A1, 'new');
    open(A2, 'new');
    const [first, second] = panes();
    const dock = useGraphStore.getState().setIDEPaneDock;
    dock(first, { side: 'right', size: 480, order: 0 });
    dock(second, { side: 'right', size: 480, order: 1 });
    useGraphStore.getState().setIDEDockSize(first!, 600);
    const st = useGraphStore.getState();
    expect(selectIDEPane(st, first!).dockSize).toBe(600);
    expect(selectIDEPane(st, second!).dockSize).toBe(600);
  });

  it('자리를 재사용할 때는 붙어 있던 변을 그대로 물려받는다(우측에 두고 에이전트만 교체)', () => {
    open(A1, 'new');
    useGraphStore.getState().setIDEPaneDock(PROJ, { side: 'right', size: 520, order: 0 });
    open(A2);
    const pane = selectIDEPane(useGraphStore.getState(), PROJ);
    expect(pane.agentId).toBe(A2);
    expect(pane.dockSide).toBe('right');
    expect(pane.dockSize).toBe(520);
  });

  it('주 창이 닫혀 있어도 "그 IDE"(맨 앞 창)를 찾는다 — 세션 선택이 조용히 새지 않게', () => {
    open(A1, 'new');
    open(A2, 'new');
    const second = panes().find((k) => k !== PROJ)!;
    useGraphStore.getState().closeIDEOverlay(PROJ); // 주 창만 닫는다
    expect(selectIDEOverlay(useGraphStore.getState()).agentId).toBe(A2);
    // 키 없이 부른 액션도 남은 그 창을 고쳐야 한다.
    useGraphStore.getState().setIDEActiveSession('sub-x');
    expect(selectIDEPane(useGraphStore.getState(), second).activeSessionId).toBe('sub-x');
  });

  // ── 접기: 닫지 않고 화면에서만 내린다(캔버스를 되찾는 길) ──────────────
  it('접으면 그려지는 창 목록에서 빠지고 도크 자리도 내놓는다', () => {
    open(A1, 'new');
    useGraphStore.getState().setIDEPaneDock(PROJ, { side: 'right', size: 480, order: 0 });
    expect(selectVisibleDockedPanes(useGraphStore.getState())).toHaveLength(1);

    useGraphStore.getState().setIDEPaneCollapsed(PROJ, true);
    const st = useGraphStore.getState();
    // 슬롯은 남는다(닫기가 아니다) — 다만 그리지도, 자리를 먹지도 않는다.
    expect(selectProjectIDEPaneKeys(st)).toEqual([PROJ]);
    expect(selectRenderedIDEPaneKeys(st)).toEqual([]);
    expect(selectVisibleDockedPanes(st)).toHaveLength(0);
  });

  it('접힌 창을 펴면 붙어 있던 변으로 그대로 돌아온다', () => {
    open(A1, 'new');
    useGraphStore.getState().setIDEPaneDock(PROJ, { side: 'bottom', size: 300, order: 0 });
    useGraphStore.getState().setIDEPaneCollapsed(PROJ, true);
    useGraphStore.getState().setIDEPaneCollapsed(PROJ, false);
    const pane = selectIDEPane(useGraphStore.getState(), PROJ);
    expect(pane.collapsed).toBe(false);
    expect(pane.dockSide).toBe('bottom');
    expect(pane.dockSize).toBe(300);
    expect(selectVisibleDockedPanes(useGraphStore.getState())).toHaveLength(1);
  });

  it('접힌 에이전트를 다시 열면 새 창을 만들지 않고 펴서 앞으로 올린다', () => {
    open(A1, 'new');
    open(A2, 'new');
    useGraphStore.getState().setIDEPaneCollapsed(PROJ, true);
    open(A1, 'new'); // 접혀 있는 그 에이전트를 캔버스/헤더에서 다시 열었다
    const st = useGraphStore.getState();
    expect(selectProjectIDEPaneKeys(st)).toHaveLength(2); // 창이 늘지 않았다
    expect(selectIDEPane(st, PROJ).collapsed).toBe(false); // 펴졌다
    expect(selectIDEOverlay(st).agentId).toBe(A1); // 맨 앞이다
  });

  // ── 사용자가 만든 배치를 앱이 지우지 않는다 ────────────────────────────
  it('떠 있는 창의 자리는 슬롯이 들고 있다(접었다 펴도·탭을 옮겨도 그 자리)', () => {
    open(A1, 'new');
    useGraphStore.getState().setIDEPaneFloat(PROJ, { x: 120, y: 80, w: 700, h: 500 });
    useGraphStore.getState().setIDEPaneCollapsed(PROJ, true);
    useGraphStore.getState().setIDEPaneCollapsed(PROJ, false);
    expect(selectIDEPane(useGraphStore.getState(), PROJ).float).toEqual({ x: 120, y: 80, w: 700, h: 500 });
  });

  it('버블이 사라진 창은 유령으로 잡혀 헤더에서 닫을 수 있다(배지만 오르는 상태 ❌)', () => {
    open(A1, 'new');
    // 그 에이전트 버블이 스냅샷에서 빠졌다(삭제·휴지통).
    useGraphStore.setState({ nodeMap: {} });
    const st = useGraphStore.getState();
    expect(selectOrphanIDEPanes(st).map((o) => o.paneKey)).toEqual([PROJ]);
    // 자리는 안 먹는다 — 캔버스가 잘린 채 빈 도크로 남지 않는다.
    expect(selectVisibleDockedPanes(st)).toHaveLength(0);
    useGraphStore.getState().closeIDEOverlay(PROJ);
    expect(selectProjectIDEPaneKeys(useGraphStore.getState())).toEqual([]);
  });

  it('같은 변에 쌓인 두 창의 몫은 한 번에 바뀐다(합이 어긋나는 프레임 ❌)', () => {
    open(A1, 'new');
    open(A2, 'new');
    const [first, second] = panes();
    const dock = useGraphStore.getState().setIDEPaneDock;
    dock(first, { side: 'right', size: 480, order: 0 });
    dock(second, { side: 'right', size: 480, order: 1 });
    useGraphStore.getState().setIDEDockSpans({ [first!]: 1.6, [second!]: 0.4 });
    const st = useGraphStore.getState();
    expect(selectIDEPane(st, first!).dockSpan).toBe(1.6);
    expect(selectIDEPane(st, second!).dockSpan).toBe(0.4);
  });
});
