/** §5.5 #17-27 ⑭ 손잡이 줄의 이미지 한 줄 요약(순수). 단위(B/KB/MB)는 번역하지 않는다. */

const UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/** 사람이 읽는 크기. 1024 진법, 소수 한 자리(정수 자리가 셋이면 반올림해 자릿수를 줄인다). */
export function formatImageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
}

/** `1309 × 825 · 131.6 KB`. 그림을 아직 못 읽었으면 크기만 — `0 × 0` 으로 지어내지 않는다. */
export function imageMetaLabel(natural: { w: number; h: number } | null, bytes: number): string {
  const size = formatImageBytes(bytes);
  if (!natural || natural.w <= 0 || natural.h <= 0) return size;
  return `${natural.w} × ${natural.h} · ${size}`;
}
