/**
 * §5.1 #2-1 (A) — 파일 버블의 얼굴을 화면 쪽에서 정한다. 종류는 shared `fileFaceKindOf` 가 정하고, 여기서는 화면만 아는 두 가지를 얹는다:
 *  - 어느 앱이 굽고 여는가 — 그 확장자를 선언한 앱(`thumbnailAppFor` — 레지스트리, 코어는 앱 이름을 모른다). 색도 그 앱의 것, 없으면 종류 기본색(`FILE_FACE_STYLES`).
 *  - 미리보기를 구울 자리 — 프로젝트 루트 안이면 가장 긴 루트에서 자른 상대 경로(`projectRelativePath` — 멀티플랫폼 1축), 밖이면 지금 탭의 프로젝트 + 절대경로.
 *    미디어 창구는 루트 밖이라도 지금 버블로 떠 있는 파일만 읽기를 연다(화면에 없는 임의 경로는 막힌다).
 */
import type { BubbleData, EditorPaneFileKind, FileFaceFamily, FileFaceKind } from '@vibisual/shared';
import {
  FILE_FACE_STYLES, editorPaneKindOf, fileFaceFamilyOf, fileFaceKindOf, isMediaFaceKind, normalizePathShape, projectRelativePath,
  resolveWorkspaceOpen,
} from '@vibisual/shared';

import { thumbnailAppFor } from '../apps/appLinkedItems.js';
import { getInternalApp, workspaceOpenClaims } from '../apps/registry.js';
import { clientPathKey, clientPathPlatform } from './platform.js';

export interface FileFace {
  readonly kind: FileFaceKind;
  /** §5.1 #2-1 (G) ⑤ — 갈래(미리보기가 없을 때의 아이콘). */
  readonly family: FileFaceFamily;
  /** 버블 안에 미리보기를 굽는 미디어(영상·사진·소리·3D)인가. */
  readonly media: boolean;
  /** 이 파일을 굽고 여는 앱 — 그 확장자를 받겠다고 선언한 앱. 미디어가 아니거나 선언한 앱이 없으면 `null`. */
  readonly appId: string | null;
  /** 본체 색 · 밝은 테 색. */
  readonly color: string;
  readonly glow: string;
}

type FaceSource = Pick<BubbleData, 'bubbleType' | 'path' | 'label'> & { readonly absolutePath?: string | undefined };

/** 판정에 쓰는 경로 — 절대경로가 있으면 그것(외부 파일의 노드 키에는 네임스페이스가 붙는다), 없으면 노드 키·이름. */
export function faceSourcePath(b: FaceSource): string {
  return b.absolutePath || b.path || b.label;
}

/** 파일 버블의 얼굴. 파일이 아니면 `null`(Ghost 는 원래 파일이었어도 잔상 그대로 그린다). */
export function fileFaceOf(b: FaceSource): FileFace | null {
  if (b.bubbleType !== 'file') return null;
  const src = faceSourcePath(b);
  const kind = fileFaceKindOf(src);
  const media = isMediaFaceKind(kind);
  const appId = media ? thumbnailAppFor(src) : null;
  const app = appId !== null ? getInternalApp(appId) : undefined;
  const base = FILE_FACE_STYLES[kind];
  return { kind, family: fileFaceFamilyOf(src), media, appId, color: app?.color ?? base.color, glow: app?.glow ?? base.glow };
}

/** 미리보기를 구울 자리 — 프로젝트 루트(= 앱이 받는 `projectId`)와 그 안의 상대 경로. */
export interface FileMediaTarget {
  readonly root: string;
  /** 루트 기준 상대 경로. `outside` 면 **절대경로**다(바이트 창구 도우미가 그 파일의 폴더 + 이름으로 풀어 보낸다). */
  readonly rel: string;
  /** 프로젝트 밖 파일 — `root` 는 그 파일의 루트가 아니라 **창의 주인**(지금 탭의 프로젝트)이다. */
  readonly outside?: true;
}

/**
 * 이 절대경로가 든 **가장 긴** 프로젝트 루트와 상대 경로(워크트리는 부모 프로젝트 안에 있어도 자기 루트가 더 길어 그쪽이
 * 이긴다). 어느 루트에도 없으면 `outsideOwner`(지금 탭의 프로젝트)를 주인으로 **절대경로**를 싣는다 — 주인이 없으면 `null`
 * (그 파일은 굽지도 열지도 않는다). 바깥 파일이 실제로 읽히는지는 서버가 정한다(지금 버블로 떠 있는 파일만 — §5.1 #2-1 (A)).
 */
export function fileMediaTarget(
  absPath: string | undefined,
  roots: readonly string[],
  outsideOwner?: string | null,
): FileMediaTarget | null {
  if (absPath === undefined || absPath === '') return null;
  const platform = clientPathPlatform();
  let best: FileMediaTarget | null = null;
  let bestLen = -1;
  for (const root of roots) {
    const rel = projectRelativePath(root, absPath, platform);
    if (rel === null) continue;
    const len = clientPathKey(root).length;
    if (len > bestLen) {
      best = { root, rel };
      bestLen = len;
    }
  }
  if (best !== null) return best;
  if (!outsideOwner) return null;
  return { root: outsideOwner, rel: normalizePathShape(absPath), outside: true };
}

