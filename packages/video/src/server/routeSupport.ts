/** 라우트 파일들이 함께 쓰는 작은 순수 헬퍼. */

/** 파일명으로 쓸 수 없는 글자를 막는다 — docId 가 경로를 벗어나지 못하게. */
export function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

/** 초 → 파일 이름에 쓰는 시각(`1.50`). */
export function secondsTag(t: number): string {
  return (Number.isFinite(t) ? Math.max(0, t) : 0).toFixed(2);
}

/** 숫자 쿼리 값. 없거나 숫자가 아니면 기본값. */
export function numQuery(raw: unknown, fallback: number): number {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}
