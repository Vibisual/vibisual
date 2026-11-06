import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageLightboxState } from '../../stores/graphStore.js';
import { isAbsoluteMediaPath } from '../../utils/workspaceMedia.js';
import { readWorkspaceImage } from '../IDE/useWorkspaceImage.js';
import { bakeMimeFor, canOverwriteWorkspaceImage } from '../IDE/workspaceImageSave.js';

export type ViewerQuickEdit =
  | { readonly kind: 'closed' }
  | { readonly kind: 'opening' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'open'; readonly state: ImageLightboxState };

const ORIGIN = { slot: 'vibimage', cell: null } as const;

/**
 * §5.13 (R-10) — 보기 화면의 [편집] = 빠른 편집(§5.5 #17-25). 여는 순간 바이트와 저장 기준(수정 시각·판)을 함께 받아 [파일에 저장]이
 * 그 사이 바뀐 파일을 덮지 않게 한다. 프로젝트 밖 그림은 쓰기 창구가 루트 안만 받으므로 저장 갈래 없이 연다(복사·내려받기만).
 */
export function useViewerQuickEdit(root: string, file: string): { quick: ViewerQuickEdit; open: () => void; close: () => void } {
  const [quick, setQuick] = useState<ViewerQuickEdit>({ kind: 'closed' });
  const urlRef = useRef('');
  const ctrlRef = useRef<AbortController | null>(null);

  const release = useCallback((): void => {
    ctrlRef.current?.abort();
    ctrlRef.current = null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = '';
  }, []);
  const close = useCallback((): void => {
    release();
    setQuick({ kind: 'closed' });
  }, [release]);
  // 다른 그림이 오거나 창이 닫히면 받던 것·만든 주소를 놓는다.
  useEffect(() => close, [root, file, close]);

  const open = useCallback((): void => {
    if (!root || !file) return;
    release();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setQuick({ kind: 'opening' });
    void (async () => {
      try {
        const read = await readWorkspaceImage(root, file, ctrl.signal);
        if (ctrl.signal.aborted) return;
        const url = URL.createObjectURL(read.blob);
        urlRef.current = url;
        const workspace = isAbsoluteMediaPath(file) ? null : {
          root, path: file, mtimeMs: read.mtimeMs ?? 0, revision: read.revision,
          bakeable: canOverwriteWorkspaceImage(file), mime: bakeMimeFor(file),
        };
        setQuick({ kind: 'open', state: { url, origin: ORIGIN, ...(workspace ? { workspace } : {}) } });
      } catch {
        if (!ctrl.signal.aborted) setQuick({ kind: 'failed' });
      }
    })();
  }, [root, file, release]);

  return { quick, open, close };
}
