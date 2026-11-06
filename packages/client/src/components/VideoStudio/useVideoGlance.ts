import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { onAppEvent } from '../../apps/appEvents.js';
import { STUDIO_APP_ID } from './studioAppId.js';
import { glanceKey, peekGlance, refreshGlance, subscribeGlance, type VideoGlanceView } from './videoGlance.js';

/** 판본만 묻는 간격(ms), 보이는 노드만. §5.13 (Y) 40-7 ② — 주 신호는 서버 앱 알림이고 이건 소켓이 끊겼을 때의 안전망. */
export const GLANCE_POLL_MS = 15_000;

/**
 * §5.4 #36 (J) — 노드 화면이 구독하는 훑어보기 재료(`videoGlance.ts` 공용 기억). 마운트된 동안만 묻는다 — 앱 알림이 오면 바로,
 * 아니면 `GLANCE_POLL_MS` 마다(창이 숨었으면 쉰다). 구슬 줄 읽기가 먼저 받아 두었으면 그것을 바로 보인다.
 */
export function useVideoGlance(project: string, docId: string): VideoGlanceView {
  const key = glanceKey(project, docId);
  const subscribe = useCallback((listener: () => void) => subscribeGlance(project, docId, listener), [project, docId]);
  const get = useCallback(() => peekGlance(project, docId), [project, docId]);
  const view = useSyncExternalStore(subscribe, get, get);

  useEffect(() => {
    const tick = (): void => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void refreshGlance(project, docId);
    };
    void refreshGlance(project, docId);
    const timer = setInterval(tick, GLANCE_POLL_MS);
    const off = onAppEvent(STUDIO_APP_ID, (event) => { if (event.key === docId) void refreshGlance(project, docId); });
    return () => { clearInterval(timer); off(); };
  }, [key, project, docId]);

  return view;
}

/** `key` 가 `ms` 동안 그대로면 true — 에이전트가 연달아 고치는 동안 무거운 일(대표 프레임 굽기)을 미룬다. */
export function useSettled(key: string, ms: number): boolean {
  const [settled, setSettled] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(key), ms);
    return () => clearTimeout(timer);
  }, [key, ms]);
  return settled === key;
}

/** 일정 간격으로 다시 그리기 — "2분 전" 같은 때 글자가 낡지 않게(마운트된 동안만). */
export function useNowTick(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}
