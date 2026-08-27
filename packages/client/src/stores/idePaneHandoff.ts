import { IDE_DOCK_SIDES, type IDEDockSide, type FloatGeom } from '../components/IDE/ideDockLayout.js';
import type { IDEEditorFile, IDEOverlayState } from './graphStore.js';

// SCENARIO.md §5.5 #17-6 (H) — **창이 자리를 옮길 때 들고 가는 짐**.
//
// 앱 안 IDE 창을 밖으로 꺼내거나 다시 합칠 때, 종전에는 받는 쪽이 `openIDEOverlay` 로 창을
// **새로** 만들었다. 그 함수는 열어 둔 편집 탭을 비우고(`editorFiles: []`) 뷰를 첫 화면으로
// 되돌리며 사이드바를 접는다 — 그래서 꺼내고 나면 보던 파일이 전부 닫힌 **다른 창**이 서 있었다.
// 같은 창이 밖으로 나온 것이 아니라 비슷한 창이 새로 뜬 것이라, 오갈수록 작업 상태를 잃었다.
//
// 이 파일이 그 사이를 잇는다: 보내는 쪽이 창의 상태를 **한 덩이로 뜨고**(capture), 받는 쪽이
// 그것을 창을 세우는 **초기값으로** 쓴다(patch). 열고 나서 덮어쓰지 않고 처음부터 그 값으로
// 여는 까닭은, 덮어쓰면 첫 프레임에 빈 창이 한 번 보였다가 바뀌기 때문이다.
//
// **여기 있는 것은 전부 순수 함수다** — IPC 도 스토어도 만지지 않으므로 창을 띄우지 않고
// 단위 테스트로 확인할 수 있다(`idePaneHandoff.test.ts`).

/**
 * 짐의 모양. IPC(구조적 복제)를 건너므로 **직렬화 가능한 값만** 담는다.
 *
 * `v` 는 판 번호다. 같은 프로세스의 창끼리 주고받으므로 지금은 늘 1 이지만, 짐을 든 채
 * 업데이트가 끼어드는 경우(창은 옛 판, 앱은 새 판)에 조용히 엉키지 않도록 앞에 세워 둔다.
 */
export interface IDEPaneHandoff {
  v: 1;
  agentId: string;
  projectId: string | null;
  /** 보고 있던 세션. */
  activeSessionId: string | null;
  /** 보고 있던 사이드바 뷰(문자열 그대로 — 아는 값인지는 받는 쪽이 가린다). */
  activeView: string;
  sidebarCollapsed: boolean;
  /** 열어 둔 편집 탭(왼→오른쪽 순서 그대로). */
  editorFiles: IDEEditorFile[];
  activeEditorPath: string | null;
  /**
   * 앱 안에서 **붙어 있던 변**과 그 두께·순서·몫.
   *
   * 밖으로 나간 창에서는 쓰이지 않지만(독립 창은 창 자체가 IDE 라 붙을 변이 없다) 그대로 지고
   * 나간다 — 되돌아왔을 때 **원래 붙어 있던 그 자리로** 돌아가야 "합쳤다"가 되기 때문이다.
   */
  dockSide: IDEDockSide | null;
  dockSize: number;
  dockOrder: number;
  dockSpan: number;
  /** 안 붙어 있을 때 놓여 있던 자리·크기. */
  float: FloatGeom | null;
  openMode: 'modal' | 'floating';
}

