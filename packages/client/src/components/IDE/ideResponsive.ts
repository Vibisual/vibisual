import { IDE_EDITOR_WIDTH } from '@vibisual/shared';
import type { IDEViewType } from '../../stores/graphStore.js';

/**
 * IDE 창 **안쪽** 레이아웃의 반응형 판정 — 기준은 앱 뷰포트가 아니라 **그 창 자신의 폭**이다.
 *
 * 왜 필요한가: 종전에는 창 안 반응형이 전부 `max-md`(뷰포트 max-width:767px)와 `useIsNarrowViewport`
 * 하나에 매여 있었다. 그런데 IDE 창은 화면이 아니라 **앱 안의 창**이라 뷰포트가 1920px 이어도
 * 창 자신은 480px 일 수 있다(도킹 두께 조절·떠 있는 창 리사이즈). 그 조합에서는 `narrow=false` 라
 * 활동바(48) · 사이드바(208/288) · 편집창(저장된 px, 기본 520)이 전부 `flex-shrink-0` 으로 자리를
 * 먼저 가져가고, **대화만** `flex-1 min-w-0` 이라 0 까지 찌부러졌다 — 글자가 한 칸에 한 자씩
 * 세로로 서고, 그 안의 하단 상태바는 `justify-end` 라 넘친 만큼 **왼쪽으로 흘러** 사이드바 위를
 * 덮었다(사용자 스크린샷). 즉 "반응형이 없다"가 아니라 **엉뚱한 것의 폭을 보고 있었다**.
 *
 * 그래서 판정을 여기 한 곳에 모으고 창 폭을 인자로 받는다 — 컴포넌트 안에서 `window.innerWidth`
 * 를 읽으면 그 분기는 영영 단위 테스트로 확인할 수 없다(멀티플랫폼 규칙과 같은 결).
 *
 * 접는 순서는 **덜 잃는 것부터**다. 정보를 지우지 않고 자리만 옮긴다 — 접힌 것은 전부 되부를
 * 손잡이가 남는다(편집창 탭 줄·활동바 아이콘·타이틀바 내비 토글).
 */

/** 창 안 가로 배치의 고정 치수 — Tailwind 클래스와 짝이 맞아야 한다(한쪽만 고치면 판정이 어긋난다). */
export const IDE_BODY = {
  /** `IDEActivityBar` 의 `w-12`. */
  ACTIVITY_W: 48,
  /** `IDESidebar` 의 기본 `w-52`. */
  SIDEBAR_W: 208,
  /** `IDESidebar` 가 주입원 뷰에서 쓰는 `w-72`(§5.5 #17-28). */
  SIDEBAR_CONTEXT_W: 288,
  /**
   * 대화가 **글자를 담을 수 있는** 최소 폭(px). 이보다 좁으면 한 줄에 한두 글자만 들어가
   * 본문이 세로로 서고, 그 안의 상태바 손잡이가 밖으로 넘친다. 분할 칸 하한
   * (`IDE_SPLIT.minCellWidthPx` = 280)보다 조금 넉넉하게 잡는다 — 저쪽은 "나눠도 되는가"의
   * 하한이고, 이쪽은 "이 창이 대화에 보장하는" 폭이다.
   */
  MIN_STREAM_W: 320,
  /**
   * 타이틀바 손잡이를 접기 시작하는 창 폭(px). 이 줄에는 손잡이가 아홉 개까지 서는데 오른쪽
   * 묶음은 줄지 않으므로(`flex-shrink-0` — 줄어들면 [닫기]가 사라진다), 좁은 창에서는 무엇을
   * 접을지 `titleBarChrome` 이 정해야 한다. 떠 있는 창 하한(`IDE_FLOAT.MIN_W` = 480)보다
   * 조금 위로 잡아, 최소 크기 창이 확실히 접힌 쪽에 들어오게 한다.
   */
  TITLE_FOLD_W: 520,
} as const;

/** 사이드바가 이 뷰에서 먹는 폭(px) — `IDESidebar` 의 `w-52`/`w-72` 분기와 같은 값. */
export function ideSidebarWidth(activeView: IDEViewType): number {
  return activeView === 'context' ? IDE_BODY.SIDEBAR_CONTEXT_W : IDE_BODY.SIDEBAR_W;
}

export interface IDEBodyInput {
  /** 창 본문 행의 실제 폭(px). `0` 이하면 아직 못 쟀다(첫 프레임) → 뷰포트 기준으로 폴백. */
  width: number;
  /**
   * 폰 폭(`useIsNarrowViewport`, max-width:767px). 이 축은 **그대로 남는다** — 터치 기기에서는
   * 창 폭이 넉넉해도 손가락 표적·세로 공간 때문에 서랍 배치가 맞다(§4 v3.24).
   */
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
  /**
   * 타이틀바가 한 줄에 손잡이를 다 못 세우는 폭인가 — `resolveTitleBarChrome` 의 `narrow` 로 간다.
   * 종전에는 그 자리에 뷰포트 판정이 들어가, 넓은 화면에서 창만 좁히면 아무것도 안 접혀
   * **[닫기]가 창 밖으로 밀려났다**(그 함수의 주석이 폰에서 겪었다고 적어 둔 바로 그 증상).
   */
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

/**
 * 끄는 동안의 편집창 폭. **처음부터의 이동량**으로 계산한다 — 프레임마다 증분을 더하면
 * 하한/상한에 부딪힌 뒤 손을 되돌려도 그만큼 늦게 반응하는(끈적이는) 손맛이 된다.
 * 편집창은 오른쪽에 붙어 있으므로 커서를 **왼쪽으로** 끌수록 넓어진다.
 */
export function dragEditorWidth(drag: EditorResizeDrag, clientX: number): number {
  const raw = drag.startWidth + (drag.startX - clientX);
  return Math.round(Math.min(drag.max, Math.max(IDE_EDITOR_WIDTH.MIN, raw)));
}

/** 저장된 편집창 폭을 전역 하한/상한 안으로. 스토어의 `clampIdeEditorWidth` 와 같은 규칙. */
function clampEditor(w: number): number {
  if (!Number.isFinite(w)) return IDE_EDITOR_WIDTH.DEFAULT;
  return Math.min(IDE_EDITOR_WIDTH.MAX, Math.max(IDE_EDITOR_WIDTH.MIN, Math.round(w)));
}

/**
 * 창 폭 하나로 **무엇을 접을지**를 정한다(렌더 부작용 ❌ — 값만 돌려준다).
 *
 * 접는 차례:
 *  1. **편집창을 줄인다** — 사용자가 저장해 둔 폭보다 좁혀 대화에 자리를 낸다(하한 280px).
 *  2. **사이드바를 서랍으로** — 208~288px 을 통째로 비운다. 활동바가 남으므로 아이콘 한 번이면 돌아온다.
 *  3. **편집창을 대화 위로** — 폰에서 이미 하던 그 거동(탭 줄과 [닫기]가 그대로라 되돌아갈 길이 있다).
 *  4. **활동바까지 서랍으로** — 48px 마저 못 낼 만큼 좁은 창(도킹 하한 260px 부근).
 */
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
