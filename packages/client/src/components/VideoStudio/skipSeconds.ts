/** §5.13 (V) 37-24 (A)(B) — 건너뛰기 간격(초). 값 다듬기는 순수(시험 고정). 창 세션 상태다 — 저장하지 않는다(§3.2). */
export const SKIP_SECONDS = {
  initial: 5,
  min: 0.1,
  max: 600,
  presets: [5, 10, 30],
} as const;

/** 칸에 적은 값 → 간격. 못 읽거나 0 이하면 `fallback`. 범위 안으로 묶고 소수 둘째 자리까지 남긴다. */
export function normalizeSkipSeconds(raw: string | number, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw.trim().replace(',', '.'));
  if (raw === '' || !Number.isFinite(n) || n <= 0) return fallback;
  return Math.round(Math.min(SKIP_SECONDS.max, Math.max(SKIP_SECONDS.min, n)) * 100) / 100;
}

/** 화면에 적는 수 — `5` · `2.5`(끝자리 0 은 뗀다). */
export function formatSkipSeconds(seconds: number): string {
  return String(Math.round(seconds * 100) / 100);
}

export function isSkipPreset(seconds: number): boolean {
  return (SKIP_SECONDS.presets as readonly number[]).includes(seconds);
}
