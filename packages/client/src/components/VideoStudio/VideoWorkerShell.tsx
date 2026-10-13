import { useCallback, useEffect, useRef } from 'react';
import { WORKER_IDLE_MS, assetsNeedingMeasurement, buildMeasurementOps, type VideoDoc } from '@vibisual/video';

import type { AppShellProps } from '../../apps/registry.js';
import { measureAssets } from './useVideoRenderer.js';
import { useVideoJobWorker } from './useVideoJobWorker.js';
import { patchDoc } from './videoApi.js';

/**
 * §5.13 (T-4) — **창 없는 렌더 일꾼**의 화면(사람이 보는 화면이 아니다).
 *
 * main 몫이 일감이 들어올 때 이 창을 보이지 않게 띄운다(`worker:ensure`). 줄마다 일꾼을 하나씩 돈다 — 스틸·프레임 띠 줄과
 * 렌더 줄. 그래서 스튜디오 창이 닫혀 있어도 에이전트의 스틸이 오고, 4분짜리 렌더가 도는 동안에도 스틸이 렌더 뒤에 줄 서지
 * 않는다. 모든 프로젝트의 일감을 집되 문서는 일감의 프로젝트로 읽고 무대도 일감마다 새로 세운다(§3.5 — 두 프로젝트가 한
 * 무대를 나눠 쓰지 않는다).
 *
 * 처리하기 전에 **빠진 실측값**(영상·소리 길이)을 채운다 — 에이전트가 길이 없이 `duration:'auto'` 로 얹은 클립이 그래야
 * 풀린다(스튜디오를 열 때 하던 일을, 스튜디오가 닫혀 있어도 일꾼이 한다).
 *
 * 일감이 `WORKER_IDLE_MS` 동안 없으면 main 에게 닫아 달라고 한다 — 안 쓰면 0(§5.13 (P-1)).
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
