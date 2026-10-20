/**
 * 상자 폭 등급 — 앱 창·별창처럼 **뷰포트가 아니라 그 상자의 폭**으로 칸을 접어야 하는 자리의 판정.
 *
 * 왜 `@container`(CSS 컨테이너 쿼리)가 아닌가: Chromium 126(Electron 31)에서 `container-type` 을 단 상자는
 * `position: fixed` 자손을 화면이 아니라 **자기 기준**으로 세운다(2026-10-17 실측 — `fixed; left:0` 이 화면 0 이
 * 아니라 상자 왼쪽 200px 에 섰다). 앱 화면 안에서 포털 없이 fixed 로 뜨는 메뉴·팝오버가 창 위치만큼 밀린다.
 * 그래서 폭은 `ResizeObserver` 로 재고(`hooks/useBoxTier.ts`), 결과를 `data-box` 토큰으로 달아 Tailwind 변형
 * (`box-compact:` · `box-narrow:` · `box-wide:` — `index.css`)이 읽게 한다.
 *
 * 기준값은 **여기 한 곳**이다 — CSS 는 토큰 이름만 안다(숫자를 두 군데 적으면 한쪽만 고쳐져 어긋난다).
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