/**
 * 지금 탭의 프로젝트 루트 — 프로젝트 밖 파일을 열 **창의 주인**. 앱 안 창은 주인 프로젝트의 탭에서만 보이므로
 * (`isAppWindowVisible`) 바깥 파일의 폴더를 주인으로 삼으면 창이 열려도 보이지 않는다. `activeProject` 는 표시 이름이다.
 */
export function activeProjectRoot(state: {
  readonly activeProject: string | null;
  readonly projects: Readonly<Record<string, { readonly path: string }>>;
  readonly stubProjects?: Readonly<Record<string, { readonly project: { readonly path: string } }>>;
}): string | null {
  const name = state.activeProject;
  if (!name) return null;
  return state.projects[name]?.path ?? state.stubProjects?.[name]?.project.path ?? null;
}

/**
 * §5.1 #2-1 (A) — 더블클릭이 이 파일을 **그 앱에서** 여는가. 툴팁의 "더블클릭하면 ○○에서 열립니다" 와 더블클릭이 이 한 판정을
 * 본다(안내만 뜨고 열리지 않는 일이 없게). 프로젝트 밖 파일은 그 파일을 **보기 전용으로** 여는 앱(`viewsOutsideFiles`)만 연다 —
 * `file` 을 받으면 그 파일로 프로젝트 문서를 짓는 앱에 바깥 경로를 넘기지 않는다.
 */
export function fileFaceOpensInApp(face: FileFace | null, target: FileMediaTarget | null): boolean {
  if (face === null || !face.media || face.appId === null || target === null) return false;
  return target.outside !== true || getInternalApp(face.appId)?.viewsOutsideFiles === true;
}

/** 파일 버블을 더블클릭했을 때 여는 곳. */
export type FileFaceOpenPlan =
  /** 그 확장자를 받는 앱의 앱 안 창(영상 · 소리 · 3D · 그림). */
  | { readonly route: 'app'; readonly appId: string }
  /** 우리 엔진이 그대로 못 읽는 영상·소리 — 변환해서 우리 앱으로(§5.13 (R-8)). */
  | { readonly route: 'convert' }
  /** 파일 창 — IDE [오른쪽에 표시] 판과 같은 판(코드 편집기 · 웹 페이지 · 그림 · PDF)을 IDE 밖에 따로 세운 창(§5.5 #17-27 ⑳). */
  | { readonly route: 'pane'; readonly pane: EditorPaneFileKind }
  /** 우리 앱이 그리지 않는 것(압축 · 글꼴 · 오피스 · 디자인 원본 …) — OS 연결 프로그램. */
  | { readonly route: 'external' };

/**
 * 이 파일이 파일 창의 **어느 판**으로 열리는가 — 더블클릭(`fileFaceOpenPlan`)과 툴팁이 같은 답을 본다. 판정은 IDE 판과 같은
 * 한 벌(`editorPaneKindOf` — 탐색기·[파일 열기] 목록이 쓰는 그것)이고, 하나만 더 거른다: 우리 앱이 그리지 않는 **미디어 원본**
 * (veg · y4m …)은 글자로 열면 이진 안내 한 줄뿐이라 판으로 보내지 않는다(연결 프로그램).
 */
export function fileFacePaneKind(face: FileFace | null, filePath: string): EditorPaneFileKind | null {
  const pane = editorPaneKindOf(filePath, workspaceOpenClaims());
  if (pane === 'code' && face !== null && face.media) return null;
  return pane;
}

/**
 * §5.1 #2-1 (A) — 파일 버블 더블클릭은 그 파일을 앱 안에서 연다. 위성·원 둘레·묶음 안 모두 같고, 그 파일의 폴더·묶음 안으로 들어가지 않는다.
 * 순서: 받는 앱(`fileFaceOpensInApp` — 프로젝트 밖은 보기 전용 앱만) → 그대로 못 읽는 영상·소리는 변환해서 우리 앱으로(§5.13 (R-8) — 프로젝트 안 파일만)
 * → 파일 창의 판(코드 · 웹 페이지 · 그림 · PDF — 프로젝트 밖 글 파일도 보기로) → 그 밖만 OS 연결 프로그램. 갈림은 IDE 탐색기와 같은 `resolveWorkspaceOpen` 위에 선다.
 * `target` 이 없으면(지금 탭의 프로젝트를 모른다) 창의 주인이 없어 연결 프로그램이다.
 */
export function fileFaceOpenPlan(face: FileFace | null, target: FileMediaTarget | null, filePath: string): FileFaceOpenPlan {
  if (face !== null && face.appId !== null && fileFaceOpensInApp(face, target)) return { route: 'app', appId: face.appId };
  if (target === null) return { route: 'external' };
  const inside = target.outside !== true;
  const relPath = inside ? target.rel : filePath;
  if (resolveWorkspaceOpen({ relPath, kind: 'file', apps: workspaceOpenClaims() }).action === 'convert') {
    return inside ? { route: 'convert' } : { route: 'external' };
  }
  const pane = fileFacePaneKind(face, relPath);
  return pane !== null ? { route: 'pane', pane } : { route: 'external' };
}

/** 미리보기 판본 — 수정 시각(없으면 크기). 같은 이름으로 다시 만들면 다시 굽는다. */
export function fileFaceVersion(b: Pick<BubbleData, 'fileMtime' | 'fileSize'>): number {
  return b.fileMtime ?? b.fileSize ?? 0;
}
