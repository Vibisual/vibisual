/**
 * mediaConvert.ts — §5.13 (R-8) **"이 형식은 못 엽니다" 팝업의 상태.**
 *
 * 서버 스냅샷이 아니라 여기 사는 이유는 이것이 **한 창의 한 클릭에 딸린 대화**이기 때문이다
 * (`runSessions`·`captureBubbleRuntime` 과 같은 결의 비영속 런타임 스토어). 변환 결과의 진실은
 * 디스크의 캐시 파일이고, 그건 서버가 들고 있다.
 *
 * 이 스토어는 **열기 갈림길을 import 하지 않는다** — 변환이 끝난 뒤 실제로 여는 일은 화면(팝업)이
 * 한다. 그래야 `openWorkspaceTarget → 스토어 → openWorkspaceTarget` 순환이 생기지 않는다.
 */
import { create } from 'zustand';

import type { MediaConvertJob, MediaConvertKind, MediaToolsInfo } from '@vibisual/shared';

/** 팝업이 다루는 대상 한 건. */
export interface MediaConvertRequest {
  /** 프로젝트 루트 절대 경로. */
  readonly root: string;
  /** 원본(루트 기준 상대 경로). */
  readonly relPath: string;
  /** 원본 절대 경로 — [연결 프로그램으로 열기] 가 그대로 쓴다. */
  readonly absPath: string;
  readonly kind: MediaConvertKind;
}

/** 지금 무엇을 하고 있는가. 화면은 이 값 하나로 버튼과 진행률을 정한다. */
export type MediaConvertPhase = 'idle' | 'checking' | 'converting' | 'installing' | 'done' | 'error';

interface MediaConvertState {
  request: MediaConvertRequest | null;
  tools: MediaToolsInfo | null;
  job: MediaConvertJob | null;
  phase: MediaConvertPhase;
  error: string | null;
  /** 팝업을 연다(캐시가 없을 때만 호출된다 — 있으면 조용히 바로 열린다). */
  open: (request: MediaConvertRequest) => void;
  close: () => void;
  setTools: (tools: MediaToolsInfo | null) => void;
  setJob: (job: MediaConvertJob | null) => void;
  setPhase: (phase: MediaConvertPhase) => void;
  setError: (error: string | null) => void;
}

export const useMediaConvert = create<MediaConvertState>((set) => ({
  request: null,
  tools: null,
  job: null,
  phase: 'idle',
  error: null,
  open: (request) => set({ request, job: null, error: null, phase: 'checking' }),
  close: () => set({ request: null, job: null, error: null, phase: 'idle' }),
  setTools: (tools) => set({ tools }),
  setJob: (job) => set({ job }),
  setPhase: (phase) => set({ phase }),
  setError: (error) => set({ error, phase: error === null ? 'idle' : 'error' }),
}));

// ─── 서버와의 대화(얇은 층 — 호출을 한 곳에 모은다) ──────────────────────────

/** 이 파일의 변환 결과가 이미 있는가. **변환을 시작하지 않는다.** */
export async function fetchCachedConversion(
  root: string,
  relPath: string,
  kind: MediaConvertKind,
): Promise<string | null> {
  try {
    const res = await fetch(
      `/api/media-convert/cached?root=${encodeURIComponent(root)}&path=${encodeURIComponent(relPath)}&kind=${kind}`,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { outRel?: string | null };
    return body.outRel ?? null;
  } catch {
    return null;
  }
}

export async function fetchMediaTools(force = false): Promise<MediaToolsInfo | null> {
  try {
    const res = await fetch(`/api/media-tools${force ? '?force=1' : ''}`);
    if (!res.ok) return null;
    return (await res.json()) as MediaToolsInfo;
  } catch {
    return null;
  }
}

export async function installMediaTools(): Promise<{ ok: boolean; info: MediaToolsInfo | null }> {
  try {
    const res = await fetch('/api/media-tools/install', { method: 'POST' });
    if (!res.ok) return { ok: false, info: null };
    const body = (await res.json()) as { ok?: boolean; info?: MediaToolsInfo };
    return { ok: body.ok === true, info: body.info ?? null };
  } catch {
    return { ok: false, info: null };
  }
}

/** 변환을 시작한다(또는 이미 있는 결과·작업을 받는다). `no-ffmpeg` 면 화면이 [설치] 로 갈린다. */
export async function startConversion(
  root: string,
  relPath: string,
  kind: MediaConvertKind,
): Promise<{ ok: true; job: MediaConvertJob } | { ok: false; error: 'no-ffmpeg' | 'not-found' | 'failed' }> {
  try {
    const res = await fetch('/api/media-convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, path: relPath, kind }),
    });
    if (res.status === 409) return { ok: false, error: 'no-ffmpeg' };
    if (res.status === 404) return { ok: false, error: 'not-found' };
    if (!res.ok) return { ok: false, error: 'failed' };
    const body = (await res.json()) as { job: MediaConvertJob };
    return { ok: true, job: body.job };
  } catch {
    return { ok: false, error: 'failed' };
  }
}

export async function fetchConversionJob(jobId: string): Promise<MediaConvertJob | null> {
  try {
    const res = await fetch(`/api/media-convert/${encodeURIComponent(jobId)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { job: MediaConvertJob };
    return body.job;
  } catch {
    return null;
  }
}
