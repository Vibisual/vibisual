import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { reviewMotion, type MotionFinding, type ResolvedTimeline, type VideoDoc } from '@vibisual/video';

import { readJsonResponse } from './videoApi.js';

/**
 * §5.13 (V) 37-9 — 스튜디오의 **모션 검수**: 문서만 보는 판정은 문서가 바뀔 때마다 이 창에서 바로(순수 함수 — 서버와 같은 것),
 * 프레임까지 보는 검수(대비·평평한 화면·컴포지션 안 글자)는 바퀴가 끝날 때 한 번과 사람이 부를 때만 일꾼에게 맡긴다(스틸 여러 장이라
 * 비싸다). [이번엔 넘기기]로 넘긴 것은 이 창이 기억한다(프로젝트·문서로 가른다 — §3.5).
 */
export interface MotionReview {
  /** 지금 보이는 결과(넘긴 것 제외). */
  readonly findings: readonly MotionFinding[];
  /** 프레임까지 본 결과인가. */
  readonly withFrames: boolean;
  readonly busy: boolean;
  readonly runFrames: () => void;
  readonly skip: (findingId: string) => void;
}

/** 문서 판정을 미루는 시간(ms) — AI 가 연달아 고치는 동안 매번 다시 재지 않게. */
const DOC_REVIEW_DELAY_MS = 600;
const ignoredByScope = new Map<string, Set<string>>();

export function useMotionReview(project: string, doc: VideoDoc | null, timeline: ResolvedTimeline | null, passEndedAt: number): MotionReview {
  const [docFindings, setDocFindings] = useState<readonly MotionFinding[]>([]);
  const [frameFindings, setFrameFindings] = useState<{ version: number; findings: readonly MotionFinding[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ignoredTick, setIgnoredTick] = useState(0);
  const scope = JSON.stringify([project, doc?.id ?? '']);
  const docId = doc?.id ?? '';
  const version = doc?.version ?? 0;

  useEffect(() => { setDocFindings([]); setFrameFindings(null); }, [scope]);

  // 문서 판정 — 잠잠해지면 한 번.
  useEffect(() => {
    if (!doc || !timeline) { setDocFindings([]); return; }
    const timer = setTimeout(() => setDocFindings(reviewMotion(doc, timeline)), DOC_REVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [doc, timeline]);

  const runFrames = useCallback((): void => {
    if (project === '' || docId === '' || busy) return;
    setBusy(true);
    const at = scope;
    fetch(`/api/app/vibistudio/doc/${encodeURIComponent(docId)}/review?project=${encodeURIComponent(project)}&frames=1`)
      .then((res) => readJsonResponse<{ version: number; frames: boolean; findings: MotionFinding[] }>(res))
      .then((body) => { if (at === JSON.stringify([project, docId]) && body.frames) setFrameFindings({ version: body.version, findings: body.findings }); })
      .catch(() => undefined) // 일꾼이 못 오면 문서 판정이 그대로 남는다.
      .finally(() => setBusy(false));
  }, [project, docId, busy, scope]);

  // 바퀴가 끝나면(보고가 왔다) 프레임까지 한 번.
  const lastPass = useRef(0);
  useEffect(() => {
    if (passEndedAt <= 0 || passEndedAt === lastPass.current) return;
    lastPass.current = passEndedAt;
    runFrames();
    // 보고 시각이 바뀔 때만.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passEndedAt]);

  const skip = useCallback((findingId: string): void => {
    const set = ignoredByScope.get(scope) ?? new Set<string>();
    set.add(findingId);
    ignoredByScope.set(scope, set);
    setIgnoredTick((n) => n + 1);
  }, [scope]);

  // 프레임 결과는 그 판본일 때만 쓴다(문서가 바뀌면 문서 판정으로 돌아간다 — 낡은 프레임 결과를 붙들지 않는다).
  const withFrames = frameFindings !== null && frameFindings.version === version;
  const findings = useMemo(() => {
    const ignored = ignoredByScope.get(scope) ?? new Set<string>();
    const base = withFrames && frameFindings ? frameFindings.findings : docFindings;
    return base.filter((f) => !ignored.has(f.id));
    // `ignoredTick` 은 넘긴 목록이 바뀌었다는 신호다(목록 자체는 모듈 밖에 있다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docFindings, frameFindings, withFrames, scope, ignoredTick]);

  return { findings, withFrames, busy, runFrames, skip };
}
