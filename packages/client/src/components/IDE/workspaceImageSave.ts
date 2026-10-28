import { isWorkspaceImageBakeable, workspaceImageMime } from '@vibisual/shared';
import type { WorkspaceFileSaveResult } from '@vibisual/shared';

import { workspaceMediaQuery } from '../../utils/workspaceMedia.js';

/**
 * §5.5 #17-25 ④-1 — 주석본으로 그 이미지 파일을 덮어쓴다. 굽는 형식은 원본 확장자(png·jpeg·webp)를 따른다.
 * 못 굽는 확장자는 `canOverwrite` 가 false 다 — PNG 로 구우면 확장자와 내용이 어긋난다.
 */

const API_BASE = '';

export type WorkspaceImageSaveOutcome =
  | { ok: true; result: WorkspaceFileSaveResult }
  | { ok: false; status: number };

/** 이 경로를 **원본 형식 그대로** 구워 덮어쓸 수 있는가. */
export function canOverwriteWorkspaceImage(relPath: string): boolean {
  return isWorkspaceImageBakeable(relPath);
}

/** 굽기에 쓸 MIME — `canvas.toBlob` 의 두 번째 인자. */
export function bakeMimeFor(relPath: string): string {
  return workspaceImageMime(relPath);
}

/**
 * 구운 바이트를 그 파일에 쓴다. `baseMtimeMs` 가 디스크와 다르면 서버가 409 로 막고,
 * 사용자가 [그래도 저장]을 고르면 `0` 으로 다시 부른다(텍스트 저장과 같은 규율).
 */
export async function putWorkspaceImage(
  root: string,
  relPath: string,
  blob: Blob,
  baseMtimeMs: number,
  baseRevision?: string,
): Promise<WorkspaceImageSaveOutcome> {
  // §5.5 #17-27 ⑥ — 절대경로 탭(캔버스에서 연 이 창의 루트 밖 파일)은 그 파일의 폴더 + 이름으로 푼다(읽기와 같은 도우미).
  const query = workspaceMediaQuery(root, relPath);
  const url =
    `${API_BASE}/api/workspace-image?root=${encodeURIComponent(query.root)}` +
    `&path=${encodeURIComponent(query.path)}&baseMtimeMs=${encodeURIComponent(String(baseMtimeMs))}` +
    (baseMtimeMs !== 0 && baseRevision ? `&baseRevision=${encodeURIComponent(baseRevision)}` : '');
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, result: (await res.json()) as WorkspaceFileSaveResult };
  } catch {
    return { ok: false, status: 0 };
  }
}
