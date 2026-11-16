import { useCallback, useEffect, useState, type RefObject } from 'react';

/**
 * §5.13 (V) 37-24 (E) — 요소 하나를 화면 가득 띄운다(표준 Fullscreen API — Electron 세 OS·브라우저가 같다). API 가 없으면
 * `supported` 가 거짓이고 단추는 서지 않는다. `Esc` 로 나가는 것은 브라우저 몫이라 `fullscreenchange` 로 상태를 따라간다.
 */
export interface PreviewFullscreen {
  readonly active: boolean;
  readonly supported: boolean;
  readonly toggle: () => void;
}

export function usePreviewFullscreen(ref: RefObject<HTMLElement | null>): PreviewFullscreen {
  const [active, setActive] = useState(false);
  const supported = typeof document !== 'undefined' && document.fullscreenEnabled === true;
  useEffect(() => {
    if (!supported) return undefined;
    const sync = (): void => setActive(ref.current !== null && document.fullscreenElement === ref.current);
    sync();
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [ref, supported]);
  const toggle = useCallback((): void => {
    const el = ref.current;
    if (!supported || !el) return;
    // 거절(사용자 몸짓 밖 · 정책)은 조용히 넘긴다 — 상태는 `fullscreenchange` 만 믿는다.
    if (document.fullscreenElement === el) void document.exitFullscreen().catch(() => undefined);
    else void el.requestFullscreen().catch(() => undefined);
  }, [ref, supported]);
  return { active, supported, toggle };
}
