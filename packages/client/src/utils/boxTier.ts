/**
 * 상자 폭 등급 — **뷰포트가 아니라 상자 폭**으로 칸을 접는 자리(앱 창·별창)의 판정. 기준값은 **여기 한 곳**(CSS 는 토큰 이름만 안다).
 * `@container` 를 쓰지 않는다 — Chromium 126(Electron 31)에서 `container-type` 상자는 `position: fixed` 자손을 자기 기준으로 세워 메뉴가 밀린다(2026-10-17 실측).
 * 폭은 `hooks/useBoxTier.ts`(ResizeObserver)가 재 `data-box` 토큰으로 달고, `box-compact:`·`box-narrow:`·`box-wide:`(`index.css`)가 읽는다.
 */
export const BOX_TIER = {
  /** 이 폭(px) 미만이면 `narrow` — 폰 한 손 폭. 칸을 한 줄로 쌓는다. */
  NARROW_BELOW: 640,
  /** 이 폭(px) 미만이면 `compact` — 반쪽 화면·태블릿. 옆 칸을 서랍·탭·아래로 옮긴다. */
  COMPACT_BELOW: 1024,
  /** 이 폭(px) 이상이면 `wide` — 큰 모니터. 읽는 글의 줄 길이를 묶거나 칸을 더 연다. */
  WIDE_FROM: 1600,
} as const;

/** `unmeasured` = 아직 못 쟀다(첫 프레임·관찰자 없는 환경) — 판정하는 쪽은 넓은 배치로 둔다. */
export type BoxTier = 'unmeasured' | 'narrow' | 'compact' | 'regular' | 'wide';

/** 폭(px) → 등급. 0 이하·NaN 은 못 잰 것으로 본다. */
export function boxTierOf(width: number): BoxTier {
  if (!(width > 0)) return 'unmeasured';
  if (width < BOX_TIER.NARROW_BELOW) return 'narrow';
  if (width < BOX_TIER.COMPACT_BELOW) return 'compact';
  if (width >= BOX_TIER.WIDE_FROM) return 'wide';
  return 'regular';
}

/**
 * 등급 → `data-box` 에 다는 토큰(공백으로 나눈 목록 — CSS 는 `~=` 로 읽는다).
 * `narrow` 는 `compact` 를 **겸한다** — 더 좁으면 덜 좁을 때의 접힘도 전부 받아야 하기 때문이다
 * (그래서 `box-compact:` 만 적어도 폰 폭까지 함께 접힌다).
 */
export function boxTierTokens(tier: BoxTier): string {
  switch (tier) {
    case 'narrow': return 'narrow compact';
    case 'compact': return 'compact';
    case 'wide': return 'wide';
    default: return '';
  }
}

/** 이 등급이 "옆 칸을 접어야 하는 폭"인가 — JS 로 배치를 고르는 쪽(탭 전환 등)이 쓴다. */
export function isCompactTier(tier: BoxTier): boolean {
  return tier === 'narrow' || tier === 'compact';
}
