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
  selectDockSlotFrontKey,
  selectDockSlotSignature,
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

  // ── 접기 = 캔버스를 돌려주는 것 → 돌려받은 캔버스에서 그 버블을 가리킨다 ─────────
  it('접으면 캔버스 카메라가 그 창의 버블로 간다', () => {
    open(A1, 'new');
    useGraphStore.setState({ focusNodeId: null });
    useGraphStore.getState().setIDEPaneCollapsed(PROJ, true);
    expect(useGraphStore.getState().focusNodeId).toBe(A1);
  });

  it('창이 여럿이어도 방금 접은 그 창의 버블을 가리킨다', () => {
    open(A1, 'new');
    open(A2, 'new');
    const [, k2] = panes();
    useGraphStore.setState({ focusNodeId: null });
    useGraphStore.getState().setIDEPaneCollapsed(k2!, true);
    expect(useGraphStore.getState().focusNodeId).toBe(A2);
  });

  it('펴는 것은 카메라를 건드리지 않는다(접었던 자리로 돌아올 뿐)', () => {
    open(A1, 'new');
    useGraphStore.getState().setIDEPaneCollapsed(PROJ, true);
    useGraphStore.setState({ focusNodeId: null });
    useGraphStore.getState().setIDEPaneCollapsed(PROJ, false);
    expect(useGraphStore.getState().focusNodeId).toBeNull();
  });

  it('버블이 사라진 유령 창을 접어도 카메라를 던지지 않는다', () => {
    open(A1, 'new');
    // 그 에이전트가 스냅샷에서 빠졌다(삭제·휴지통) — 캔버스가 못 찾을 곳으로 보내면
    //   focusNodeId 만 남아 나중에 엉뚱한 순간 카메라가 튄다.
    useGraphStore.setState({ nodeMap: {}, focusNodeId: null });
    useGraphStore.getState().setIDEPaneCollapsed(PROJ, true);
    expect(useGraphStore.getState().focusNodeId).toBeNull();
  });

  it('휴지통으로 간 버블이면 접어도 카메라를 던지지 않는다', () => {
    open(A1, 'new');
    useGraphStore.setState({
      nodeMap: { ...useGraphStore.getState().nodeMap, [A1]: { ...agentNode(A1), trashed: true } },
      focusNodeId: null,
    });
    useGraphStore.getState().setIDEPaneCollapsed(PROJ, true);
    expect(useGraphStore.getState().focusNodeId).toBeNull();
  });

  // ── 사용자가 만든 배치를 앱이 지우지 않는다 ────────────────────────────
  it('떠 있는 창의 자리는 슬롯이 들고 있다(접었다 펴도·탭을 옮겨도 그 자리)', () => {
    open(A1, 'new');
    useGraphStore.getState().setIDEPaneFloat(PROJ, { x: 120, y: 80, w: 700, h: 500 });
    useGraphStore.getState().setIDEPaneCollapsed(PROJ, true);
    useGraphStore.getState().setIDEPaneCollapsed(PROJ, false);
    expect(selectIDEPane(useGraphStore.getState(), PROJ).float).toEqual({ x: 120, y: 80, w: 700, h: 500 });
  });

  it('최대화도 슬롯이 들고 있다 — 프로젝트 탭을 옮겼다 돌아와도 안 풀린다', () => {
    // 사용자 보고: 상단에 붙여 최대화해 둔 창이, 다른 프로젝트에 갔다 오면 **붙은 변만** 살아
    //   돌아오고 최대화는 사라졌다. 창은 프로젝트 탭마다 언마운트되므로 컴포넌트 로컬 상태로는
    //   지킬 수 없다 — `float`·`dockSide` 와 같은 자리에 있어야 한다.
    open(A1, 'new');
    useGraphStore.getState().setIDEPaneDock(PROJ, { side: 'top', size: 420, order: 0 });
    useGraphStore.getState().setIDEPaneMaximized(PROJ, true);
    // 다른 프로젝트로 갔다 온다 — 창 컴포넌트가 통째로 언마운트/재마운트되는 것과 같은 일이다.
    useGraphStore.setState({ activeProject: 'other' });
    expect(selectRenderedIDEPaneKeys(useGraphStore.getState())).toEqual([]);
    useGraphStore.setState({ activeProject: PROJ });
    const back = selectIDEPane(useGraphStore.getState(), PROJ);
    expect(back.maximized).toBe(true);
    // 최대화는 붙은 변 **위에 덮이는** 상태다 — 복원하면 그 자리로 돌아가야 하므로 변은 남는다.
    expect(back.dockSide).toBe('top');
  });

  it('최대화를 풀면 붙어 있던 변은 그대로다(복원 = 그 자리로 돌아가기)', () => {
    open(A1, 'new');
    useGraphStore.getState().setIDEPaneDock(PROJ, { side: 'top', size: 420, order: 0 });
    useGraphStore.getState().setIDEPaneMaximized(PROJ, true);
    useGraphStore.getState().setIDEPaneMaximized(PROJ, false);
    const st = selectIDEPane(useGraphStore.getState(), PROJ);
    expect(st.maximized).toBe(false);
    expect(st.dockSide).toBe('top');
  });

  it('창을 닫았다 다시 열면 최대화는 풀려 있다(슬롯째 사라졌다가 새로 선다)', () => {
    open(A1, 'new');
    useGraphStore.getState().setIDEPaneMaximized(PROJ, true);
    useGraphStore.getState().closeIDEOverlay(PROJ);
    open(A1, 'new');
    expect(selectIDEPane(useGraphStore.getState(), PROJ).maximized).toBe(false);
  });

  it('붙은 자리를 재사용해 버블만 갈아 끼우면 최대화는 그 자리의 성질로 남는다', () => {
    open(A1, 'new');
    useGraphStore.getState().setIDEPaneDock(PROJ, { side: 'right', size: 480, order: 0 });
    useGraphStore.getState().setIDEPaneMaximized(PROJ, true);
    // 북마크 점프처럼 창을 쌓지 않는 진입점 — 맨 앞 창의 자리를 그대로 물려받는다.
    open(A2);
    const st = selectIDEPane(useGraphStore.getState(), PROJ);
    expect(st.agentId).toBe(A2);
    expect(st.dockSide).toBe('right');
    expect(st.maximized).toBe(true);
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

// ─── (판올림 번호 발급 대기) 언리얼식 탭 도킹 · 레이아웃 프리셋 · 창 순환 ───

describe('한 칸에 여러 창 — 탭 도킹', () => {
  beforeEach(reset);

  /** 같은 변 + 같은 order 로 붙이면 한 칸을 나눠 쓴다(붙이기 커밋이 하는 일과 같은 모양). */
  function dockAt(paneKey: string, side: 'left' | 'right' | 'top' | 'bottom', order: number): void {
    useGraphStore.getState().setIDEPaneDock(paneKey, { side, size: 480, order });
  }

  it('같은 칸에 겹친 창 중 **마지막으로 앞에 온 하나**만 그린다', () => {
    open(A1, 'new');
    open(A2, 'new');
    const [k1, k2] = panes();
    dockAt(k1!, 'right', 0);
    dockAt(k2!, 'right', 0);
    const s = useGraphStore.getState();
    // 나중에 연 창이 앞이다.
    expect(selectDockSlotFrontKey(s, k1!)).toBe(k2);
    expect(selectDockSlotFrontKey(s, k2!)).toBe(k2);
    useGraphStore.getState().focusIDEPane(k1!);
    expect(selectDockSlotFrontKey(useGraphStore.getState(), k1!)).toBe(k1);
  });

  it('탭 줄 지문에는 그 칸의 창들이 **열린 순서**로 들어간다(앞뒤 도장으로 흔들리지 않게)', () => {
    open(A1, 'new');
    open(A2, 'new');
    const [k1, k2] = panes();
    dockAt(k1!, 'right', 0);
    dockAt(k2!, 'right', 0);
    useGraphStore.getState().focusIDEPane(k1!);
    const sig = selectDockSlotSignature(useGraphStore.getState(), k2!);
    const keys = sig.split(';').map((raw) => decodeURIComponent(raw.split('|')[0] ?? ''));
    expect(keys).toEqual([k1, k2]);
    // 앞에 선 창은 지문에 표시된다 — 탭 강조와 본문이 같은 판정을 읽는다.
    expect(sig.split(';').map((raw) => raw.split('|')[2])).toEqual(['1', '0']);
  });

  it('칸이 하나뿐이면 탭 줄을 그리지 않는다(빈 지문)', () => {
    open(A1, 'new');
    const [k1] = panes();
    dockAt(k1!, 'right', 0);
    expect(selectDockSlotSignature(useGraphStore.getState(), k1!)).toBe('');
  });

  it('접힌 창은 같은 칸이어도 탭 줄에서 빠진다(화면에 없는 것을 탭으로 세지 않는다)', () => {
    open(A1, 'new');
    open(A2, 'new');
    const [k1, k2] = panes();
    dockAt(k1!, 'right', 0);
    dockAt(k2!, 'right', 0);
    useGraphStore.getState().setIDEPaneCollapsed(k2!, true);
    expect(selectDockSlotSignature(useGraphStore.getState(), k1!)).toBe('');
    expect(selectDockSlotFrontKey(useGraphStore.getState(), k1!)).toBe(k1);
  });
});

describe('레이아웃 프리셋 (applyIDEWindowLayout)', () => {
  /** 뷰포트는 인자로 받는다 — 화면 크기를 바꿔 가며 검증할 수 있게(ideDockLayout 규약). */
  const VP = { w: 1600, h: 900 };
  beforeEach(reset);

  function openThree(): string[] {
    open(A1, 'new');
    open(A2, 'new');
    open(A3, 'new');
    return panes();
  }

  it('바둑판 — 전부 떼어 서로 다른 자리에 늘어놓는다', () => {
    const keys = openThree();
    useGraphStore.getState().applyIDEWindowLayout('tile', VP);
    const s = useGraphStore.getState();
    const floats = keys.map((k) => s.ideOverlays[k]!.float!);
    for (const k of keys) expect(s.ideOverlays[k]!.dockSide).toBeNull();
    expect(new Set(floats.map((f) => `${f.x},${f.y}`)).size).toBe(keys.length);
    // 밖에서 배치를 바꿨다는 신호가 올라야 창이 자기 모양을 다시 읽는다.
    expect(s.ideLayoutEpoch).toBeGreaterThan(0);
  });

  it('오른쪽에 탭으로 모으기 — 전부 같은 변·같은 칸이 된다(화면은 한 번만 잘린다)', () => {
    const keys = openThree();
    useGraphStore.getState().applyIDEWindowLayout('tabRight', VP);
    const s = useGraphStore.getState();
    for (const k of keys) {
      expect(s.ideOverlays[k]!.dockSide).toBe('right');
      expect(s.ideOverlays[k]!.dockOrder).toBe(0);
    }
    // 붙은 창이 셋이어도 자리는 하나 — 세 창이 같은 칸을 받는다.
    const docked = selectVisibleDockedPanes(s);
    expect(docked).toHaveLength(3);
    expect(new Set(docked.map((d) => d.order)).size).toBe(1);
  });

  it('좌우로 나눠 붙이기 — 앞 절반은 왼쪽, 뒤 절반은 오른쪽', () => {
    const keys = openThree();
    useGraphStore.getState().applyIDEWindowLayout('splitLeftRight', VP);
    const s = useGraphStore.getState();
    const sides = keys.map((k) => s.ideOverlays[k]!.dockSide);
    expect(sides).toEqual(['left', 'left', 'right']);
  });

  it('전부 떼어 내기 — 붙은 변만 풀고 자리는 건드리지 않는다', () => {
    const keys = openThree();
    useGraphStore.getState().applyIDEWindowLayout('tile', VP);
    const before = useGraphStore.getState().ideOverlays[keys[0]!]!.float;
    useGraphStore.getState().applyIDEWindowLayout('tabRight', VP);
    useGraphStore.getState().applyIDEWindowLayout('undockAll', VP);
    const s = useGraphStore.getState();
    for (const k of keys) expect(s.ideOverlays[k]!.dockSide).toBeNull();
    expect(s.ideOverlays[keys[0]!]!.float).toEqual(before);
  });

  it('접어 둔 창은 정리 대상이 아니다 — 프리셋이 몰래 펴지 않는다', () => {
    const keys = openThree();
    useGraphStore.getState().setIDEPaneCollapsed(keys[2]!, true);
    useGraphStore.getState().applyIDEWindowLayout('tabRight', VP);
    const s = useGraphStore.getState();
    expect(s.ideOverlays[keys[2]!]!.collapsed).toBe(true);
    expect(s.ideOverlays[keys[2]!]!.dockSide).toBeNull();
    expect(s.ideOverlays[keys[0]!]!.dockSide).toBe('right');
  });

  it('자리를 새로 정하는 프리셋은 최대화를 푼다(정리했는데 한 창이 여전히 덮는 상태 ❌)', () => {
    const keys = openThree();
    for (const k of keys) useGraphStore.getState().setIDEPaneMaximized(k, true);
    useGraphStore.getState().applyIDEWindowLayout('tile', VP);
    for (const k of keys) expect(useGraphStore.getState().ideOverlays[k]!.maximized).toBe(false);
    for (const k of keys) useGraphStore.getState().setIDEPaneMaximized(k, true);
    useGraphStore.getState().applyIDEWindowLayout('tabRight', VP);
    for (const k of keys) expect(useGraphStore.getState().ideOverlays[k]!.maximized).toBe(false);
  });

  it('전부 접기/펴기는 배치를 안 건드리므로 최대화도 그대로 둔다', () => {
    const keys = openThree();
    useGraphStore.getState().setIDEPaneMaximized(keys[0]!, true);
    useGraphStore.getState().applyIDEWindowLayout('collapseAll', VP);
    useGraphStore.getState().applyIDEWindowLayout('expandAll', VP);
    expect(useGraphStore.getState().ideOverlays[keys[0]!]!.maximized).toBe(true);
  });

  it('전부 접기/펴기는 접힌 창까지 함께 움직인다', () => {
    const keys = openThree();
    useGraphStore.getState().applyIDEWindowLayout('collapseAll', VP);
    expect(panes().every((k) => useGraphStore.getState().ideOverlays[k]!.collapsed)).toBe(true);
    expect(selectRenderedIDEPaneKeys(useGraphStore.getState())).toEqual([]);
    useGraphStore.getState().applyIDEWindowLayout('expandAll', VP);
    expect(selectRenderedIDEPaneKeys(useGraphStore.getState()).sort()).toEqual([...keys].sort());
  });
});

describe('창 순환 (cycleIDEPaneFocus)', () => {
  beforeEach(reset);

  it('열린 순서대로 다음 창을 앞으로 — 두 창 사이만 오가지 않는다', () => {
    open(A1, 'new');
    open(A2, 'new');
    open(A3, 'new');
    const keys = panes();
    const front = (): string => {
      const s = useGraphStore.getState();
      return [...keys].sort((a, b) => s.ideOverlays[b]!.z - s.ideOverlays[a]!.z)[0]!;
    };
    expect(front()).toBe(keys[2]);
    useGraphStore.getState().cycleIDEPaneFocus(1);
    expect(front()).toBe(keys[0]);
    useGraphStore.getState().cycleIDEPaneFocus(1);
    expect(front()).toBe(keys[1]);
    useGraphStore.getState().cycleIDEPaneFocus(-1);
    expect(front()).toBe(keys[0]);
  });

  it('창이 하나뿐이면 아무 일도 하지 않는다', () => {
    open(A1, 'new');
    const before = useGraphStore.getState().idePaneSeq;
    useGraphStore.getState().cycleIDEPaneFocus(1);
    expect(useGraphStore.getState().idePaneSeq).toBe(before);
  });
});
