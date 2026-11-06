import { useEffect, useMemo, useRef, useState } from 'react';

import { workspaceMediaQuery } from '../../utils/workspaceMedia.js';

/**
 * §5.5 #17-27 ⑭ 워크스페이스 이미지 → 이 document 의 blob URL(`attachmentThumb.ts` 와 같은 규약). `<img src="/api/…">` 를 곧장 걸지 않는다 —
 * 패키징 앱에서 `<img>` 요청은 IPC 패치를 안 타 조용히 실패한다. `token` 은 디스크 수정 시각 — 바뀌면 다시 받는다.
 */

const API_BASE = '';

export type WorkspaceImageStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface WorkspaceImageResult {
  /** 이 document 에서 쓸 수 있는 blob URL. 아직 못 받았으면 null. */
  url: string | null;
  status: WorkspaceImageStatus;
  /** 표시하는 바이트와 함께 받은 저장 기준. */
  revision?: string;
  mtimeMs?: number;
}

/** 그 그림의 바이트와 저장 기준(수정 시각·판)을 한 번에 — 덮어쓰기(#17-25 ④-1)는 이 둘을 되돌려 보내 그 사이 변경을 가른다. */
export async function readWorkspaceImage(
  root: string,
  relPath: string,
  signal?: AbortSignal,
): Promise<{ blob: Blob; revision?: string; mtimeMs?: number }> {
  // ⑥ — 이 창의 루트 밖 파일 탭은 열쇠가 절대경로다(캔버스 파일 버블에서 열었다). 그 파일의 폴더 + 이름으로 푼다(편집창 읽기와 같은 도우미).
  const query = workspaceMediaQuery(root, relPath);
  const url = `${API_BASE}/api/workspace-image?root=${encodeURIComponent(query.root)}&path=${encodeURIComponent(query.path)}`;
  const res = await fetch(url, signal ? { signal } : undefined);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const modified = res.headers.get('X-Workspace-Mtime');
  const mtimeMs = modified === null ? undefined : Number(modified);
  const revision = res.headers.get('X-Workspace-Revision') ?? undefined;
  return { blob, revision, mtimeMs: mtimeMs !== undefined && Number.isFinite(mtimeMs) ? mtimeMs : undefined };
}

export function useWorkspaceImage(
  root: string | null,
  relPath: string | null,
  token: number,
): WorkspaceImageResult {
  const scope = useMemo(() => ({}), [root, relPath, token]);
  const [state, setState] = useState<WorkspaceImageResult & { scope: object }>({ scope, url: null, status: 'idle' });
  const createdRef = useRef<string[]>([]);

  useEffect(() => {
    if (!root || !relPath) {
      setState({ scope, url: null, status: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ scope, url: null, status: 'loading' });
    void (async () => {
      try {
        const { blob, revision, mtimeMs } = await readWorkspaceImage(root, relPath);
        if (cancelled) return;
        const obj = URL.createObjectURL(blob);
        createdRef.current.push(obj);
        setState({ scope, url: obj, status: 'ready', revision, mtimeMs });
      } catch {
        if (!cancelled) setState({ scope, url: null, status: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
    // token 은 URL 에 실리지 않지만, 저장으로 파일이 바뀌면 이 훅이 다시 받아야 한다.
  }, [root, relPath, token, scope]);

  // 만든 blob 은 언마운트 때 한 번에 되돌린다 — 그리는 중인 URL 을 먼저 놓으면 그림이 깨진다.
  useEffect(
    () => () => {
      createdRef.current.forEach((u) => URL.revokeObjectURL(u));
    },
    [],
  );

  return state.scope === scope ? state : { url: null, status: root && relPath ? 'loading' : 'idle' };
}
