import { diffDoc, diffTargets, summarizeDiff, type DiffLine, type DocActivity, type PassRecord, type VideoDoc } from '@vibisual/video';

import { readHistoryDoc } from './studioApi.js';

/**
 * §5.13 (V) 37-3 — "이번에 바뀐 것" 계산 한 벌(순수 + 바퀴 시작 판 읽기). 스튜디오 AI 패널(`usePassChange`)과 캔버스 노드의 훑어보기
 * (§5.4 #36 (J) ③)가 같은 함수를 쓴다 — 두 벌이면 같은 바퀴가 두 화면에서 다른 변화로 읽힌다.
 */

/** 보일 바퀴 — 지금 하는 일의 바퀴, 없으면 가장 최근 바퀴. */
export function passOfActivity(activity: DocActivity | null | undefined, passes: readonly PassRecord[]): PassRecord | null {
  const byActivity = activity ? passes.find((p) => p.id === activity.passId) : undefined;
  return byActivity ?? passes[passes.length - 1] ?? null;
}

/** 바퀴 시작 판 ↔ 지금 문서의 사람이 읽는 줄. 같은 문서가 아니거나 아무것도 안 바뀌었으면 빈 목록. */
export function passChangeLines(start: VideoDoc | null, doc: VideoDoc | null): DiffLine[] {
  if (!start || !doc || start.id !== doc.id) return [];
  const diff = diffDoc(start, doc);
  return diff.empty ? [] : summarizeDiff(diff, start, doc);
}

export interface PassChangeTargets {
  readonly chapters: ReadonlySet<string>;
  readonly items: ReadonlySet<string>;
}

const NO_TARGETS: PassChangeTargets = { chapters: new Set(), items: new Set() };

/** 줄과 그 바퀴가 바꾸거나 더한 장면·아이템 id(아이템이 바뀐 장면 포함)를 차이 한 번으로. */
export function passChangeOf(start: VideoDoc | null, doc: VideoDoc | null): { readonly lines: readonly DiffLine[]; readonly targets: PassChangeTargets } {
  if (!start || !doc || start.id !== doc.id) return { lines: [], targets: NO_TARGETS };
  const diff = diffDoc(start, doc);
  if (diff.empty) return { lines: [], targets: NO_TARGETS };
  return { lines: summarizeDiff(diff, start, doc), targets: diffTargets(diff, doc) };
}

/** 바퀴 시작 판 기억 — 판은 바뀌지 않으므로 한 번 읽으면 그대로다. 다시 읽을 수 있는 파생이라 수로만 묶는다(오래 안 쓴 것부터). */
const START_CACHE_MAX = 16;
const startCache = new Map<string, VideoDoc>();
const startInflight = new Map<string, Promise<VideoDoc>>();

function startKey(project: string, docId: string, revId: string): string {
  return JSON.stringify([project, docId, revId]);
}

/** 기억한 시작 판(없으면 `undefined`) — 그리기 전에 바로 꺼내 깜빡이지 않게. */
export function peekPassStartDoc(project: string, docId: string, revId: string): VideoDoc | undefined {
  return startCache.get(startKey(project, docId, revId));
}

/** 바퀴 시작 판을 읽는다(같은 판을 동시에 두 번 묻지 않는다). */
export function loadPassStartDoc(project: string, docId: string, revId: string): Promise<VideoDoc> {
  const key = startKey(project, docId, revId);
  const hit = startCache.get(key);
  if (hit) {
    startCache.delete(key);
    startCache.set(key, hit);
    return Promise.resolve(hit);
  }
  const flying = startInflight.get(key);
  if (flying) return flying;
  const next = readHistoryDoc(project, docId, revId)
    .then((doc) => {
      startCache.set(key, doc);
      while (startCache.size > START_CACHE_MAX) {
        const oldest = startCache.keys().next().value;
        if (oldest === undefined) break;
        startCache.delete(oldest);
      }
      return doc;
    })
    .finally(() => startInflight.delete(key));
  startInflight.set(key, next);
  return next;
}
