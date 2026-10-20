import type { StageWarmOptions } from '@vibisual/video/render';

/**
 * §5.13 (Y) 40-11 — 스튜디오 **메모리 예산을 한 곳에서** 센다. 기기 등급(코어 수 · `navigator.deviceMemory`)마다 상한을 정하고, 소리
 * 조각 · 실사 읽개 · `UrlSource` 캐시 · 대표 프레임 · 데우기 · 쉬는 숨은 창이 모두 이 표를 읽는다. 이 PC(32코어 · 64GB) 실측으로 정하지
 * 않는다 — 4코어 · 8GB 등급에서도 무너지지 않아야 한다(시험이 세 등급을 고정한다).
 *
 * `deviceMemory` 는 Chromium 이 8 을 넘게 알려 주지 않는다(8GB 이상이면 8) — 그래서 높은 등급의 문턱은 코어 수가 정한다.
 */

export type DeviceTier = 'low' | 'mid' | 'high';

export interface DeviceHints {
  readonly hardwareConcurrency?: number;
  readonly deviceMemory?: number;
}

export interface StudioBudget {
  readonly tier: DeviceTier;
  /** 디코딩한 소리 조각 LRU(바이트). */
  readonly audioChunkBytes: number;
  /** 창 하나에 동시에 살려 둘 실사 읽개(디코더) 수. */
  readonly footageReaders: number;
  /** 미리보기 실사의 그리기 폭 상한(px). */
  readonly footageWidthMax: number;
  /** 모든 소재의 `UrlSource` 캐시 합(바이트) — 소재 수로 나눈다(`urlCacheBytesFor`). */
  readonly urlCacheTotalBytes: number;
  /** 장면 대표 프레임 LRU(바이트 — 39-4). */
  readonly chapterThumbBytes: number;
  /** §5.13 (Y) 40-10 ① — 실사 아이템 키프레임 포스터(바이트 — 480px 판 한 장 약 0.5MB). */
  readonly footagePosterBytes: number;
  /** 미리보기 무대 데우기(39-5 · 40-8). */
  readonly warm: StageWarmOptions;
  /** 일감이 끝난 뒤 쉬게 둘 오프스크린 렌더 창 수(0 이면 닫는다 — 40-7 ③). */
  readonly offscreenIdleWindows: number;
}

const MiB = 1024 * 1024;

/** 기기 등급. 모르면(값이 없으면) 가운데 — 낮게 잡아 느리게 하지도, 높게 잡아 무너지게 하지도 않는다. */
export function deviceTier(hints: DeviceHints): DeviceTier {
  const cores = hints.hardwareConcurrency;
  const memory = hints.deviceMemory;
  const limited = (cores !== undefined && cores > 0 && cores <= 4) || (memory !== undefined && memory > 0 && memory <= 4);
  if (limited) return 'low';
  if (cores !== undefined && cores >= 12 && memory !== undefined && memory >= 8) return 'high';
  return 'mid';
}

const TABLE: Readonly<Record<DeviceTier, StudioBudget>> = {
  low: {
    tier: 'low',
    audioChunkBytes: 32 * MiB,
    footageReaders: 2,
    footageWidthMax: 1280,
    urlCacheTotalBytes: 16 * MiB,
    chapterThumbBytes: 24 * MiB,
    footagePosterBytes: 8 * MiB,
    warm: { aheadSeconds: 2, aheadMax: 1, keepParked: 0, parkedTtlMs: 5_000 },
    offscreenIdleWindows: 0,
  },
  mid: {
    tier: 'mid',
    audioChunkBytes: 64 * MiB,
    footageReaders: 3,
    footageWidthMax: 1920,
    urlCacheTotalBytes: 32 * MiB,
    chapterThumbBytes: 24 * MiB,
    footagePosterBytes: 12 * MiB,
    warm: { aheadSeconds: 3, aheadMax: 1, keepParked: 1, parkedTtlMs: 15_000 },
    offscreenIdleWindows: 1,
  },
  high: {
    tier: 'high',
    audioChunkBytes: 96 * MiB,
    footageReaders: 4,
    footageWidthMax: 1920,
    urlCacheTotalBytes: 64 * MiB,
    chapterThumbBytes: 24 * MiB,
    footagePosterBytes: 16 * MiB,
    warm: { aheadSeconds: 5, aheadMax: 2, keepParked: 2, parkedTtlMs: 30_000 },
    offscreenIdleWindows: 1,
  },
};

export function studioBudget(hints: DeviceHints = typeof navigator === 'undefined' ? {} : navigator as DeviceHints): StudioBudget {
  return TABLE[deviceTier(hints)];
}

/** 소재 하나에 줄 `UrlSource` 캐시 — 합을 소재 수로 나누되 4MiB 아래로는 주지 않는다(머리·색인 한두 조각은 들어가야 한다). */
export function urlCacheBytesFor(budget: StudioBudget, assetCount: number): number {
  return Math.max(4 * MiB, Math.floor(budget.urlCacheTotalBytes / Math.max(1, assetCount)));
}
