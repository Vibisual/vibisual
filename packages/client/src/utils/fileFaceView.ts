/**
 * §5.1 #2-1 (A) — 파일 버블의 **얼굴**을 화면 쪽에서 정한다.
 *
 * 종류(영상·사진·소리·3D·코드…)는 shared `fileFaceKindOf` 한 곳이 정하고, 여기서는 그 위에 화면만 아는 두 가지를 얹는다:
 *  - **어느 앱이 굽고 여는가** — 그 확장자를 받겠다고 선언한 앱(`thumbnailAppFor` — 레지스트리, 코어는 앱 이름을 모른다).
 *    색도 그 앱의 것이라 앱 노드와 파일 버블이 한 가족으로 읽힌다. 선언한 앱이 없으면 종류 기본색(`FILE_FACE_STYLES`).
 *  - **미리보기를 구울 자리** — 열린 프로젝트 루트 안이면 가장 긴 루트에서 자른 상대 경로(`projectRelativePath` — 플랫폼
 *    규칙, 멀티플랫폼 1축). 루트 밖이면 **지금 탭의 프로젝트 + 절대경로**다(2026-10-21 — 미디어 창구는 루트 밖이라도 그 파일이
 *    지금 버블로 떠 있으면 읽기를 연다. 화면에 없는 임의 경로는 여전히 막힌다).
 */
import type { BubbleData, FileFaceFamily, FileFaceKind } from '@vibisual/shared';
import {
  FILE_FACE_STYLES, fileFaceFamilyOf, fileFaceKindOf, isMediaFaceKind, normalizePathShape, projectRelativePath, resolveWorkspaceOpen,
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

/** 미디어 얼굴을 더블클릭했을 때 여는 곳 — 그 앱 · 변환해서 우리 앱 · OS 연결 프로그램. */
export type FileFaceOpenRoute = 'app' | 'convert' | 'external';

/**
 * §5.1 #2-1 (A) — 미디어 얼굴은 **보여 주는 자리**라 더블클릭은 그 파일을 연다(폴더·묶음 안으로 들어가지 않는다 — 2026-10-22).
 * 우리 앱 안에서 여는 것이 먼저다: 받는 앱이 있으면 그 앱(`fileFaceOpensInApp`), 우리 엔진이 그대로 못 읽는 영상·소리는
 * 변환해서 우리 앱으로(§5.13 (R-8) — IDE 탐색기와 같은 갈림길 `resolveWorkspaceOpen`). 변환물은 그 프로젝트에 놓이므로
 * 프로젝트 안 파일만 변환한다. 그 밖(우리 앱이 그리지 않는 원본 · 프로젝트 밖 영상·소리·3D)은 OS 연결 프로그램이다 —
 * 편집창 갈래는 IDE 창이 떠 있어야 열려 캔버스에서는 아무 일도 일어나지 않는다. 미디어 얼굴에만 부른다.
 */
export function fileFaceOpenRoute(face: FileFace | null, target: FileMediaTarget | null): FileFaceOpenRoute {
  if (fileFaceOpensInApp(face, target)) return 'app';
  if (target === null || target.outside === true) return 'external';
  const plan = resolveWorkspaceOpen({ relPath: target.rel, kind: 'file', apps: workspaceOpenClaims() });
  return plan.action === 'convert' ? 'convert' : 'external';
}

/** 미리보기 판본 — 수정 시각(없으면 크기). 같은 이름으로 다시 만들면 다시 굽는다. */
export function fileFaceVersion(b: Pick<BubbleData, 'fileMtime' | 'fileSize'>): number {
  return b.fileMtime ?? b.fileSize ?? 0;
}
