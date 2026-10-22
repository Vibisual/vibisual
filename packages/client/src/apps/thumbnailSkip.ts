/**
 * §5.1 #2-1 (G) ① — 굽는 함수가 **"앱 성능 기준보다 커서 굽지 않았다"** 를 말하는 값.
 *
 * `null` 은 "못 구웠다"(읽지 못하는 형식 · 실패)이고, 이 값은 "구울 수는 있지만 기준을 넘어 일부러 굽지 않았다"다. 둘을 갈라
 * 돌려주면 미리보기 기억 장소가 그 이유를 기억하고 파일 버블이 "미리보기 생략" 툴팁을 단다 — 그림의 픽셀 상한처럼 **굽는
 * 함수만 아는 기준**도 툴팁이 말한다(2026-10-21 — 종전에는 그 경우도 `null` 이라 아이콘만 남고 이유가 없었다).
 * 코어는 앱 이름을 모른다 — 앱의 굽는 함수가 이 값을 돌려주고, 코어는 모양(`kind`)만 본다(§5.13 (P-4)).
 */
export const THUMB_SKIPPED_TOO_LARGE = Object.freeze({ kind: 'skipped', reason: 'tooLarge' } as const);

export type AppThumbnailSkip = typeof THUMB_SKIPPED_TOO_LARGE;

/** 굽는 함수의 결과가 "기준보다 커서 굽지 않았다"인가. */
export function isThumbnailSkip(value: unknown): value is AppThumbnailSkip {
  return typeof value === 'object' && value !== null && (value as { readonly kind?: unknown }).kind === 'skipped';
}
