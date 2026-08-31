// §5.5 #17-19 ⑧ — 탐색기 행을 **끌어다 어디에 놓았는가**. 짐표 규약과 판정만 모은 순수 모듈.
//
// `dragover` 중에는 짐의 **값**을 읽을 수 없고 종류(type)만 보인다 — #17-34 분할 드롭이 같은 벽에
// 부딪혀 세운 규약을 그대로 따른다. "우리 짐인가"·"폴더인가"는 전용 MIME 으로 알아보고, 자세한
// 것(어느 경로인가)은 손을 뗄 때 읽는다.
//
// 다만 **끌고 있는 동안** 하이라이트를 정확히 그리려면 경로가 필요하다(자기 자신·자기 하위·이미
// 사는 폴더 위에서는 파란 테두리를 띄우면 안 된다 — 눌러도 안 되는 표시는 고장으로 읽힌다).
// 그래서 지금 이 렌더러가 끌고 있는 짐 한 벌을 아래 등록소에 얹어 둔다. 드래그는 한 번에 하나뿐이고
// `dragend` 에 걷힌다. 별창처럼 등록소가 비어 있는 경우에도 **막지 않는다** — 손을 뗄 때 값이 오고,
// 그때 같은 판정이 한 번 더 서므로 잘못된 이동은 거기서 걸린다(서버가 마지막 관문).

import { foldPathCase } from '../../utils/platform.js';
import { edgeBandPx, type SplitRect } from './splitDrop.js';

/** 우리 탐색기에서 나온 짐인가(`dragover` 에서 쓸 수 있는 유일한 단서). */
export const WORKSPACE_DRAG_MIME = 'application/x-vibisual-workspace-entry';
/** 끌고 있는 것이 **폴더**일 때만 함께 실린다 — 편집창은 폴더를 열 수 없어 미리 갈라야 한다. */
export const WORKSPACE_DRAG_DIR_MIME = 'application/x-vibisual-workspace-entry-dir';

/** 짐표의 값 — 손을 뗄 때 읽는다. */
export interface WorkspaceDragPayload {
  /** 그 트리의 뿌리(절대 경로). **다른 프로젝트로 옮기는 것을 막는 기준**이다. */
  root: string;
  /** 루트 기준 상대 경로 */
  relPath: string;
  name: string;
  isDirectory: boolean;
  /** 입력창·클립보드에 그대로 쓰는 절대 경로(#17-19 ③-1 과 같은 값) */
  absPath: string;
}

export function encodeWorkspaceDrag(payload: WorkspaceDragPayload): string {
  return JSON.stringify(payload);
}

/** 짐표 해독. 모양이 조금이라도 어긋나면 `null`(= 우리 짐이 아니다 — 남의 드래그를 넘겨짚지 않는다). */
export function decodeWorkspaceDrag(raw: string | null | undefined): WorkspaceDragPayload | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    if (typeof p.root !== 'string' || p.root.length === 0) return null;
    if (typeof p.relPath !== 'string' || p.relPath.length === 0) return null;
    if (typeof p.name !== 'string' || typeof p.absPath !== 'string') return null;
    if (typeof p.isDirectory !== 'boolean') return null;
    return { root: p.root, relPath: p.relPath, name: p.name, isDirectory: p.isDirectory, absPath: p.absPath };
  } catch {
    return null;
  }
}

export function dragHasWorkspaceEntry(types: readonly string[]): boolean {
  return types.includes(WORKSPACE_DRAG_MIME);
}

/** 끌고 오는 것이 폴더인가 — 값을 못 읽는 `dragover` 에서도 보이는 종류로 알아본다. */
export function dragIsDirectory(types: readonly string[]): boolean {
  return types.includes(WORKSPACE_DRAG_DIR_MIME);
}

// ─── 놓는 자리 — 가운데(글자) vs 우측(열기) ───────────────────────────────────────

/** 대화 위면 **경로 글자**가 입력창에 들어가고, 오른쪽이면 그 파일이 **편집창에서 열린다**. */
export type WorkspaceDropZone = 'input' | 'editor';

/**
 * 커서가 IDE 본문의 어디에 있는가.
 *
 * @param rect       본문(대화 + 편집창) 영역. 활동바·사이드바는 여기에 들어오지 않는다.
 * @param editorLeft 편집창이 이미 열려 있으면 그 왼쪽 변(뷰포트 x). 닫혀 있으면 `null`.
 *
 * 편집창이 열려 있으면 **그 패널 자체가 곧 오른쪽 자리**다(눈에 보이는 경계와 판정이 어긋나면
 * 사용자는 늘 틀린 쪽에 놓는다). 닫혀 있으면 오른쪽 끝의 띠를 그 자리로 쓰고, 띠 두께는 분할
 * 드롭과 **같은 표**(`edgeBandPx`)를 읽는다 — 한 화면에 두 종류의 "가장자리"가 있으면 안 된다.
 */
export function resolveWorkspaceDropZone(rect: SplitRect, x: number, editorLeft: number | null): WorkspaceDropZone {
  if (editorLeft !== null) return x >= editorLeft ? 'editor' : 'input';
  const band = edgeBandPx(rect.width);
  return x >= rect.left + rect.width - band ? 'editor' : 'input';
}

/** 미리보기 띠 — 본문 영역 안에서의 가로 위치·폭(px). 판정과 **같은 값**에서 나온다. */
export interface WorkspaceDropBox {
  leftPx: number;
  widthPx: number;
}

