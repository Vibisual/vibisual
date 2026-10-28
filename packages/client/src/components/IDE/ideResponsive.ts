import { IDE_EDITOR_WIDTH } from '@vibisual/shared';
import type { IDEViewType } from '../../stores/graphStore.js';

/**
 * IDE 창 안 반응형 — 기준은 뷰포트가 아니라 창 폭이다. `max-md`·`useIsNarrowViewport` 로 가르면 넓은 화면의 좁은 창에서 고정 폭 조각(`flex-shrink-0`)이 먼저 먹어 대화가 0 까지 찌부러진다.
 * 창 폭은 인자로(`window.innerWidth` 는 시험 불가). 덜 잃는 것부터 접고 되부를 손잡이를 남긴다.
 */

/** 창 안 가로 배치의 고정 치수 — Tailwind 클래스와 짝이 맞아야 한다(한쪽만 고치면 판정이 어긋난다). */
export const IDE_BODY = {
  /** `IDEActivityBar` 의 `w-12`. */
  ACTIVITY_W: 48,
  /** `IDESidebar` 의 기본 `w-52`. */
  SIDEBAR_W: 208,
  /** `IDESidebar` 가 주입원 뷰에서 쓰는 `w-72`(§5.5 #17-28). */
  SIDEBAR_CONTEXT_W: 288,
  /** 대화가 보장받는 최소 폭(px) — 더 좁으면 글자가 세로로 선다. 분할 칸 하한(`IDE_SPLIT.minCellWidthPx` 280, "나눠도 되나")보다 넉넉하게. */
  MIN_STREAM_W: 320,
  /** 타이틀바 손잡이를 접기 시작하는 창 폭(px) — 오른쪽 묶음은 `flex-shrink-0`(줄면 [닫기]가 사라진다)이라 `titleBarChrome` 이 접는다. 떠 있는 창 하한(480)보다 조금 위. */
  TITLE_FOLD_W: 520,
} as const;

/** 사이드바가 이 뷰에서 먹는 폭(px) — `IDESidebar` 의 `w-52`/`w-72` 분기와 같은 값. */
export function ideSidebarWidth(activeView: IDEViewType): number {
  return activeView === 'context' ? IDE_BODY.SIDEBAR_CONTEXT_W : IDE_BODY.SIDEBAR_W;
}

/** 창 안 조각(막대·레일·diff)의 접기 문턱(px) — 폭은 조각이 스스로 잰 값(`useElementWidth`, 뷰포트 ❌). 못 쟀으면(0) 접지 않는다(첫 프레임을 흔들지 않게). */
export const IDE_PIECE_FOLD = {
  /** 편집창 찾기 막대(§5.5 #17-27 ⑲) — 이보다 좁으면 상태·이전/다음/닫기를 둘째 줄로(편집창 하한 280px 에서 입력칸이 0 까지 눌린다). 기본 460px 은 한 줄. */
  FIND_BAR_STACK_W: 400,
  /**
   * diff(§5.5 #17-30) — 이보다 좁으면 좌우 두 열 대신 **한 열**(지운 줄 위, 고친 줄 아래)로 쌓는다.
   * 두 열이면 열마다 줄 번호·표식 몫(약 60px)을 따로 내 글자 칸이 한 열에 120px 남짓만 남는다.
   */
  DIFF_STACK_W: 480,
  /** CMD 카드 레일(§4)의 펼친 폭 — `IDETerminalCardRail` 의 `w-[360px]` 와 짝이다. */
  TERMINAL_RAIL_W: 360,
} as const;

/** 찾기 막대가 두 줄로 쌓이는가 — 막대 **자기 폭**으로 묻는다. */
export function findBarStacked(barWidth: number): boolean {
  return barWidth > 0 && barWidth < IDE_PIECE_FOLD.FIND_BAR_STACK_W;
}

/** diff 를 한 열로 쌓는가 — diff 상자 자기 폭으로 묻는다. */
export function diffStacked(width: number): boolean {
  return width > 0 && width < IDE_PIECE_FOLD.DIFF_STACK_W;
}

