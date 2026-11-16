import { useEffect, useMemo, useState } from 'react';
import { diffDoc, sceneChanges, sceneDecisionOf, summarizeDiff, type DiffLine, type DocActivity, type PassRecord, type PassReport, type SceneChangeSet, type SceneDecision, type VideoDoc } from '@vibisual/video';

import { loadPassStartDoc, passOfActivity, peekPassStartDoc } from './passChange.js';

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
  /** §5.13 (V) 37-23 — 바퀴 시작 판(장면 되돌리기 연산의 기준). 아직 못 읽었으면 null. */
  readonly start: VideoDoc | null;
  /** 장면 단위로 가른 변화. 장면 층이 없는 문서면 `scenes` 가 비고 줄은 `lines` 그대로다. */
  readonly scenes: SceneChangeSet;
  /** 아직 유효한 장면 결정(지문이 지금 문서와 같은 것만). */
  readonly decided: Readonly<Record<string, SceneDecision>>;
}

const NO_SCENES: SceneChangeSet = { scenes: [], rest: [] };

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

  // 차이는 한 번만 계산해 줄 목록과 장면 묶음이 같은 변화를 말하게 한다.
  const { lines, scenes } = useMemo(() => {
    if (!start || !doc || start.id !== doc.id) return { lines: [] as DiffLine[], scenes: NO_SCENES };
    const diff = diffDoc(start, doc);
    if (diff.empty) return { lines: [] as DiffLine[], scenes: NO_SCENES };
    return { lines: summarizeDiff(diff, start, doc), scenes: sceneChanges(start, doc, diff) };
  }, [start, doc]);

  const decided = useMemo(() => {
    const out: Record<string, SceneDecision> = {};
    if (!doc) return out;
    for (const scene of scenes.scenes) {
      const hit = sceneDecisionOf(pass, doc, scene.chapterId);
      if (hit) out[scene.chapterId] = hit;
    }
    return out;
  }, [pass, doc, scenes]);

  return { pass, lines, report: pass?.report ?? null, open: pass?.status === 'open', start, scenes, decided };
}
