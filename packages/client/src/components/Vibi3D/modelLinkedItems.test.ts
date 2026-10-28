/** §5.4 #36 (H) ③ · §5.1 #2-1 (F) — Vibi3D 단계 구슬. 픽스처는 2026-10-21 실제 문서 모양: 기록 6개가 단계 id 3개를 나눠 쓴다, 지금 단계 `storefronts`. */
import { describe, expect, it } from 'vitest';
import type { Vibi3DCaptureRecord, Vibi3DRun, Vibi3DStageRecord } from '@vibisual/shared';

import { modelRunLinkedItems, representativeCapture } from './modelLinkedItems.js';

function capture(mode: Vibi3DCaptureRecord['mode'], quality: Vibi3DCaptureRecord['quality'], capturedAt: number): Vibi3DCaptureRecord {
  return { path: `.vibisual/creation/x/captures/${mode}-${quality}-${capturedAt}.png`, view: 'review', mode, quality, width: 1080, height: 1920, revision: 1, capturedAt };
}

function stage(id: string, label: string, n: number, captures: Vibi3DCaptureRecord[], mode: Vibi3DStageRecord['mode'] = 'intermediate'): Vibi3DStageRecord {
  return { id, label, revision: n, sceneRevision: 1, sourcePath: `.vibisual/creation/x/stages/${n}.json`, createdAt: n, mode, captures, checks: [] };
}

const realRun: Vibi3DRun = {
  id: '9f661dd8-7c1c-4634-b326-5521f4038503',
  docId: 'source-048d9c',
  projectId: 'C:/work/demo',
  baseRevision: 1,
  currentRevision: 6,
  initialEmpty: false,
  createdAt: 1,
  activeStageId: 'storefronts',
  stages: [
    stage('sample-bay', 'sample-bay / geometry and material review pending', 1,
      [capture('clay', 'final', 10), capture('lit', 'final', 11), capture('clay', 'final', 12), capture('lit', 'final', 13)]),
    stage('sample-bay', 'sample-bay / 직접 이미지 검수 기록', 2, []),
    stage('assembly', 'assembly / geometry and material review pending', 3, [capture('clay', 'final', 20), capture('lit', 'final', 21)]),
    stage('assembly', 'assembly / 직접 이미지 검수 기록', 4, []),
    stage('storefronts', 'storefronts / geometry and material review pending', 5,
      [capture('clay', 'final', 30), capture('lit', 'final', 31), capture('clay', 'final', 32), capture('lit', 'final', 33)]),
    stage('storefronts', 'storefronts / 직접 이미지 검수 기록', 6, []),
  ],
};

describe('modelRunLinkedItems — 단계 구슬', () => {
  it('구슬 하나 = 기록 하나 — 단계 id 가 겹쳐도 구슬 열쇠는 겹치지 않는다', () => {
    const items = modelRunLinkedItems(realRun);
    expect(items).toHaveLength(6);
    expect(new Set(items.map((i) => i.id)).size).toBe(6);
    expect(items.map((i) => i.index)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(items.every((i) => i.numbered === 'step' && i.stage === 'done')).toBe(true);
  });

  it('지금 단계는 그 id 의 마지막 기록 하나만 숨 쉰다(서버와 같은 규칙)', () => {
    const items = modelRunLinkedItems(realRun);
    expect(items.filter((i) => i.active).map((i) => i.index)).toEqual([6]);
    const earlier = modelRunLinkedItems({ ...realRun, activeStageId: 'sample-bay' });
    expect(earlier.filter((i) => i.active).map((i) => i.index)).toEqual([2]);
    expect(modelRunLinkedItems({ ...realRun, activeStageId: undefined }).some((i) => i.active)).toBe(false);
  });

  it('캡처가 있는 기록만 그림 · 그림 수를 갖는다 — 대표는 빛을 넣은 마무리 화질의 가장 최근 것', () => {
    const items = modelRunLinkedItems(realRun);
    expect(items[0]).toMatchObject({ file: realRun.stages[0]!.captures[3]!.path, pictureCount: 4 });
    expect(items[1]!.file).toBeUndefined();
    expect(items[1]!.pictureCount).toBeUndefined();
    expect(representativeCapture(realRun.stages[2]!)?.mode).toBe('lit');
  });

  it('제안을 기다리는 기록은 점선 테(proposed)', () => {
    const run: Vibi3DRun = {
      ...realRun,
      candidateId: 'cand-1',
      stages: [...realRun.stages, { ...stage('storefronts', 'storefronts / 후보', 7, []), mode: 'candidate', candidateId: 'cand-1' }],
    };
    expect(modelRunLinkedItems(run).at(-1)).toMatchObject({ stage: 'proposed', index: 7 });
  });
});
