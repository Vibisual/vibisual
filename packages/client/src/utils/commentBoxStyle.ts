/**
 * Comment Box 색상 유틸 — 가독성 있는 텍스트 색(흰/검) 자동 결정.
 * hex('#RRGGBB') 입력 전용. 사용자가 `textColor` 를 지정했으면 그 값이 우선이고,
 * 이 함수는 미지정 시 자동 fallback 용도.
 */
export function pickReadableTextColor(bgHex: string): string {
  const hex = bgHex.replace('#', '');
  if (hex.length !== 6) return '#0F172A'; // 기본 slate-900
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  // 상대 휘도(YIQ 근사) — 128 이상이면 어두운 글자, 아니면 밝은 글자.
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 140 ? '#0F172A' : '#F8FAFC';
}
