/**
 * §5.1 #2-1 (G) ⑧ — 그림 미리보기를 **필요한 크기만큼만** 풀고, 쥐는 것은 구운 작은 한 장뿐인지 고정한다.
 *
 * 2026-10-21 사용자 지시 — *"전체 사진 불러올 필요 없고 화질 잘 저화해서 … 안보면 잘 해제"*.
 *  ① 줄여 풀 크기는 EXIF 회전을 세운 뒤의 가로×세로로 잡는다 — 돌아간 세로 사진을 필요보다 1.5배 크게 풀지 않는다.
 *  ② 원본보다 키우지 않고, 크기를 모르면 줄이지 않는다(크기 상한은 이미 봤다).
 *  ③ SVG 는 원본(상한 1MB)을 기억 장소에 쥐지 않고 굽는 크기로 래스터한다 — 못 하면 종전대로 원본(원문 검사).
 */
import { describe, it, expect } from 'vitest';
import { orientedImageSize } from '@vibisual/shared';

import { thumbnailDecodeSize } from './imageThumbnail.js';

describe('thumbnailDecodeSize — 줄여 풀 크기', () => {
  it('짧은 변이 굽는 자리의 긴 변을 덮을 만큼만, 가로 하나로', () => {
    expect(thumbnailDecodeSize({ width: 6000, height: 4000 }, { width: 128, height: 128 })).toEqual({ resizeWidth: 192, resizeQuality: 'medium' });
  });

  it('EXIF 로 돌아간 세로 사진은 세운 크기로 잡는다(필요보다 크게 풀지 않는다)', () => {
    const upright = orientedImageSize({ width: 6000, height: 4000 }, 6);
    expect(upright).toEqual({ width: 4000, height: 6000 });
    // 세운 가로 4000 을 128 로 — 짧은 변(가로)이 128 을 덮는다. 머리 크기 그대로(6000)였다면 192 로 풀었다.
    expect(thumbnailDecodeSize(upright, { width: 128, height: 128 })).toEqual({ resizeWidth: 128, resizeQuality: 'medium' });
  });

  it('원본보다 키우지 않고, 크기를 모르거나 자리가 없으면 줄이지 않는다', () => {
    expect(thumbnailDecodeSize({ width: 100, height: 80 }, { width: 128, height: 128 })).toBeUndefined();
    expect(thumbnailDecodeSize(null, { width: 128, height: 128 })).toBeUndefined();
    expect(thumbnailDecodeSize({ width: 6000, height: 4000 }, { width: 0, height: 128 })).toBeUndefined();
  });
});

describe('SVG — 원본을 쥐지 않고 구운 작은 한 장', () => {
  const sources = import.meta.glob(['./imageThumbnail.ts', '../../apps/thumbnailBake.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const thumb = sources['./imageThumbnail.ts'] ?? '';
  const bake = sources['../../apps/thumbnailBake.ts'] ?? '';

  it('SVG 는 굽는 크기로 래스터하고(벡터라 키워 굽는다), 못 하면 원본으로 물러선다', () => {
    expect(thumb).toContain('rasterizeVector(blob, req)');
    expect(thumb).toContain('upscale: true');
    expect(thumb).toContain('baked ?? URL.createObjectURL(blob)');
    // 래스터에 쓴 임시 주소는 그 자리에서 되돌린다.
    expect(thumb).toMatch(/finally \{\s*URL\.revokeObjectURL\(src\);/);
  });

  it('래스터는 키우지 않는 것이 기본이고(사진), 벡터만 키워 굽는다', () => {
    expect(bake).toContain("opts.upscale === true ? cover : Math.min(1, cover)");
  });
});
