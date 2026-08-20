/**
 * editorImageMeta.ts — §5.5 #17-27 ⑭ 손잡이 줄에 적을 **이미지 한 줄 요약**.
 *
 * 편집창이 이진 파일에 대해 처음으로 "무엇인지"를 말하는 자리다(종전에는 "바이너리 파일" 한 마디가
 * 전부였다). 순수 함수라 React·DOM 의존이 없고 단위 테스트로 고정한다 — `codeHighlight.ts` 와 같은 결.
 *
 * 단위(B/KB/MB)는 어느 언어에서도 같은 기호라 번역하지 않는다.
 */

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

/**
 * 손잡이 줄 한 조각 — `1309 × 825 · 131.6 KB`.
 *
 * 그림을 아직 못 읽었으면(`natural` 이 null) 크기만 적는다. 모르는 값을 `0 × 0` 으로 지어내지 않는다.
 */
export function imageMetaLabel(natural: { w: number; h: number } | null, bytes: number): string {
  const size = formatImageBytes(bytes);
  if (!natural || natural.w <= 0 || natural.h <= 0) return size;
  return `${natural.w} × ${natural.h} · ${size}`;
}
