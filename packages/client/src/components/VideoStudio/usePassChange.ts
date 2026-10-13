import { useEffect, useMemo, useState } from 'react';
import { diffDoc, summarizeDiff, type DiffLine, type DocActivity, type PassRecord, type PassReport, type VideoDoc } from '@vibisual/video';

import { readHistoryDoc } from './studioApi.js';

/**
 * §5.13 (V) 37-3 — AI 패널 카드가 보이는 **그 바퀴 전체의 변화**: 바퀴의 맡기기 직전 판(`startRev`) ↔ 지금 문서. 다시 읽을
 * 때마다의 작은 차이가 아니라 바퀴 하나가 바꾼 것 전부를 한 카드에 모은다. 마지막 바퀴(지금 하는 일 → 없으면 가장 최근 바퀴)의
 * 끝 보고(요약·경고·제안)도 함께 돌려준다.
 */
export interface PassChange {
  readonly pass: PassRecord | null;
  readonly lines: readonly DiffLine[];
  readonly report: PassReport | null;
  readonly open: boolean;
}

const startCache = new Map<string, VideoDoc>();

export function usePassChange(project: string, doc: VideoDoc | null, activity: DocActivity | null, passes: readonly PassRecord[]): PassChange {
  const pass = useMemo<PassRecord | null>(() => {
    const byActivity = activity ? passes.find((p) => p.id === activity.passId) : undefined;
    return byActivity ?? passes[passes.length - 1] ?? null;
  }, [activity, passes]);
  const startRev = pass?.startRev;
  const docId = doc?.id ?? '';
  const key = JSON.stringify([project, docId, startRev ?? '']);
  const [start, setStart] = useState<VideoDoc | null>(() => startCache.get(key) ?? null);

  useEffect(() => {
    if (!startRev || docId === '') { setStart(null); return; }
    const cached = startCache.get(key);
    if (cached) { setStart(cached); return; }
    let alive = true;
    readHistoryDoc(project, docId, startRev)
      .then((snapshot) => { startCache.set(key, snapshot); if (alive) setStart(snapshot); })
      .catch(() => { if (alive) setStart(null); });
    return () => { alive = false; };
  }, [key, project, docId, startRev]);

  const lines = useMemo(() => {
    if (!start || !doc || start.id !== doc.id) return [];
    const diff = diffDoc(start, doc);
    return diff.empty ? [] : summarizeDiff(diff, start, doc);
  }, [start, doc]);

  return { pass, lines, report: pass?.report ?? null, open: pass?.status === 'open' };
}
