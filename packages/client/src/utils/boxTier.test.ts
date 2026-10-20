import { describe, expect, it } from 'vitest';
// CSS 원문은 `?raw` 로는 빈 문자열이 온다 — 테스트 설정의 가상 모듈이 대신 읽어 넘긴다(vitest.config.ts).
import cssSource from 'virtual:vibisual-css-source/index';

import { BOX_TIER, boxTierOf, boxTierTokens, isCompactTier } from './boxTier.js';

describe('boxTierOf — 상자 폭 → 등급', () => {
  it('못 잰 폭(0·음수·NaN)은 unmeasured — 넓은 배치로 둔다', () => {
    expect(boxTierOf(0)).toBe('unmeasured');
    expect(boxTierOf(-5)).toBe('unmeasured');
    expect(boxTierOf(Number.NaN)).toBe('unmeasured');
  });

  it('폰 폭(320·390·430)은 narrow', () => {
    expect(boxTierOf(320)).toBe('narrow');
    expect(boxTierOf(390)).toBe('narrow');
    expect(boxTierOf(430)).toBe('narrow');
  });

  it('경계: 639 는 narrow, 640 부터 compact, 1023 까지 compact, 1024 부터 regular', () => {
    expect(boxTierOf(BOX_TIER.NARROW_BELOW - 1)).toBe('narrow');
    expect(boxTierOf(BOX_TIER.NARROW_BELOW)).toBe('compact');
    expect(boxTierOf(BOX_TIER.COMPACT_BELOW - 1)).toBe('compact');
    expect(boxTierOf(BOX_TIER.COMPACT_BELOW)).toBe('regular');
  });

  it('큰 모니터: 1599 는 regular, 1600 부터 wide', () => {
    expect(boxTierOf(BOX_TIER.WIDE_FROM - 1)).toBe('regular');
    expect(boxTierOf(BOX_TIER.WIDE_FROM)).toBe('wide');
    expect(boxTierOf(3840)).toBe('wide');
  });
});

describe('boxTierTokens — data-box 토큰', () => {
  it('narrow 는 compact 를 겸한다(box-compact: 만 적어도 폰 폭까지 접힌다)', () => {
    expect(boxTierTokens('narrow').split(' ').sort()).toEqual(['compact', 'narrow']);
    expect(boxTierTokens('compact')).toBe('compact');
    expect(boxTierTokens('wide')).toBe('wide');
  });

  it('regular·unmeasured 는 빈 토큰 — 어떤 변형도 걸리지 않는다', () => {
    expect(boxTierTokens('regular')).toBe('');
    expect(boxTierTokens('unmeasured')).toBe('');
  });

  it('isCompactTier 는 narrow·compact 만 참', () => {
    expect(isCompactTier('narrow')).toBe(true);
    expect(isCompactTier('compact')).toBe(true);
    expect(isCompactTier('regular')).toBe(false);
    expect(isCompactTier('wide')).toBe(false);
    expect(isCompactTier('unmeasured')).toBe(false);
  });
});

describe('index.css 변형 — 토큰 이름이 판정과 같다', () => {
  // CSS 는 숫자를 모르고 토큰 이름만 안다. 이름이 어긋나면 클래스는 빌드되는데 아무 데도 안 걸린다(조용한 무동작).
  it.each(['compact', 'narrow', 'wide'])('box-%s 변형이 [data-box~="%s"] 를 읽는다', (token) => {
    expect(cssSource).toContain(`@custom-variant box-${token} (&:where([data-box~="${token}"] *));`);
  });

  it('container-type(@container)은 앱 화면 뿌리에 쓰지 않는다 — fixed 자손을 가둔다(Chromium 126 실측)', () => {
    expect(cssSource).not.toMatch(/container-type\s*:/);
  });
});
