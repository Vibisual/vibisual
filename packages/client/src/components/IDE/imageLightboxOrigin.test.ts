/**
 * §5.5 #17-25 — 라이트박스는 **연 자리 하나**에만 선다(`lightboxHostMatches`).
 *
 * 라이트박스를 그리는 호스트는 대화 본문마다 있다 — 창이 여럿이거나 한 창을 칸으로 나누면(#17-34) 여럿이 된다.
 * 종전에는 모두가 전역 상태 하나를 보고 저마다 그려, 한 번 연 그림이 창·칸 수만큼 겹쳐 떴고 맨 위에 선 것의
 * [저장]이 **누른 곳이 아닌** 창·세션의 입력창으로 갔다.
 */
import { describe, it, expect } from 'vitest';
import type { ImageLightboxOrigin } from '../../stores/graphStore.js';
import { lightboxHostMatches, type ImageLightboxHostSpot } from './imageLightboxOrigin.js';

// 창 둘 — A 는 나누지 않았고, B 는 칸 셋으로 나눠 c2 에 초점이 있다. `IDESplitView` 는 분할 중이면 칸마다 본문을
//   그리고(초점 칸은 언제나 하나), 나누지 않았으면 칸 표식 없는 본문 하나를 그린다.
const HOSTS: ImageLightboxHostSpot[] = [
  { slot: 'A', cell: null, focused: true },
  { slot: 'B', cell: 'c1', focused: false },
  { slot: 'B', cell: 'c2', focused: true },
  { slot: 'B', cell: 'c3', focused: false },
];

function drawers(origin: ImageLightboxOrigin): ImageLightboxHostSpot[] {
  return HOSTS.filter((host) => lightboxHostMatches(origin, host));
}

describe('lightboxHostMatches', () => {
  it('칸에서 연 그림은 그 칸만 그린다 — 초점이 다른 칸에 있어도', () => {
    expect(drawers({ slot: 'B', cell: 'c3' })).toEqual([HOSTS[3]]);
  });

  it('칸 밖(편집창·사이드바)에서 열면 그 창의 초점 칸이 그린다', () => {
    expect(drawers({ slot: 'B', cell: null })).toEqual([HOSTS[2]]);
  });

  it('나누지 않은 창은 하나뿐인 본문이 그린다', () => {
    expect(drawers({ slot: 'A', cell: null })).toEqual([HOSTS[0]]);
  });

  it('다른 창의 호스트는 칸 이름이 같아도 그리지 않는다', () => {
    expect(lightboxHostMatches({ slot: 'A', cell: 'c1' }, { slot: 'B', cell: 'c1', focused: true })).toBe(false);
    expect(lightboxHostMatches({ slot: 'A', cell: null }, { slot: 'B', cell: null, focused: true })).toBe(false);
  });

  it('어느 자리에서 열든 그리는 호스트는 정확히 하나다 — 겹쳐 뜨지 않는다', () => {
    const origins: ImageLightboxOrigin[] = [
      { slot: 'A', cell: null },
      { slot: 'B', cell: null },
      { slot: 'B', cell: 'c1' },
      { slot: 'B', cell: 'c2' },
      { slot: 'B', cell: 'c3' },
    ];
    for (const origin of origins) expect(drawers(origin), JSON.stringify(origin)).toHaveLength(1);
  });
});
