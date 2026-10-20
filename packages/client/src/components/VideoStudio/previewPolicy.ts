import type { StageWarmOptions } from '@vibisual/video/render';

import { studioBudget, type DeviceHints } from './studioBudget.js';

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
