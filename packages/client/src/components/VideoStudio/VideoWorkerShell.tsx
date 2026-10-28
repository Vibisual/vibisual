import { useCallback, useEffect, useRef } from 'react';
import { WORKER_IDLE_MS, assetsNeedingMeasurement, buildMeasurementOps, type VideoDoc } from '@vibisual/video';

import type { AppShellProps } from '../../apps/registry.js';
import { measureAssets } from './useVideoRenderer.js';
import { useVideoJobWorker } from './useVideoJobWorker.js';
import { patchDoc } from './videoApi.js';

/**
 * §5.13 (T-4) — 창 없는 렌더 일꾼(`worker:ensure`). 줄마다 일꾼 하나(스틸·띠 / 렌더) — 스튜디오가 닫혀도 스틸이 오고 렌더 뒤에 줄 서지 않는다.
 * 문서는 일감의 프로젝트로, 무대는 일감마다 새로(§3.5). 처리 전 빠진 길이를 채운다(`duration:'auto'`). `WORKER_IDLE_MS` 동안 없으면 닫는다(§5.13 (P-1)).
 */
export function VideoWorkerShell(_props: AppShellProps): React.JSX.Element {
  const pending = useRef(0);
  const lastBusyAt = useRef(Date.now());

  const prepare = useCallback(async (project: string, doc: VideoDoc): Promise<VideoDoc> => {
    // 일감마다 한 번 불린다 — 쉬는 시계를 여기서 다시 감는다(짧은 스틸은 5초 틱 사이에 끝나 버린다).
    lastBusyAt.current = Date.now();
    const missing = assetsNeedingMeasurement(doc);
    if (missing.length === 0) return doc;
    const ops = buildMeasurementOps(doc, await measureAssets(project, missing));
    if (ops.length === 0) return doc;
    try {
      return (await patchDoc(project, doc.id, doc.version, ops)).doc;
    } catch {
      // 그 사이 누가 먼저 고쳤다 — 원래 문서로 그린다(다음 일감이 다시 잰다).
      return doc;
    }
  }, []);

  const noop = useCallback((): void => undefined, []);
  useVideoJobWorker(undefined, pending, noop, noop, noop, { lane: 'still', prepare });
  useVideoJobWorker(undefined, pending, noop, noop, noop, { lane: 'render', prepare });

  // 쉬는 동안 스스로 닫는다 — 일감이 하나라도 도는 중이면 시계를 다시 감는다.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (pending.current > 0) {
        lastBusyAt.current = Date.now();
        return;
      }
      if (Date.now() - lastBusyAt.current < WORKER_IDLE_MS) return;
      void window.api?.app?.invoke('vibistudio', 'worker:idle').catch(() => undefined);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, []);

  return <div className="h-full w-full bg-black" aria-hidden="true" />;
}
