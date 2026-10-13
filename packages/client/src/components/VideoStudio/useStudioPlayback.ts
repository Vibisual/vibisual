import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { resolveTimeline, type VideoDoc } from '@vibisual/video';

/**
 * §5.13 (V) 37-1 — 미리보기 재생 머리·재생·반복.
 *
 * 재생은 실제 시간에 맞춰 재생 머리를 움직인다(벽시계 기준 — 프레임을 다 못 그려도 시간은 어긋나지 않는다). 끝에 닿으면 마지막
 * 프레임에 멈춘다. 종전에는 문서가 바뀔 때마다 재생이 멈췄는데, 이제 AI 가 몇 초마다 고치므로 **다른 문서로 갈아탈 때만**
 * 멈추고, 같은 문서의 판본이 바뀌면 재생 머리만 새 길이 안으로 당긴다.
 */
export interface StudioPlayback {
  readonly playhead: number;
  readonly playing: boolean;
  readonly loop: boolean;
  readonly duration: number;
  readonly fps: number;
  readonly lastFrameAt: number;
  readonly seek: (at: number) => void;
  readonly setPlaying: (playing: boolean) => void;
  readonly togglePlay: () => void;
  readonly toggleLoop: () => void;
}

export function useStudioPlayback(doc: VideoDoc | null, onStart?: () => void): StudioPlayback {
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const duration = useMemo(() => (doc ? resolveTimeline(doc).duration : 0), [doc]);
  const fps = doc?.fps && doc.fps > 0 ? doc.fps : 30;
  const lastFrameAt = doc ? Math.max(0, duration - 1 / fps) : 0;
  const docId = doc?.id ?? '';
  // 효과·손잡이가 지금 값을 읽는 자리(갱신 함수 안에서 다른 상태를 바꾸지 않으려고).
  const now = useRef({ playing, playhead, lastFrameAt });
  now.current = { playing, playhead, lastFrameAt };

  useEffect(() => { setPlaying(false); setPlayhead(0); }, [docId]);
  useEffect(() => { setPlayhead((at) => Math.min(at, lastFrameAt)); }, [lastFrameAt]);

  useEffect(() => {
    if (!playing || duration <= 0) return;
    const startedAt = performance.now();
    const from = now.current.playhead;
    let raf = 0;
    const tick = (): void => {
      const elapsed = (performance.now() - startedAt) / 1000;
      const next = loop ? (from + elapsed) % duration : from + elapsed;
      if (!loop && next >= lastFrameAt) {
        setPlayhead(lastFrameAt);
        setPlaying(false);
        return;
      }
      setPlayhead(Math.min(lastFrameAt, Math.floor(next * fps) / fps));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // 재생 머리를 의존성에 넣으면 매 프레임 다시 걸린다 — 시작점만 잡는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, loop, docId]);

  const seek = useCallback((at: number): void => {
    setPlaying(false);
    setPlayhead(Math.max(0, Math.min(lastFrameAt, Math.round(at * fps) / fps)));
  }, [fps, lastFrameAt]);

  /** 끝에서 다시 누르면 처음부터. */
  const togglePlay = useCallback((): void => {
    if (duration <= 0) return;
    const s = now.current;
    if (!s.playing) {
      onStart?.();
      if (s.playhead >= s.lastFrameAt) setPlayhead(0);
    }
    setPlaying(!s.playing);
  }, [duration, onStart]);

  const toggleLoop = useCallback((): void => setLoop((v) => !v), []);
  return { playhead, playing, loop, duration, fps, lastFrameAt, seek, setPlaying, togglePlay, toggleLoop };
}
