import type { Vibi3DCaptureRecord, Vibi3DRun, Vibi3DStageRecord } from '@vibisual/shared';
import type { AppLinkedItem, AppLinkedItemsReader } from '../../apps/registry.js';
import { workflowRequest } from './vibi3dWorkflow.js';

/**
 * §5.4 #36 (H) ③ · §5.1 #2-1 (F) — Vibi3D 노드 아래 단계 구슬: 번호 + 대표 캡처 한 장(캡처마다 구슬 ❌ — 나머지는 툴팁·편집기).
 * 지금 단계(`run.activeStageId`) 숨 쉼 · 제안 대기(`mode === 'candidate'`) 점선 `proposed` · 끝 `done`.
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
  // 단계 id 는 기록 여럿이 나눠 쓴다(같은 단계의 검토 대기 기록 → 직접 검수 기록). 지금 단계는 서버처럼 그 id 의 **마지막
  // 기록** 하나다(`vibi3dWorkflowStore` — 뒤에서부터 찾는다). id 로만 견주면 같은 id 의 구슬이 모두 숨 쉰다.
  let activeIndex = -1;
  for (let i = run.stages.length - 1; i >= 0 && run.activeStageId !== undefined; i -= 1) {
    if (run.stages[i]!.id === run.activeStageId) { activeIndex = i; break; }
  }
  return run.stages.map((stage, i): AppLinkedItem => {
    const capture = representativeCapture(stage);
    const waiting = stage.mode === 'candidate' && (run.candidateId === undefined || stage.candidateId === run.candidateId);
    return {
      // 구슬 하나 = 기록 하나(편집기 목록과 같은 단위). 기록은 뒤에만 쌓이므로 차례가 곧 정체다 — 단계 id 로 열쇠를 지으면
      // 같은 id 의 기록끼리 열쇠가 겹쳐 구슬이 겹치거나 빠진다(2026-10-21 실제 문서: 6기록에 id 3개).
      id: `stage:${run.id}:${i}`,
      group: 'scene',
      kind: 'model',
      label: stage.label,
      index: i + 1,
      numbered: 'step',
      stage: waiting ? 'proposed' : 'done',
      ...(i === activeIndex ? { active: true } : {}),
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