/**
 * CMD 카드 레일이 터미널 **옆**이 아니라 **위**에 떠야 하는가 — 터미널 칸(레일 포함) 폭으로 묻는다.
 * 옆에 세우면 터미널에 대화 하한(`MIN_STREAM_W`)도 안 남는 칸이면 접힌 띠로 시작하고, 펼치면 덮는다.
 */
export function terminalRailOverlays(width: number): boolean {
  return width > 0 && width < IDE_PIECE_FOLD.TERMINAL_RAIL_W + IDE_BODY.MIN_STREAM_W;
}

export interface IDEBodyInput {
  /** 창 본문 행의 실제 폭(px). `0` 이하면 아직 못 쟀다(첫 프레임) → 뷰포트 기준으로 폴백. */
  width: number;
  /** 폰 폭(`useIsNarrowViewport`, ≤767px) 축은 남긴다 — 터치는 창이 넓어도 손가락 표적·세로 공간 때문에 서랍 배치가 맞다(§4). */
  viewportNarrow: boolean;
  /** 사용자가 사이드바를 접어 뒀나 — 접혀 있으면 애초에 자리를 안 먹는다. */
  sidebarCollapsed: boolean;
  /** 안 접혔을 때 사이드바가 먹는 폭(px) — `ideSidebarWidth`. */
  sidebarWidth: number;
  /** 편집창에 연 파일이 있나(없으면 패널 자체가 렌더되지 않는다 — §5.5 #17-27 ①). */
  editorOpen: boolean;
  /** 사용자가 끌어 저장해 둔 편집창 폭(px, `localStorage`). */
  editorWidth: number;
}

export interface IDEBodyLayout {
  /** 폭을 실제로 쟀나. `false` = 첫 프레임(뷰포트 기준 폴백을 쓰는 중). */
  measured: boolean;
  /** 활동바까지 본문 위 서랍으로 — 폰과 같은 거동. `true` 면 `sidebarDrawer` 도 항상 `true`. */
  navDrawer: boolean;
  /** 사이드바만 서랍으로(활동바 48px 은 자리에 남아 되부를 손잡이가 된다). */
  sidebarDrawer: boolean;
  /** 편집창이 대화 **옆**이 아니라 **위**를 덮는다. */
  editorDrawer: boolean;
  /** 나란히 설 때 편집창이 실제로 가져갈 폭(px). 저장된 폭은 건드리지 않는다. */
  editorWidth: number;
  /** 손잡이를 끌어 넓힐 수 있는 상한(px) — 이 이상 끌면 대화가 하한을 깬다. */
  editorMaxWidth: number;
  /** 위 판정을 적용했을 때 대화가 실제로 갖는 폭(px). 회귀 테스트가 이 값을 본다. */
  streamWidth: number;
  /** 타이틀바가 손잡이를 한 줄에 못 세우는 폭인가(`resolveTitleBarChrome` 의 `narrow`) — 뷰포트 판정이면 창만 좁힐 때 [닫기]가 밖으로 밀린다. */
  titleBarNarrow: boolean;
}

/** 편집창 손잡이를 끄는 동안의 한 판(드래그 시작 시점에 붙잡아 둔다). */
export interface EditorResizeDrag {
  /** 손잡이를 누른 순간의 커서 x(px). */
  startX: number;
  /** 그때의 편집창 폭(px). */
  startWidth: number;
  /** 이 창에서 대화 하한을 지키는 상한(px) — `IDEBodyLayout.editorMaxWidth`. */
  max: number;
}

/** 끄는 동안의 편집창 폭 — 처음부터의 이동량으로 잰다(증분을 더하면 한계에 닿은 뒤 되돌릴 때 끈적인다). 오른쪽에 붙어 왼쪽으로 끌수록 넓어진다. */
export function dragEditorWidth(drag: EditorResizeDrag, clientX: number): number {
  const raw = drag.startWidth + (drag.startX - clientX);
  return Math.round(Math.min(drag.max, Math.max(IDE_EDITOR_WIDTH.MIN, raw)));
}

