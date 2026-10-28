/**
 * §5.1 #2-1 (G) ① — "기준을 넘어 일부러 안 구웠다"(`null` = 못 구웠다와 구분) — 파일 버블이 "미리보기 생략" 툴팁을 단다(굽는 함수만 아는 기준도).
 * 코어는 `kind` 만 본다.
 */
export const THUMB_SKIPPED_TOO_LARGE = Object.freeze({ kind: 'skipped', reason: 'tooLarge' } as const);

export type AppThumbnailSkip = typeof THUMB_SKIPPED_TOO_LARGE;

/** 굽는 함수의 결과가 "기준보다 커서 굽지 않았다"인가. */
export function isThumbnailSkip(value: unknown): value is AppThumbnailSkip {
  return typeof value === 'object' && value !== null && (value as { readonly kind?: unknown }).kind === 'skipped';
}
