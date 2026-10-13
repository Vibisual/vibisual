import { useCallback, useRef, useState } from 'react';
import type { VideoDoc } from '@vibisual/video';

import { collectCues, readDoc } from './videoApi.js';

/**
 * §5.13 (T-8) — 정밀 편집 표지 줄의 [다시 모으기]. 평소에는 판본을 물을 때 서버가 저절로 모으고, 이것은 사람이 지금 다시 모으라고
 * 할 때다(같은 길 — `POST /doc/:id/cues`). 끝나면 문서를 다시 읽어 표지 줄이 곧바로 바뀐다.
 */
export function useCueRecollect(
  project: string,
  doc: VideoDoc | null,
  onDoc: (doc: VideoDoc) => void,
  onError: (err: unknown) => void,
): { readonly onRecollect: () => void; readonly busy: boolean } {
  const [busy, setBusy] = useState(false);
  const cb = useRef({ onDoc, onError });
  cb.current = { onDoc, onError };
  const docId = doc?.id ?? '';
  const onRecollect = useCallback((): void => {
    if (!project || docId === '' || busy) return;
    setBusy(true);
    void (async () => {
      try {
        const results = await collectCues(project, docId, { all: true });
        const failed = results.find((r) => !r.ok);
        if (failed) cb.current.onError(new Error(failed.error ?? failed.assetId));
        const env = await readDoc(project, docId);
        cb.current.onDoc(env.doc);
      } catch (err) {
        cb.current.onError(err);
      } finally {
        setBusy(false);
      }
    })();
  }, [project, docId, busy]);
  return { onRecollect, busy };
}
