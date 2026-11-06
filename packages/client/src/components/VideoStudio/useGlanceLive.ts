import { useCallback, useEffect, useRef, useState } from 'react';

import { claimCanvasPlayback } from './canvasPlayback.js';
import type { CanvasPlayerControl, CanvasPlayerState } from './VideoCanvasPlayer.js';

/**
 * §5.4 #36 (J) ⑦ — 노드 화면의 라이브 재생 상태: 판을 세웠나(`mounted`) · 판이 알린 상태·손잡이 · 음소거(휘발). 세울 때 캔버스 재생
 * 자리를 잡고(`claimCanvasPlayback` — 다른 노드가 잡으면 내려 포스터로), 끝·멈춤 요청·언마운트에 놓는다.
 */

const IDLE: CanvasPlayerState = { playing: false, ready: false, preparing: false };

export interface GlanceLive {
  readonly mounted: boolean;
  readonly startAt: number;
  readonly state: CanvasPlayerState;
  readonly control: CanvasPlayerControl | null;
  readonly muted: boolean;
  readonly start: (at: number) => void;
  readonly stop: () => void;
  readonly toggleMute: () => void;
  readonly onState: (state: CanvasPlayerState) => void;
  readonly onControl: (control: CanvasPlayerControl | null) => void;
}

export function useGlanceLive(): GlanceLive {
  const [mounted, setMounted] = useState(false);
  const [startAt, setStartAt] = useState(0);
  const [state, setState] = useState<CanvasPlayerState>(IDLE);
  const [control, setControl] = useState<CanvasPlayerControl | null>(null);
  const [muted, setMuted] = useState(false);
  const release = useRef<(() => void) | null>(null);

  const unmount = useCallback((): void => {
    setMounted(false);
    setControl(null);
    setState(IDLE);
  }, []);

  const stop = useCallback((): void => {
    release.current?.();
    release.current = null;
    unmount();
  }, [unmount]);

  const start = useCallback((at: number): void => {
    release.current?.();
    release.current = claimCanvasPlayback(() => {
      release.current = null;
      unmount();
    });
    setStartAt(at);
    setMounted(true);
  }, [unmount]);

  useEffect(() => () => {
    release.current?.();
    release.current = null;
  }, []);

  const toggleMute = useCallback((): void => setMuted((m) => !m), []);
  return { mounted, startAt, state, control, muted, start, stop, toggleMute, onState: setState, onControl: setControl };
}
