import type { Vibi3DCaptureRecord, Vibi3DRun, Vibi3DStageRecord } from '@vibisual/shared';
import type { AppLinkedItem, AppLinkedItemsReader } from '../../apps/registry.js';
import { workflowRequest } from './vibi3dWorkflow.js';

/**
 * §5.4 #36 (H) ③ · §5.1 #2-1 (F) 앱별 — Vibi3D 노드 아래 **단계 구슬**. 구슬 하나가 단계 하나다: 번호 + **그 단계의 대표 캡처
 * 한 장**(구슬 안 그림 — 구슬을 늘어놓으면 모델이 자라는 과정이 된다). 나머지 캡처는 구슬 툴팁·편집기의 몫이다(종전에는 캡처마다
 * 구슬이 하나씩이라 단계 넷에 구슬이 열몇 개였다).
 *
 * - 지금 만지는 단계(`run.activeStageId`)는 숨 쉰다 · 제안을 기다리는 단계(`mode === 'candidate'`, `run.candidateId`)는 점선 테
 *   구슬(사람이 고를 차례 — `proposed`), 끝난 단계는 채운 구슬(`done`).
 */
const VIEW_RANK: Readonly<Record<string, number>> = { lit: 0, ao: 1, clay: 2, wire: 3 };

/** 단계의 대표 캡처 — 빛을 넣은 마무리 화질 → 빛을 넣은 것 → 그 밖, 같으면 가장 최근 것. */
export function representativeCapture(stage: Pick<Vibi3DStageRecord, 'captures'>): Vibi3DCaptureRecord | null {
  let best: Vibi3DCaptureRecord | null = null;
  const score = (c: Vibi3DCaptureRecord): number => (VIEW_RANK[c.mode] ?? 9) * 2 + (c.quality === 'final' ? 0 : 1);
  for (const c of stage.captures) {
    if (!best || score(c) < score(best) || (score(c) === score(best) && c.capturedAt > best.capturedAt)) best = c;
  }
  return best;
}

export function modelRunLinkedItems(run: Vibi3DRun | null): AppLinkedItem[] {
  if (!run) return [];
  return run.stages.map((stage, i): AppLinkedItem => {
    const capture = representativeCapture(stage);
    const waiting = stage.mode === 'candidate' && (run.candidateId === undefined || stage.candidateId === run.candidateId);
    return {
      id: `stage:${run.id}:${stage.id}`,
      group: 'scene',
      kind: 'model',
      label: stage.label,
      index: i + 1,
      numbered: 'step',
      stage: waiting ? 'proposed' : 'done',
      ...(run.activeStageId === stage.id ? { active: true } : {}),
      ...(capture ? { file: capture.path } : {}),
      ...(stage.captures.length > 0 ? { pictureCount: stage.captures.length } : {}),
    };
  });
}

export const readVibi3DLinkedItems: AppLinkedItemsReader = async ({ projectId, ref }) => {
  if (!ref) return null;
  const { run } = await workflowRequest<{ run: Vibi3DRun | null }>(`/api/app/vibi3d/documents/${encodeURIComponent(ref)}/runs?projectId=${encodeURIComponent(projectId)}`);
  return { key: JSON.stringify(run), items: modelRunLinkedItems(run) };
};
