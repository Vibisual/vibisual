import { useCallback, useEffect, useRef, useState } from 'react';
import { classifyStudioError, type StudioErrorKind } from './studioErrors.js';

/**
 * §5.13 (V) 37-1 — 스튜디오 알림. 오류는 사람이 읽는 말 한 줄 + [자세히](원문은 접어 둔다), 성공은 잠깐 떴다 사라진다.
 * 종전 amber 상태줄을 대신한다. 같은 말이 연달아 오면 한 장으로 접는다(폴링이 같은 오류를 2초마다 내도 쌓이지 않게).
 */
export type StudioToast =
  | { readonly id: number; readonly tone: 'error'; readonly kind: StudioErrorKind; readonly detail: string }
  | { readonly id: number; readonly tone: 'success' | 'info'; readonly key: string; readonly values?: Readonly<Record<string, string | number>> };

/** 성공·안내 알림이 떠 있는 시간(ms). */
const TOAST_SUCCESS_MS = 2400;
/** 한꺼번에 보이는 알림 상한. */
const TOAST_MAX = 3;

export interface StudioToasts {
  readonly toasts: readonly StudioToast[];
  readonly error: (err: unknown) => void;
  readonly success: (key: string, values?: Readonly<Record<string, string | number>>) => void;
  readonly info: (key: string, values?: Readonly<Record<string, string | number>>) => void;
  readonly dismiss: (id: number) => void;
}

export function useStudioToasts(): StudioToasts {
  const [toasts, setToasts] = useState<readonly StudioToast[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  useEffect(() => () => { for (const t of timers.current.values()) clearTimeout(t); }, []);

  const dismiss = useCallback((id: number): void => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((toast: StudioToast): void => {
    setToasts((prev) => {
      const same = prev.find((t) => JSON.stringify({ ...t, id: 0 }) === JSON.stringify({ ...toast, id: 0 }));
      if (same) return prev;
      return [...prev, toast].slice(-TOAST_MAX);
    });
    if (toast.tone !== 'error') timers.current.set(toast.id, setTimeout(() => dismiss(toast.id), TOAST_SUCCESS_MS));
  }, [dismiss]);

  const error = useCallback((err: unknown): void => {
    const e = classifyStudioError(err);
    push({ id: ++seq.current, tone: 'error', kind: e.kind, detail: e.detail });
  }, [push]);
  const success = useCallback((key: string, values?: Readonly<Record<string, string | number>>): void => {
    push({ id: ++seq.current, tone: 'success', key, ...(values ? { values } : {}) });
  }, [push]);
  const info = useCallback((key: string, values?: Readonly<Record<string, string | number>>): void => {
    push({ id: ++seq.current, tone: 'info', key, ...(values ? { values } : {}) });
  }, [push]);
  return { toasts, error, success, info, dismiss };
}
