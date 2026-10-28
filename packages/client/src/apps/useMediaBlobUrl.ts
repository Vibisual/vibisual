import { useEffect, useState } from 'react';

import { fetchWorkspaceMediaBlob, workspaceMediaSize } from '../utils/workspaceMedia.js';

/**
 * §5.4 #36 (G) — 재생할 파일을 blob URL 로 받는 훅 — 엘리먼트 `src` 의 `/api/…` 요청은 패키지 앱(file://)에서 IPC 를 안 타 빈다(§5.13 (R-5)).
 * 통째로 받으므로 먼저 크기를 묻고(`playMaxBytes` 같은 상한), 처음 재생을 누른 뒤에만 받는다.
 * URL 은 이 훅 소유(입력이 바뀌거나 꺼지거나 언마운트되면 revoke) · 늦게 끝난 받기는 버린다.
 */
export type MediaBlobState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly url: string }
  /** 상한을 넘는다 — 에디터에서 열라고 안내한다. */
  | { readonly status: 'tooLarge' }
  /** 크기를 모르거나 받지 못했다. */
  | { readonly status: 'failed' };

export interface MediaBlobRequest {
  /** 프로젝트 루트 절대 경로. */
  readonly projectId: string;
  /** 루트 기준 상대 경로. */
  readonly file: string;
  /** 결과 버전 — 바뀌면 다시 받는다(같은 이름으로 다시 온 결과). */
  readonly version: number;
  /** 받을지. `false` 면 아무것도 하지 않고, 받아 둔 것도 되돌린다. */
  readonly enabled: boolean;
  /** 통째로 받는 크기 상한(bytes). */
  readonly maxBytes: number;
}

const IDLE: MediaBlobState = { status: 'idle' };
const LOADING: MediaBlobState = { status: 'loading' };
const TOO_LARGE: MediaBlobState = { status: 'tooLarge' };
const FAILED: MediaBlobState = { status: 'failed' };

/** 크기 판정 한 벌 — 크기를 모르면 받지 않는다(통째로 받기 전에 묻는 이유가 그것이다). */
export function mediaBlobVerdict(size: number | null, maxBytes: number): 'fetch' | 'tooLarge' | 'failed' {
  if (size === null || !Number.isFinite(size) || size <= 0) return 'failed';
  return size > maxBytes ? 'tooLarge' : 'fetch';
}

export function useMediaBlobUrl(req: MediaBlobRequest): MediaBlobState {
  const { projectId, file, version, enabled, maxBytes } = req;
  const [state, setState] = useState<MediaBlobState>(IDLE);

  useEffect(() => {
    if (!enabled) {
      setState(IDLE);
      return undefined;
    }
    let cancelled = false;
    let url: string | null = null;
    setState(LOADING);
    void (async () => {
      const verdict = mediaBlobVerdict(await workspaceMediaSize(projectId, file), maxBytes);
      if (cancelled) return;
      if (verdict !== 'fetch') {
        setState(verdict === 'tooLarge' ? TOO_LARGE : FAILED);
        return;
      }
      const blob = await fetchWorkspaceMediaBlob(projectId, file);
      if (cancelled) return;
      if (!blob || blob.size === 0) {
        setState(FAILED);
        return;
      }
      url = URL.createObjectURL(blob);
      setState({ status: 'ready', url });
    })();
    return () => {
      cancelled = true;
      if (url !== null) URL.revokeObjectURL(url);
    };
  }, [projectId, file, version, enabled, maxBytes]);

  return state;
}
