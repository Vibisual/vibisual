import { useEffect, useRef } from 'react';

import type { PlayheadClock } from './playheadClock.js';
import type { PlaybackTiming } from './useStudioPlayback.js';
import { previewFrameMode, SCRUB_SETTLE_MS } from './previewPolicy.js';
import { setStudioBusy } from './studioIdle.js';

/**
 * §5.13 (X) 39-6 · (Y) 40-3 ③ · (Z) 41-2 — 미리보기는 재생 시계를 따라 그린다: 재생 중이면 순서대로, 멈춘 채 연달아 옮기면(끌기) 가까운
 * 키프레임 먼저, 손을 멈추면 정확한 한 장으로 다시. 무대(컴포지션)면 그리기 전에 재생 기준을 맞추고, 멈추면 무대가 그 자리를 정확한
 * 한 장으로 세운다. 스튜디오 미리보기와 캔버스 노드 재생(§5.4 #36 (J) ⑦)이 이 한 벌을 쓴다.
 */

/** §5.13 (Y) 40-9 — 그림이 시계보다 뒤처진 정도(초): 그리는 중일 때만, 마지막으로 그린 시각과의 차(처음 한 장 전에는 모른다 — 0). */
export function previewFrameLag(queue: { readonly drawnAt: () => number | null; readonly busy: () => boolean } | null | undefined, at: number): number {
  if (!queue || !queue.busy()) return 0;
  const drawnAt = queue.drawnAt();
  return drawnAt === null ? 0 : Math.max(0, at - drawnAt);
}

export interface PreviewDrawLoopOptions {
  readonly enabled: boolean;
  readonly clock: PlayheadClock;
  readonly playing: boolean;
  /** DOM 무대(컴포지션)로 그리는가. */
  readonly stage: boolean;
  readonly syncPlay: (timing: PlaybackTiming | null) => void;
  readonly timing: () => PlaybackTiming | null;
  /** 그 시각을 그린다(그리는 중 들어온 시각은 마지막 하나만 — 줄이 접는다). */
  readonly requestDraw: (at: number) => Promise<boolean>;
  readonly media: { readonly setFrameMode: (mode: 'play' | 'scrub' | 'exact') => void } | null | undefined;
  readonly onError: (error: unknown) => void;
  /** 바뀌면 지금 자리를 다시 그린다(문서 · 그리기 판 · 그림판 크기 — 부르는 자리마다 길이가 같아야 한다). */
  readonly redraw: readonly unknown[];
}

export function usePreviewDrawLoop(o: PreviewDrawLoopOptions): void {
  const playingRef = useRef(o.playing);
  playingRef.current = o.playing;
  const onErrorRef = useRef(o.onError);
  onErrorRef.current = o.onError;
  const { enabled, clock, playing, stage, syncPlay, timing, requestDraw, media } = o;
  useEffect(() => {
    if (!stage || !playing) syncPlay(null);
  }, [stage, playing, syncPlay]);
  useEffect(() => {
    if (!enabled) return undefined;
    let lastMoveAt = -Infinity;
    let settle: ReturnType<typeof setTimeout> | null = null;
    let scrubbing = false;
    const endScrub = (): void => { if (scrubbing) { scrubbing = false; setStudioBusy('scrubbing', false); } };
    const draw = (): void => {
      // §5.13 (Z) 41-2 — 그리기 전에 재생 기준을 맞춘다(재생 중이면 무대의 seek 는 배치만 하고 바로 끝난다).
      if (stage) syncPlay(playingRef.current ? timing() : null);
      void requestDraw(clock.get()).catch((error: unknown) => onErrorRef.current(error));
    };
    const onMove = (): void => {
      const now = performance.now();
      const mode = previewFrameMode({ playing: playingRef.current, sinceLastMoveMs: now - lastMoveAt });
      lastMoveAt = now;
      media?.setFrameMode(mode);
      if (mode === 'scrub') {
        // 40-10 ④ — 끄는 동안 배경 일이 쉰다.
        if (!scrubbing) { scrubbing = true; setStudioBusy('scrubbing', true); }
        if (settle !== null) clearTimeout(settle);
        settle = setTimeout(() => {
          settle = null;
          endScrub();
          media?.setFrameMode(playingRef.current ? 'play' : 'exact');
          draw();
        }, SCRUB_SETTLE_MS);
      }
      draw();
    };
    media?.setFrameMode(playingRef.current ? 'play' : 'exact');
    draw();
    const off = clock.subscribe(onMove);
    return () => { off(); if (settle !== null) clearTimeout(settle); endScrub(); };
    // `redraw` 는 부르는 자리의 다시 그릴 열쇠들이다(길이가 같다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, requestDraw, clock, media, stage, syncPlay, timing, ...o.redraw]);
}
