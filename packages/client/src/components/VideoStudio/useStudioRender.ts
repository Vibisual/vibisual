import { useCallback, useRef } from 'react';
import { docHasCompositions, type VideoDoc } from '@vibisual/video';

import type { AppBubble } from '@vibisual/shared';
import { assetUrl, deliverToNode, fetchStillImage, startRender, type RenderRequest, type VideoJob } from './videoApi.js';
import type { RendererHandle } from './useVideoRenderer.js';
import { useRenderQueue, type RenderQueueState } from './useRenderQueue.js';

/**
 * §5.13 (V) 37-15 · (AA) 42 — 내보내기(사용자가 누를 때만 — (T-15)). 렌더 일감은 프로젝트의 대기열이다(`useRenderQueue`): 이 창은 걸고·지켜보고·조작한다(실행은 숨은 일꾼 하나 — (T-4)).
 * 진행률은 내보내기 단추 안, 끝나면 알림 한 줄과 [받기]. [캔버스 노드에 담기]가 켜진 일감은 이 문서에 묶인 노드에 담는다(§5.13 (L) — 창이 닫힌 동안 끝난 것은 다음에 대기열을 읽을 때).
 * PNG 는 재생 머리 한 장(컴포지션 문서는 일꾼 경로로 원본 크기).
 */
export interface StudioRender {
  /** 이 프로젝트에서 도는 렌더의 진행률(0~1). 없으면 null. */
  readonly progress: number | null;
  /** 이 문서의 렌더가 실제로 도는 중(멈춤 포함) — 그동안만 편집을 막는다((U) · 42-5). */
  readonly busy: boolean;
  readonly queue: RenderQueueState;
  /** 이 문서의 마지막 완료 렌더. */
  readonly last: VideoJob | null;
  /** 결과를 받는다(기본 = 이 문서의 마지막 렌더). */
  readonly download: (job?: VideoJob | null) => Promise<void>;
  /** 렌더 한 줄을 건다. 실패하면 알리고 null. */
  readonly enqueue: (docId: string, request: RenderRequest) => Promise<VideoJob | null>;
  readonly savePng: () => Promise<void>;
}

function baseName(file: string): string {
  return file.split(/[\\/]/).pop() ?? file;
}

export function useStudioRender(opts: {
  projectName: string;
  doc: VideoDoc | null;
  playhead: number;
  /** §5.13 (Y) 40-5 ① — 누른 순간의 시각(재생 중에도 정확하게 — 시계). 없으면 `playhead`. */
  readPlayhead?: () => number;
  renderer: RendererHandle;
  boundBubbles: (docId: string) => readonly AppBubble[];
  /** 숨은 동안 — 대기열 폴링을 쉰다(알림은 계속 듣는다). */
  paused?: boolean;
  onError: (err: unknown) => void;
  onDone: (note: string | null) => void;
  /** §5.13 (T-8) — 렌더 앞의 표지 모으기가 실패해 예전 표지로 그렸을 때. */
  onCuesStale?: () => void;
}): StudioRender {
  const { projectName, doc, playhead, renderer } = opts;
  const cb = useRef(opts);
  cb.current = opts;
  /** 이 창이 건 일감 — 끝났다는 알림 한 줄은 건 창(또는 그 문서를 보는 창)에서만. */
  const mine = useRef(new Set<string>());
  const control = useRef<RenderQueueState['control'] | null>(null);

  /** §5.13 (L)(AA) 42-7 — 노드 담기(켜진 일감만, 한 번). 묶인 노드가 없어도 담았다고 적는다(다시 시도하지 않게). */
  const deliver = useCallback((job: VideoJob): void => {
    if (job.status !== 'done' || !job.result || job.output?.after.deliver !== true || job.delivered === true) return;
    const file = job.result;
    for (const bubble of cb.current.boundBubbles(job.docId)) void deliverToNode(bubble.id, { file }).catch(() => undefined);
    void control.current?.(job.id, 'delivered');
  }, []);

  const queue = useRenderQueue(projectName, {
    paused: opts.paused === true,
    onError: (err) => cb.current.onError(err),
    onFinished: (job) => {
      const watched = mine.current.has(job.id) || job.docId === cb.current.doc?.id;
      if (watched && job.status === 'done') {
        cb.current.onDone(job.note ?? null);
        if (job.cuesFailed === true) cb.current.onCuesStale?.();
      } else if (watched && job.status === 'error') {
        cb.current.onError(new Error(job.error ?? 'render failed'));
      }
      deliver(job);
    },
    onSettled: (jobs) => { for (const job of jobs) deliver(job); },
  });
  control.current = queue.control;

  const docId = doc?.id ?? null;
  const running = queue.running;
  const last = docId ? queue.jobs.find((j) => j.docId === docId && j.status === 'done' && !!j.result) ?? null : null;

  const download = useCallback(async (job?: VideoJob | null): Promise<void> => {
    const target = job ?? last;
    if (!target?.result) return;
    try {
      // 패키지 앱에서는 요소의 /api 요청이 비므로 fetch → blob 으로 받는다(§5.13 (U)).
      const res = await fetch(assetUrl(projectName, target.result));
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = baseName(target.exported ?? target.result);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (error) { cb.current.onError(error); }
  }, [last, projectName]);

  const refreshQueue = queue.refresh;
  const enqueue = useCallback(async (targetDocId: string, request: RenderRequest): Promise<VideoJob | null> => {
    try {
      const job = await startRender(projectName, targetDocId, request);
      mine.current.add(job.id);
      refreshQueue();
      return job;
    } catch (err) {
      cb.current.onError(err);
      return null;
    }
  }, [projectName, refreshQueue]);

  /** PNG — 컴포지션이 든 문서는 최종 렌더와 같은 경로(일꾼)로 원본 크기를 받는다. */
  const savePng = useCallback(async (): Promise<void> => {
    if (!doc) return;
    try {
      const at = cb.current.readPlayhead?.() ?? playhead;
      const url = docHasCompositions(doc) ? await fetchStillImage(projectName, doc.id, at, { full: true }) : await renderer.still(at);
      const link = document.createElement('a');
      link.href = url; link.download = `${doc.title}.png`; link.click();
    } catch (error) { cb.current.onError(error); }
  }, [doc, projectName, playhead, renderer]);

  return {
    progress: running ? running.progress : null,
    busy: !!docId && queue.jobs.some((j) => j.docId === docId && j.status === 'running'),
    queue,
    last,
    download,
    enqueue,
    savePng,
  };
}
