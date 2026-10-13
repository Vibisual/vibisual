import { useCallback, useEffect, useRef, useState } from 'react';
import { docHasCompositions, type VideoDoc } from '@vibisual/video';

import type { AppBubble } from '@vibisual/shared';
import { assetUrl, deliverToNode, fetchStillImage, getJob, startRender } from './videoApi.js';
import type { RendererHandle } from './useVideoRenderer.js';

/**
 * §5.13 (V) 37-15 — 내보내기(사용자가 누를 때만 — (T-15)): MP4 렌더 일감을 걸고 지켜본다(진행률은 내보내기 단추 안), 끝나면 받을
 * 수 있게 하고 이 문서에 묶인 캔버스 노드에 담는다(§5.13 (L)). PNG 는 재생 머리 한 장(컴포지션 문서는 일꾼 경로로 원본 크기).
 */
export interface StudioRender {
  readonly progress: number | null;
  readonly busy: boolean;
  readonly download: { readonly url: string; readonly name: string; readonly docId: string } | null;
  /** §5.13 (W) 38-3 — `transparent` 면 투명 배경 WebM(알파). */
  readonly renderMp4: (target?: { readonly docId: string; readonly title: string }, opts?: { readonly captions?: 'burn' | 'separate'; readonly transparent?: boolean }) => Promise<void>;
  readonly savePng: () => Promise<void>;
}

/** 렌더 일감을 묻는 간격(ms). */
const JOB_POLL_MS = 1200;

export function useStudioRender(opts: {
  projectName: string;
  doc: VideoDoc | null;
  playhead: number;
  renderer: RendererHandle;
  boundBubbles: (docId: string) => readonly AppBubble[];
  onError: (err: unknown) => void;
  onDone: (note: string | null) => void;
  /** §5.13 (T-8) — 렌더 앞의 표지 모으기가 실패해 예전 표지로 그렸을 때. */
  onCuesStale?: () => void;
}): StudioRender {
  const { projectName, doc, playhead, renderer } = opts;
  const [progress, setProgress] = useState<number | null>(null);
  const [job, setJob] = useState<{ id: string; title: string; ext: 'mp4' | 'webm' } | null>(null);
  const [download, setDownload] = useState<{ url: string; name: string; docId: string } | null>(null);
  const cb = useRef(opts);
  cb.current = opts;
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.url); }, [download]);
  useEffect(() => { setDownload(null); }, [projectName]);

  const renderMp4 = useCallback(async (target?: { readonly docId: string; readonly title: string }, opts: { readonly captions?: 'burn' | 'separate'; readonly transparent?: boolean } = {}): Promise<void> => {
    const docId = target?.docId ?? doc?.id;
    if (!docId || job) return;
    setProgress(0);
    try {
      const started = await startRender(projectName, docId, {
        ...(opts.captions ? { captions: opts.captions } : {}),
        ...(opts.transparent === true ? { transparent: true } : {}),
      });
      setJob({ id: started.id, title: target?.title ?? doc?.title ?? docId, ext: opts.transparent === true ? 'webm' : 'mp4' });
    } catch (err) {
      setProgress(null);
      cb.current.onError(err);
    }
  }, [doc, job, projectName]);

  useEffect(() => {
    if (!job) return;
    let active = true;
    let polling = false;
    const poll = async (): Promise<void> => {
      if (polling) return;
      polling = true;
      try {
        const current = await getJob(job.id);
        if (!active) return;
        if (current.status === 'done' || current.status === 'error' || current.status === 'canceled') {
          if (current.status === 'done' && current.result) {
            const res = await fetch(assetUrl(projectName, current.result));
            if (!res.ok) throw new Error(String(res.status));
            const blob = await res.blob();
            if (active) setDownload({ url: URL.createObjectURL(blob), name: `${job.title}.${job.ext}`, docId: current.docId });
            // §5.13 (L) — 사용자가 시킨 렌더의 결과를 이 문서에 묶인 캔버스 노드에 담는다(노드에서 바로 재생된다).
            for (const bubble of cb.current.boundBubbles(current.docId)) void deliverToNode(bubble.id, { file: current.result }).catch(() => undefined);
          }
          if (active) {
            if (current.status === 'error') cb.current.onError(new Error(current.error ?? 'render failed'));
            else {
              cb.current.onDone(current.note ?? null);
              if (current.cuesFailed === true) cb.current.onCuesStale?.();
            }
            setProgress(null); setJob(null);
          }
        } else setProgress(current.progress);
      } catch (error) {
        if (active) { cb.current.onError(error); setProgress(null); setJob(null); }
      } finally { polling = false; }
    };
    const timer = setInterval(() => void poll(), JOB_POLL_MS);
    return () => { active = false; clearInterval(timer); };
  }, [job, projectName]);

  /** PNG — 컴포지션이 든 문서는 최종 렌더와 같은 경로(일꾼)로 원본 크기를 받는다. */
  const savePng = useCallback(async (): Promise<void> => {
    if (!doc) return;
    try {
      const url = docHasCompositions(doc) ? await fetchStillImage(projectName, doc.id, playhead, { full: true }) : await renderer.still(playhead);
      const link = document.createElement('a');
      link.href = url; link.download = `${doc.title}.png`; link.click();
    } catch (error) { cb.current.onError(error); }
  }, [doc, projectName, playhead, renderer]);

  return { progress, busy: job !== null, download: download && download.docId === doc?.id ? download : null, renderMp4, savePng };
}