export function workspaceDropBox(rect: SplitRect, zone: WorkspaceDropZone, editorLeft: number | null): WorkspaceDropBox {
  const boundary = editorLeft !== null
    ? Math.min(Math.max(editorLeft - rect.left, 0), rect.width)
    : Math.max(rect.width - edgeBandPx(rect.width), 0);
  return zone === 'editor'
    ? { leftPx: boundary, widthPx: Math.max(rect.width - boundary, 0) }
    : { leftPx: 0, widthPx: boundary };
}

/** 미리보기를 **비율로** 옮긴다 — 캔버스가 확대돼 있으면 px 는 스케일에 따라 달라지지만 비율은 같다. */
export interface WorkspaceDropBoxPct {
  leftPct: number;
  widthPct: number;
}

/**
 * 본문 안 px 박스를 **바깥 상자(위치 기준 조상) 기준 비율**로 바꾼다.
 *
 * IDE 창은 DOM 상 캔버스의 자식이라(§5.5 #17-6) 조상에 CSS 변형이 걸린다. `getBoundingClientRect`
 * 는 그 변형이 반영된 값을 주므로, 두 사각형을 **같은 공간에서** 재서 비율로 나누면 확대·축소와
 * 무관하게 맞는다(px 를 그대로 쓰면 확대한 창에서 띠가 어긋난다).
 */
export function dropBoxToPercent(box: WorkspaceDropBox, content: SplitRect, outer: SplitRect): WorkspaceDropBoxPct {
  if (outer.width <= 0) return { leftPct: 0, widthPct: 0 };
  const offset = content.left - outer.left;
  return {
    leftPct: ((offset + box.leftPx) / outer.width) * 100,
    widthPct: (box.widthPx / outer.width) * 100,
  };
}

// ─── 폴더 위에 놓기 = 옮기기 ─────────────────────────────────────────────────────

/**
 * 그 폴더로는 옮길 수 없는 이유. `null` 이면 옮길 수 있다.
 *
 * 넷 다 손으로 끌다 자연스럽게 만드는 상황이라, 되물음을 띄우기 **전에** 걸러 낸다 —
 * "옮길까요?"를 눌렀는데 아무 일도 일어나지 않는 것이 가장 나쁜 결과다.
 */
export type WorkspaceMoveBlock =
  /** 다른 프로젝트(다른 루트)의 트리다 */
  | 'other-root'
  /** 자기 자신 위에 놓았다 */
  | 'self'
  /** 폴더를 자기 하위로 옮기려 했다 — 트리가 스스로를 삼킨다 */
  | 'into-self'
  /** 이미 그 폴더에 산다 — 옮길 것이 없다 */
  | 'same-parent'
  | null;

/** 부모 폴더 상대 경로('' = 루트). */
export function parentRelOf(rel: string): string {
  const idx = rel.lastIndexOf('/');
  return idx < 0 ? '' : rel.slice(0, idx);
}

/**
 * @param fold 경로 케이스 접기 — 기본은 이 기기의 규칙(`foldPathCase`)이고, **테스트가 세 OS 를
 *             전부 넣어 볼 수 있도록** 인자로 받는다(win/mac 은 접고 linux 는 안 접는다).
 */
export function workspaceMoveBlock(
  drag: WorkspaceDragPayload,
  targetRoot: string,
  targetDirRel: string,
  fold: (p: string) => string = foldPathCase,
): WorkspaceMoveBlock {
  const sameRoot = fold(drag.root.replace(/\\/g, '/').replace(/\/+$/, ''))
    === fold(targetRoot.replace(/\\/g, '/').replace(/\/+$/, ''));
  if (!sameRoot) return 'other-root';

  const source = fold(drag.relPath);
  const target = fold(targetDirRel);
  if (source === target) return 'self';
  if (drag.isDirectory && target.startsWith(`${source}/`)) return 'into-self';
  if (fold(parentRelOf(drag.relPath)) === target) return 'same-parent';
  return null;
}

/** 옮기고 나면 앉을 자리(루트 기준 상대 경로). 되물음 문구가 이 값을 보여 준다. */
export function movedRelPath(drag: WorkspaceDragPayload, targetDirRel: string): string {
  return targetDirRel ? `${targetDirRel}/${drag.name}` : drag.name;
}

// ─── 지금 끌고 있는 짐 등록소 ────────────────────────────────────────────────────
//
// 모듈 자리에 두는 상태는 §3.5 가 경계하는 "프로젝트 상태의 전역 공유"가 아니다 — 이 렌더러에서
// **지금 이 순간** 손에 들려 있는 것 하나이고, 드래그가 끝나면 반드시 걷힌다. 여러 IDE 창이 한
// 렌더러에 떠 있어도 사용자의 손은 하나라 오히려 이 자리가 옳다.

let activeDrag: WorkspaceDragPayload | null = null;

export function setActiveWorkspaceDrag(payload: WorkspaceDragPayload): void {
  activeDrag = payload;
}

export function clearActiveWorkspaceDrag(): void {
  activeDrag = null;
}

/** 하이라이트 판정용. 없으면 `null` — 그때는 막지 말고 손을 뗄 때 판정한다. */
export function readActiveWorkspaceDrag(): WorkspaceDragPayload | null {
  return activeDrag;
}
