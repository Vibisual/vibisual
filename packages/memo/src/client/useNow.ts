import { useEffect, useState } from 'react';

/** 상대 시각 표시가 흐르도록 주기마다 현재 시각을 갱신한다. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
