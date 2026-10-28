import { IDE_DOCK_SIDES, type IDEDockSide, type FloatGeom } from '../components/IDE/ideDockLayout.js';
import type { IDEEditorFile, IDEOverlayState } from './graphStore.js';
import { coerceEditorOpenerTab } from './editorOpener.js';

// §5.5 #17-6 (H) — **창이 자리를 옮길 때 들고 가는 짐**(새로 만들면 편집 탭·뷰·사이드바가 초기화된다). 보내는 쪽이 뜨고(capture)
// 받는 쪽이 **초기값으로** 쓴다(patch) — 열고 나서 덮으면 첫 프레임에 빈 창이 보인다. 전부 순수 함수다.

/** 짐의 모양 — IPC(구조적 복제)를 건너므로 **직렬화 가능한 값만**. `v` 는 형식 판 번호(짐을 든 채 업데이트가 끼어도 안 엉키게). */
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
  /** 앱 안에서 **붙어 있던 변**과 두께·순서·몫. 독립 창에선 안 쓰지만 지고 나간다 — 되돌아오면 원래 그 자리로 돌아가야 한다. */
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
    // §5.5 #17-27 ⑱ — 빈 탭도 짐에 실려 간다. 갈래 칸을 모르는 판본의 짐이면 키만 남은 빈 탭이
    //   "경로가 아닌 파일"로 둔갑해 판에 읽기 오류만 남기므로, 그런 짐 한 장은 버린다.
    const tab = coerceEditorOpenerTab({
      relPath: f.relPath,
      absPath: f.absPath,
      name: f.name,
      // `dirty` 는 **지고 오지 않는다** — 저장하지 않은 편집은 그 창의 편집기 안에 있던 것이라,
      //   새 창에서 점만 찍어 두면 "고친 적 없는데 고쳤다"고 말하는 셈이 된다.
    }, f.opener);
    if (tab) out.push(tab);
  }
  return out;
}

/** IPC 로 건너온 값은 **모양이 맞을 때만** 짐으로 받는다(구버전 창·중간 업데이트) — 하나라도 어긋나면 통째로 버린다. */
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

/** 어디에 세우는 창인가 — `detached` 는 붙을 변·창 안 좌표가 뜻이 없어 **자리 값을 슬롯에 심지 않고 짐에만 남긴다**(심으면 도킹된 창인 척한다). */
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
    // §5.5 #17-27 ①-1 — 짐을 지고 온 창은 **놓은 그 크기 그대로** 선다((H-17)). 열려 온 판은 새로 열린 것이
    //   아니므로 넓힐지 이미 따진 것으로 둔다 — 안 그러면 받는 창이 서자마자 편집창 폭만큼 자랐다.
    editorRoom: handoff.editorFiles.length > 0 ? { checked: true, growth: null } : null,
  };
  if (target === 'app') {
    patch.dockSide = handoff.dockSide;
    patch.dockSize = handoff.dockSize;
    patch.dockOrder = handoff.dockOrder;
    patch.dockSpan = handoff.dockSpan;
    patch.float = handoff.float ? { ...handoff.float } : null;
    // §5.5 #17-6 (H-26) — **앱으로 합치는 창은 언제나 떠 있는 창으로 선다**(모달이면 지고 온 크기를 `80vw×80vh` 로 부풀린다).
    // 짐의 `openMode` 를 물려받지 마라 — 독립 창 슬롯의 값이라 늘 기본 `'modal'` 이고 `dockSide`·`float` 도 비어 있다.
    patch.openMode = 'floating';
  }
  return patch;
}
