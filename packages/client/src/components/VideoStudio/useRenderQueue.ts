import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { onAppEvent } from '../../apps/appEvents.js';
import { STUDIO_APP_ID } from './studioAppId.js';
import { controlRenderJob, controlRenderQueue, listRenderJobs, type RenderJobAction, type RenderQueueAction, type VideoJob } from './videoApi.js';

/**
 * §5.13 (AA) 42-5 — 이 프로젝트의 렌더 대기열을 지켜보고 조작한다(실행은 숨은 일꾼 하나 — (T-4), 줄의 진실은 서버).
 * 주 신호는 서버 앱 알림(`render-queue`), 폴링은 안전망(도는 것이 있으면 짧게, 없으면 길게 — 40-7 ②). 끝나는 것을 보면 `onFinished` 로 알린다(알림·노드 담기는 셸).
 */
export interface RenderQueueState {
  /** 렌더 일감 — 도는 것 → 기다리는 것(순서) → 끝난 것(최근 먼저). */
  readonly jobs: readonly VideoJob[];
  /** 지금 도는 렌더(멈춘 것 포함). */
  readonly running: VideoJob | null;
  /** 아직 안 끝난 일감 수(도는 것 포함). */
  readonly activeCount: number;
  readonly refresh: () => void;
  readonly control: (jobId: string, action: RenderJobAction) => Promise<void>;
  readonly controlAll: (action: RenderQueueAction) => Promise<void>;
}

/** 도는 것이 있을 때·없을 때의 안전망 폴링 간격(ms). */
const QUEUE_POLL_ACTIVE_MS = 2000;
const QUEUE_POLL_IDLE_MS = 15_000;

function isTerminal(job: VideoJob): boolean {
  return job.status === 'done' || job.status === 'error' || job.status === 'canceled';
}

/** 보이는 순서 — 도는 것 · 기다리는 것(줄 순서) · 끝난 것(최근 먼저). */
export function sortRenderJobs(jobs: readonly VideoJob[]): VideoJob[] {
  const rank = (j: VideoJob): number => (j.status === 'running' ? 0 : j.status === 'queued' ? 1 : 2);
  return [...jobs].sort((a, b) => rank(a) - rank(b)
    || (rank(a) === 2 ? (b.finishedAt ?? 0) - (a.finishedAt ?? 0) : (a.order ?? 0) - (b.order ?? 0)));
}

export function useRenderQueue(project: string, opts: {
  readonly paused: boolean;
  readonly onError: (err: unknown) => void;
  /** 이 창이 지켜보는 동안 끝난 일감(끝난 순간 한 번). */
  readonly onFinished: (job: VideoJob) => void;
  /** 처음 읽었을 때 이미 끝나 있던 일감(창이 닫혀 있는 동안 끝난 것 — 노드 담기를 이어 한다). */
  readonly onSettled?: (jobs: readonly VideoJob[]) => void;
}): RenderQueueState {
  const [jobs, setJobs] = useState<readonly VideoJob[]>([]);
  const cb = useRef(opts);
  cb.current = opts;
  const known = useRef<Map<string, VideoJob['status']> | null>(null);
  const inFlight = useRef(false);
  const again = useRef(false);

  const refresh = useCallback((): void => {
    if (!project) return;
    if (inFlight.current) { again.current = true; return; }
    inFlight.current = true;
    // 묻기가 실패해도(연결 끊김 · 옛 서버) 화면은 그대로 — 다음 알림·간격에 다시 묻는다.
    void Promise.resolve().then(() => listRenderJobs(project))
      .then((list) => {
        const prev = known.current;
        const next = new Map(list.map((j) => [j.id, j.status] as const));
        known.current = next;
        setJobs(sortRenderJobs(list));
        if (prev === null) { cb.current.onSettled?.(list.filter(isTerminal)); return; }
        for (const job of list) {
          const before = prev.get(job.id);
          if (before !== undefined && before !== job.status && isTerminal(job)) cb.current.onFinished(job);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        inFlight.current = false;
        if (again.current) { again.current = false; refresh(); }
      });
  }, [project]);

  // 프로젝트가 바뀌면 처음부터(다른 탭의 줄이 새지 않게 — §3.5).
  useEffect(() => { known.current = null; setJobs([]); refresh(); }, [project, refresh]);

  useEffect(() => onAppEvent(STUDIO_APP_ID, (event) => { if (event.kind === 'render-queue') refresh(); }), [refresh]);

  // 짧게 묻는 것은 도는 것·곧 집힐 것이 있을 때만 — 멈춘 것·먼 예약만 있으면 길게(알림이 주 신호다).
  const active = jobs.some((j) => j.status === 'running' || (j.status === 'queued' && j.held !== true && (j.notBefore === undefined || j.notBefore <= Date.now())));
  useEffect(() => {
    if (opts.paused) return undefined;
    const timer = setInterval(refresh, active ? QUEUE_POLL_ACTIVE_MS : QUEUE_POLL_IDLE_MS);
    return () => clearInterval(timer);
  }, [refresh, active, opts.paused]);

  const control = useCallback(async (jobId: string, action: RenderJobAction): Promise<void> => {
    try {
      await controlRenderJob(jobId, action);
    } catch (err) {
      cb.current.onError(err);
    } finally {
      refresh();
    }
  }, [refresh]);

  const controlAll = useCallback(async (action: RenderQueueAction): Promise<void> => {
    try {
      await controlRenderQueue(project, action);
    } catch (err) {
      cb.current.onError(err);
    } finally {
      refresh();
    }
  }, [project, refresh]);

  return useMemo(() => ({
    jobs,
    running: jobs.find((j) => j.status === 'running') ?? null,
    activeCount: jobs.filter((j) => !isTerminal(j)).length,
    refresh,
    control,
    controlAll,
  }), [jobs, refresh, control, controlAll]);
}
