/**
 * §5.1 #2-1 (A) — 파일 버블의 **얼굴**을 화면 쪽에서 정한다.
 *
 * 종류(영상·사진·소리·3D·코드…)는 shared `fileFaceKindOf` 한 곳이 정하고, 여기서는 그 위에 화면만 아는 두 가지를 얹는다:
 *  - **어느 앱이 굽고 여는가** — 그 확장자를 받겠다고 선언한 앱(`thumbnailAppFor` — 레지스트리, 코어는 앱 이름을 모른다).
 *    색도 그 앱의 것이라 앱 노드와 파일 버블이 한 가족으로 읽힌다. 선언한 앱이 없으면 종류 기본색(`FILE_FACE_STYLES`).
 *  - **미리보기를 구울 자리** — 열린 프로젝트 루트 안이어야 한다(미디어 창구가 루트 밖을 막는다 — 보안 경계를 넓히지
 *    않는다). 상대 경로는 가장 긴 루트에서 자른다(`projectRelativePath` — 플랫폼 규칙, 멀티플랫폼 1축).
 */
import type { BubbleData, FileFaceFamily, FileFaceKind } from '@vibisual/shared';
import { FILE_FACE_STYLES, fileFaceFamilyOf, fileFaceKindOf, isMediaFaceKind, projectRelativePath } from '@vibisual/shared';

import { thumbnailAppFor } from '../apps/appLinkedItems.js';
import { getInternalApp } from '../apps/registry.js';
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
  readonly rel: string;
}

/**
 * 이 절대경로가 든 **가장 긴** 프로젝트 루트와 상대 경로. 어느 루트에도 없으면 `null` — 그 파일은 굽지 않는다
 * (워크트리는 부모 프로젝트 안에 있어도 자기 루트가 더 길어 그쪽이 이긴다).
 */
export function fileMediaTarget(absPath: string | undefined, roots: readonly string[]): FileMediaTarget | null {
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
  return best;
}

/** 미리보기 판본 — 수정 시각(없으면 크기). 같은 이름으로 다시 만들면 다시 굽는다. */
export function fileFaceVersion(b: Pick<BubbleData, 'fileMtime' | 'fileSize'>): number {
  return b.fileMtime ?? b.fileSize ?? 0;
}
