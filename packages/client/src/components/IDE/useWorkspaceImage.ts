import { useEffect, useRef, useState } from 'react';

/**
 * useWorkspaceImage.ts — §5.5 #17-27 ⑭ 워크스페이스 이미지 한 장을 **이 document 의 blob URL** 로.
 *
 * `<img src="/api/workspace-image?…">` 를 곧장 걸지 않는 이유는 패키징된 앱 때문이다 — 렌더러의
 * `fetch` 는 IPC 로 우회되지만 `<img>` 가 스스로 내는 요청은 그 패치를 타지 않아 같은 경로가
 * 조용히 실패한다. 첨부 썸네일(`attachmentThumb.ts`)이 이미 같은 이유로 blob 을 만들고 있으므로
 * **그 규약을 그대로 쓴다**(새 전송 계층 발명 ❌).
 *
 * `token` 은 디스크 수정 시각이다 — 주석을 저장해 파일이 바뀌면 이 값이 달라지고, 그때 다시 받는다.
 */

const API_BASE = '';

export type WorkspaceImageStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface WorkspaceImageResult {
  /** 이 document 에서 쓸 수 있는 blob URL. 아직 못 받았으면 null. */
  url: string | null;
  status: WorkspaceImageStatus;
}

export function useWorkspaceImage(
  root: string | null,
  relPath: string | null,
  token: number,
): WorkspaceImageResult {
  const [state, setState] = useState<WorkspaceImageResult>({ url: null, status: 'idle' });
  const createdRef = useRef<string[]>([]);

  useEffect(() => {
    if (!root || !relPath) {
      setState({ url: null, status: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ url: null, status: 'loading' });
    const url =
      `${API_BASE}/api/workspace-image?root=${encodeURIComponent(root)}&path=${encodeURIComponent(relPath)}`;
    void (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        const obj = URL.createObjectURL(blob);
        createdRef.current.push(obj);
        setState({ url: obj, status: 'ready' });
      } catch {
        if (!cancelled) setState({ url: null, status: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
    // token 은 URL 에 실리지 않지만, 저장으로 파일이 바뀌면 이 훅이 다시 받아야 한다.
  }, [root, relPath, token]);

  // 만든 blob 은 언마운트 때 한 번에 되돌린다 — 그리는 중인 URL 을 먼저 놓으면 그림이 깨진다.
  useEffect(
    () => () => {
      createdRef.current.forEach((u) => URL.revokeObjectURL(u));
    },
    [],
  );

  return state;
}