/** 창 하나의 지금 상태를 짐으로 뜬다. */
export function captureIDEPaneHandoff(pane: IDEOverlayState): IDEPaneHandoff | null {
  if (!pane.agentId) return null;
  return {
    v: 1,
    agentId: pane.agentId,
    projectId: pane.projectId,
    activeSessionId: pane.activeSessionId,
    activeView: pane.activeView,
    sidebarCollapsed: pane.sidebarCollapsed,
    // 얕은 복사로 충분하다 — 탭 항목은 원시값만 든 평평한 객체다.
    editorFiles: pane.editorFiles.map((f) => ({ ...f })),
    activeEditorPath: pane.activeEditorPath,
    dockSide: pane.dockSide,
    dockSize: pane.dockSize,
    dockOrder: pane.dockOrder,
    dockSpan: pane.dockSpan,
    float: pane.float ? { ...pane.float } : null,
    openMode: pane.openMode,
  };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function coerceEditorFiles(raw: unknown): IDEEditorFile[] {
  if (!Array.isArray(raw)) return [];
  const out: IDEEditorFile[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const f = item as Record<string, unknown>;
    if (typeof f.relPath !== 'string' || f.relPath.length === 0) continue;
    if (typeof f.absPath !== 'string' || typeof f.name !== 'string') continue;
    out.push({
      relPath: f.relPath,
      absPath: f.absPath,
      name: f.name,
      // `dirty` 는 **지고 오지 않는다** — 저장하지 않은 편집은 그 창의 편집기 안에 있던 것이라,
      //   새 창에서 점만 찍어 두면 "고친 적 없는데 고쳤다"고 말하는 셈이 된다.
    });
  }
  return out;
}

/**
 * IPC 로 건너온 값을 짐으로 받아들인다 — **모양이 맞는 것만**.
 *
 * 창 사이를 건너온 값이라 우리가 보낸 그대로라는 보장이 없다(구버전 창·중간에 낀 업데이트).
 * 하나라도 어긋나면 통째로 버린다 — 반쯤 맞는 짐으로 창을 세우면 어디가 틀어졌는지 알 수 없다.
 */
export function coerceIDEPaneHandoff(raw: unknown): IDEPaneHandoff | null {
  if (!raw || typeof raw !== 'object') return null;
  const h = raw as Record<string, unknown>;
  if (h.v !== 1) return null;
  if (typeof h.agentId !== 'string' || h.agentId.length === 0) return null;
  const dockSide = IDE_DOCK_SIDES.includes(h.dockSide as IDEDockSide) ? (h.dockSide as IDEDockSide) : null;
  const rawFloat = h.float as Record<string, unknown> | null | undefined;
  const float: FloatGeom | null = rawFloat
    && isFiniteNumber(rawFloat.x) && isFiniteNumber(rawFloat.y)
    && isFiniteNumber(rawFloat.w) && isFiniteNumber(rawFloat.h)
    ? { x: rawFloat.x, y: rawFloat.y, w: rawFloat.w, h: rawFloat.h }
    : null;
  return {
    v: 1,
    agentId: h.agentId,
    projectId: typeof h.projectId === 'string' ? h.projectId : null,
    activeSessionId: typeof h.activeSessionId === 'string' ? h.activeSessionId : null,
    activeView: typeof h.activeView === 'string' ? h.activeView : '',
    sidebarCollapsed: h.sidebarCollapsed === true,
    editorFiles: coerceEditorFiles(h.editorFiles),
    activeEditorPath: typeof h.activeEditorPath === 'string' ? h.activeEditorPath : null,
    dockSide,
    dockSize: isFiniteNumber(h.dockSize) ? h.dockSize : 0,
    dockOrder: isFiniteNumber(h.dockOrder) ? h.dockOrder : 0,
    dockSpan: isFiniteNumber(h.dockSpan) ? h.dockSpan : 1,
    float,
    openMode: h.openMode === 'floating' ? 'floating' : 'modal',
  };
}

/**
 * 어디에 세우는 창인가 — 같은 짐이라도 앱 안과 독립 창이 물려받을 것이 다르다.
 *
 * `detached`(독립 창)는 창 자체가 IDE 라 붙을 변도, 창 안 좌표도 뜻이 없다. 그래서 **자리 값은
 * 물려받지 않고 짐 안에만 남겨 둔다** — 되돌아올 때 그 값이 다시 살아나 원래 붙어 있던 변으로
 * 복귀한다. 자리 값을 슬롯에 그대로 심으면 독립 창이 도킹된 창인 척하게 된다.
 */
export type HandoffTarget = 'app' | 'detached';

/** 창을 세울 때 초기값 위에 덮을 조각. 열고 나서 고치지 않고 **처음부터** 이 값으로 연다. */
export function handoffPanePatch(
  handoff: IDEPaneHandoff,
  target: HandoffTarget,
): Partial<IDEOverlayState> {
  const patch: Partial<IDEOverlayState> = {
    activeSessionId: handoff.activeSessionId,
    sidebarCollapsed: handoff.sidebarCollapsed,
    editorFiles: handoff.editorFiles.map((f) => ({ ...f })),
    // 열어 둔 탭 중에 없는 경로를 가리키고 있으면 아무 탭도 고르지 않은 것으로 둔다.
    activeEditorPath: handoff.editorFiles.some((f) => f.relPath === handoff.activeEditorPath)
      ? handoff.activeEditorPath
      : null,
  };
  if (target === 'app') {
    patch.dockSide = handoff.dockSide;
    patch.dockSize = handoff.dockSize;
    patch.dockOrder = handoff.dockOrder;
    patch.dockSpan = handoff.dockSpan;
    patch.float = handoff.float ? { ...handoff.float } : null;
    // 붙어 있던 창은 붙은 채로 돌아오고, 떠 있던 창은 뜬 채로 돌아온다 — 모달로 돌아오면
    //   캔버스를 통째로 덮어 "원래 자리로 합쳤다"는 느낌이 깨진다.
    patch.openMode = handoff.dockSide || handoff.float ? 'floating' : handoff.openMode;
  }
  return patch;
}