/** 저장된 편집창 폭을 전역 하한/상한 안으로. 스토어의 `clampIdeEditorWidth` 와 같은 규칙. */
function clampEditor(w: number): number {
  if (!Number.isFinite(w)) return IDE_EDITOR_WIDTH.DEFAULT;
  return Math.min(IDE_EDITOR_WIDTH.MAX, Math.max(IDE_EDITOR_WIDTH.MIN, Math.round(w)));
}

/** 창 폭으로 접을 것을 정한다(값만). 차례: 1 편집창 줄이기(하한 280) → 2 사이드바 서랍 → 3 편집창을 대화 위로 → 4 활동바까지 서랍(도킹 하한 260 부근). */
export function resolveIDEBodyLayout(input: IDEBodyInput): IDEBodyLayout {
  const { width, viewportNarrow, sidebarCollapsed, sidebarWidth, editorOpen } = input;
  const stored = clampEditor(input.editorWidth);

  // 아직 못 쟀다 — 첫 프레임에 잘못 접으면 화면이 한 번 튄다. 종전(뷰포트) 판정 그대로 둔다.
  if (!(width > 0)) {
    return {
      measured: false,
      navDrawer: viewportNarrow,
      sidebarDrawer: viewportNarrow,
      editorDrawer: viewportNarrow,
      editorWidth: stored,
      editorMaxWidth: IDE_EDITOR_WIDTH.MAX,
      streamWidth: 0,
      titleBarNarrow: viewportNarrow,
    };
  }

  // 폰 — 창 폭과 무관하게 종전 거동(활동바·사이드바 서랍 + 편집창 오버레이).
  if (viewportNarrow) {
    return {
      measured: true,
      navDrawer: true,
      sidebarDrawer: true,
      editorDrawer: true,
      editorWidth: stored,
      editorMaxWidth: IDE_EDITOR_WIDTH.MAX,
      streamWidth: width,
      titleBarNarrow: true,
    };
  }

  const nav = IDE_BODY.ACTIVITY_W;
  const side = sidebarCollapsed ? 0 : Math.max(0, sidebarWidth);
  const minStream = IDE_BODY.MIN_STREAM_W;

  let sidebarDrawer = false;
  let editorDrawer = false;
  let navDrawer = false;
  let editorWidth = editorOpen ? stored : 0;

  /** 지금 판정으로 대화에 남는 폭. */
  const stream = (): number =>
    width
    - (navDrawer ? 0 : nav)
    - (sidebarDrawer ? 0 : side)
    - (editorDrawer || !editorOpen ? 0 : editorWidth);

  /** 이 조합에서 편집창이 가질 수 있는 최대 폭(대화 하한을 지키면서). */
  const editorRoom = (): number =>
    width - (navDrawer ? 0 : nav) - (sidebarDrawer ? 0 : side) - minStream;

  // ① 편집창을 줄인다 — 저장된 폭은 그대로 두고 **이 창에서만** 좁게 쓴다.
  if (editorOpen && stream() < minStream) {
    editorWidth = Math.min(stored, Math.max(IDE_EDITOR_WIDTH.MIN, editorRoom()));
  }

  // ② 사이드바를 서랍으로 — 활동바는 남긴다(사라진 목록을 되부르는 유일한 손잡이).
  if (!sidebarCollapsed && stream() < minStream) {
    sidebarDrawer = true;
    if (editorOpen) editorWidth = Math.min(stored, Math.max(IDE_EDITOR_WIDTH.MIN, editorRoom()));
  }

  // ③ 편집창이 대화를 덮는다 — 나란히 세울 자리가 정말 없다.
  if (editorOpen && stream() < minStream) editorDrawer = true;

  // ④ 활동바 48px 마저 못 내는 창 — 폰과 같은 서랍으로 내려간다.
  if (stream() < minStream) {
    navDrawer = true;
    sidebarDrawer = true;
  }

  return {
    measured: true,
    navDrawer,
    sidebarDrawer,
    editorDrawer,
    editorWidth: editorOpen ? Math.max(IDE_EDITOR_WIDTH.MIN, Math.round(editorWidth)) : stored,
    // 손잡이 상한은 **지금 접힌 상태 기준**이다 — 사이드바가 서랍이면 그만큼 더 끌 수 있다.
    editorMaxWidth: Math.max(IDE_EDITOR_WIDTH.MIN, Math.min(IDE_EDITOR_WIDTH.MAX, editorRoom())),
    streamWidth: Math.max(0, Math.round(stream())),
    titleBarNarrow: width < IDE_BODY.TITLE_FOLD_W,
  };
}

