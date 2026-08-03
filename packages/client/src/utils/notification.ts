import { COMPLETION_CHIME_DEDUPE_MS } from '@vibisual/shared';

/** 창 간 완료음 재생권 교환에 쓰는 localStorage 키. */
const CHIME_CLAIM_KEY = 'vibisual:lastCompletionChimeAt';

/** 브라우저 알림 권한 요청 (최초 1회) */
export function requestNotificationPermission(): void {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

/** 브라우저 알림 표시 — 클릭 시 onCick 콜백 실행 */
export function showBrowserNotification(
  title: string,
  body: string,
  onClick?: () => void,
): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }
  try {
    // TODO: replace with icon: '/icon.png' once packages/client/public/icon.png is added (currently only favicon.svg exists)
    const n = new Notification(title, {
      body,
      icon: undefined,
      silent: true,
    });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {
    // Notification not supported
  }
}

/**
 * 완료음 재생권을 이 창이 가져간다 — 여러 창이 같은 완료에 동시에 울리는 것을 막는다.
 *
 * v3.76. 메인·별창·오버레이 셸이 각각 WS 를 구독하므로 완료 한 건에 소리가 겹쳐 들렸다.
 * localStorage 는 같은 origin 의 창들이 공유하므로 먼저 온 창만 참을 받는다. 접근이 막히면
 * 종전대로 재생(fail-open) — 소리가 겹치는 것이 아예 안 울리는 것보다 낫다.
 */
export function claimCompletionChime(now: number = Date.now()): boolean {
  try {
    const prev = Number(window.localStorage.getItem(CHIME_CLAIM_KEY) ?? '0');
    if (Number.isFinite(prev) && now - prev < COMPLETION_CHIME_DEDUPE_MS) return false;
    window.localStorage.setItem(CHIME_CLAIM_KEY, String(now));
    return true;
  } catch {
    return true;
  }
}

/** 완료 알림 — 2음 상승 차임 (E5→G5) */
export function playCompletionChime(): void {
  try {
    const ctx = new AudioContext();

    const playNote = (
      freq: number,
      startOffset: number,
      duration: number,
    ): void => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      const t = ctx.currentTime + startOffset;
      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      osc.start(t);
      osc.stop(t + duration);
    };

    playNote(659.25, 0, 0.2);
    playNote(783.99, 0.15, 0.35);
  } catch {
    // Audio not available — silent fallback
  }
}
