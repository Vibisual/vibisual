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
