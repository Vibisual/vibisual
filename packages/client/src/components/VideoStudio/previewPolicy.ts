import { docHasCompositions, type VideoDoc } from '@vibisual/video';
import type { StageWarmOptions } from '@vibisual/video/render';

import { studioBudget, type DeviceHints } from './studioBudget.js';

/**
 * §5.13 (T-4)(T-7) — 미리보기를 DOM 무대(`useStagePreview`)로 세워야 하는 문서인가: 코드 컴포지션 · 3D 모델 · 편집 원본이 있는 그림은
 * canvas2d 가 그리지 못한다. 스튜디오 미리보기와 캔버스 노드 재생(§5.4 #36 (J) ⑦)이 같은 판정을 쓴다.
 */
export function docNeedsStage(doc: VideoDoc): boolean {
  return docHasCompositions(doc) || doc.tracks.some((track) => track.items.some((item) =>
    item.kind === 'model' || (item.kind === 'image' && !!doc.assets[item.assetId ?? '']?.creationSource)));
}

/**
 * Browser hints are coarse: unknown devices use the bounded middle tier. Export is unaffected.
 * §5.13 (Y) 40-11 — 수는 메모리 예산 표(`studioBudget.ts`)가 정한다(한 곳에서 센다).
 */
export function previewWarmPolicy(hints: DeviceHints = typeof navigator === 'undefined' ? {} : navigator): StageWarmOptions {
  return studioBudget(hints).warm;
}

/**
 * §5.13 (Y) 40-3 ③ — 미리보기가 공급자에게 청할 프레임 방식. 재생 중이면 순서대로(`play`), 멈춘 채 연달아 옮기면(끌기 —
 * 직전 옮김에서 `SCRUB_WINDOW_MS` 안) 가까운 키프레임 먼저(`scrub`), 그 밖은 정확한 한 장(`exact`). 끌기가 멈추면 미리보기가 정확한
 * 프레임으로 한 번 더 그린다(`SCRUB_SETTLE_MS` 뒤).
 */
export const SCRUB_WINDOW_MS = 150;
export const SCRUB_SETTLE_MS = 200;

export function previewFrameMode(opts: { readonly playing: boolean; readonly sinceLastMoveMs: number }): 'play' | 'scrub' | 'exact' {
  if (opts.playing) return 'play';
  return opts.sinceLastMoveMs < SCRUB_WINDOW_MS ? 'scrub' : 'exact';
}