/**
 * §5.5 #17-27 ①-1 — 판을 열 때 넓힐 창 폭. 무언가 접히는 창에서만 양수(편집창 폭 — 대화 폭 유지), 그 밖·폰·못 잰 첫 프레임은 0.
 * 열기 전 서랍에 있던 사이드바·활동바 몫도 넓힌다(빼면 그들이 먼저 먹는다 — 500px·208·520 → 대화 320·편집창 444).
 */
export function editorGrowth(input: Omit<IDEBodyInput, 'editorOpen'>): number {
  if (input.viewportNarrow || !(input.width > 0)) return 0;
  const closed = resolveIDEBodyLayout({ ...input, editorOpen: false });
  const open = resolveIDEBodyLayout({ ...input, editorOpen: true });
  const folds = open.editorDrawer
    || (open.sidebarDrawer && !closed.sidebarDrawer)
    || (open.navDrawer && !closed.navDrawer);
  if (!folds) return 0;
  const side = input.sidebarCollapsed ? 0 : Math.max(0, input.sidebarWidth);
  return clampEditor(input.editorWidth)
    + (closed.sidebarDrawer ? side : 0)
    + (closed.navDrawer ? IDE_BODY.ACTIVITY_W : 0);
}

/** 좌/우 도크 두께를 판 때문에 넓힌 한 번의 기록. `seq` 는 그 넓힘을 따진 차례다(늦게 따질수록 크다). */
export interface DockGrowthRecord {
  before: number;
  after: number;
  seq: number;
}

/** 같은 변에 붙은 다른 창 가운데 **판이 열려 있고 넓힐지 이미 따진** 창. */
export interface DockGrowthHeir {
  key: string;
  /** 그 창이 넓힐지 따진 차례. */
  seq: number;
  /** 그 창이 쥐고 있는 같은 변의 두께 기록(없으면 `null`). */
  growth: DockGrowthRecord | null;
}

export type DockGrowthClose =
  | { kind: 'revert'; size: number }
  | { kind: 'hand'; key: string; growth: DockGrowthRecord }
  | { kind: 'keep' };

/** §5.5 #17-27 ①-1 — 판을 닫을 때 넓힌 도크 두께(변 전체 성질). 넓힌 뒤에 따진 창(`seq` 큰 창)이 남으면 되돌리지 않고 기록을 넘긴다(되돌리면 그 창이 찌부러진다) — 마지막 판에서 처음 두께로. */
export function dockGrowthOnClose(
  rec: DockGrowthRecord,
  now: number,
  heirs: readonly DockGrowthHeir[],
): DockGrowthClose {
  const relying = heirs.filter((h) => h.seq > rec.seq);
  if (relying.length === 0) {
    // 되돌리기는 **자란 그대로일 때만** — 그 사이 손잡이로 두께를 바꿨으면 사용자가 정한 것이다.
    return Math.abs(now - rec.after) <= 1 ? { kind: 'revert', size: rec.before } : { kind: 'keep' };
  }
  const chained = relying.find((h) => h.growth !== null && Math.abs(h.growth.before - rec.after) <= 1);
  if (chained?.growth) {
    return { kind: 'hand', key: chained.key, growth: { before: rec.before, after: chained.growth.after, seq: rec.seq } };
  }
  const bare = relying.find((h) => h.growth === null);
  if (bare) return { kind: 'hand', key: bare.key, growth: { before: rec.before, after: rec.after, seq: rec.seq } };
  // 기댄 창이 저마다 이어지지 않는 기록을 쥐고 있다(그 사이 두께가 손으로 바뀌었다) — 이을 곳이 없으니 두께는 그대로 둔다.
  return { kind: 'keep' };
}
