import { useEffect, useMemo, useState } from 'react';
import type { DiffLine, DocActivity, PassRecord, PassReport, VideoDoc } from '@vibisual/video';

import { loadPassStartDoc, passChangeLines, passOfActivity, peekPassStartDoc } from './passChange.js';

/**
 * §5.13 (V) 37-3 — AI 패널 카드가 보이는 **그 바퀴 전체의 변화**: 바퀴의 맡기기 직전 판(`startRev`) ↔ 지금 문서. 다시 읽을
 * 때마다의 작은 차이가 아니라 바퀴 하나가 바꾼 것 전부를 한 카드에 모은다. 마지막 바퀴(지금 하는 일 → 없으면 가장 최근 바퀴)의
 * 끝 보고(요약·경고·제안)도 함께 돌려준다. 계산은 `passChange.ts` 한 벌(캔버스 훑어보기와 같다).
 */
export interface PassChange {
  readonly pass: PassRecord | null;
  readonly lines: readonly DiffLine[];
  readonly report: PassReport | null;
  readonly open: boolean;
}

export function usePassChange(project: string, doc: VideoDoc | null, activity: DocActivity | null, passes: readonly PassRecord[]): PassChange {
  const pass = useMemo<PassRecord | null>(() => passOfActivity(activity, passes), [activity, passes]);
  const startRev = pass?.startRev;
  const docId = doc?.id ?? '';
  const [start, setStart] = useState<VideoDoc | null>(() => (startRev && docId ? peekPassStartDoc(project, docId, startRev) ?? null : null));

  useEffect(() => {
    if (!startRev || docId === '') { setStart(null); return; }
    const cached = peekPassStartDoc(project, docId, startRev);
    if (cached) { setStart(cached); return; }
    let alive = true;
    loadPassStartDoc(project, docId, startRev)
      .then((snapshot) => { if (alive) setStart(snapshot); })
      .catch(() => { if (alive) setStart(null); });
    return () => { alive = false; };
  }, [project, docId, startRev]);

  const lines = useMemo(() => passChangeLines(start, doc), [start, doc]);

  return { pass, lines, report: pass?.report ?? null, open: pass?.status === 'open' };
}
