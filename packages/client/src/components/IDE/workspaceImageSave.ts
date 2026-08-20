import { isWorkspaceImageBakeable, workspaceImageMime } from '@vibisual/shared';
import type { WorkspaceFileSaveResult } from '@vibisual/shared';

/**
 * workspaceImageSave.ts — §5.5 #17-25 ④-1 주석본으로 **그 이미지 파일을 덮어쓴다**.
 *
 * 라이트박스(`ImageAnnotator`)가 이미 700줄이라 서버 대화만 떼어 둔다. 굽는 형식은 원본 확장자를
 * 따르고(png·jpeg·webp), 굽지 못하는 확장자는 애초에 `canOverwrite` 가 false 라 버튼이 흐려진다 —
 * 조용히 PNG 로 바꿔 확장자와 내용이 어긋난 파일을 만들지 않기 위함이다.
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
): Promise<WorkspaceImageSaveOutcome> {
  const url =
    `${API_BASE}/api/workspace-image?root=${encodeURIComponent(root)}` +
    `&path=${encodeURIComponent(relPath)}&baseMtimeMs=${encodeURIComponent(String(baseMtimeMs))}`;
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
