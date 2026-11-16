/**
 * §5.4 #36 (K) — 전용 버블 id 규칙. 화면이 짓는 자리라 서버 노드가 없다.
 * `sizeCalc`·`flowBuilder` 가 읽으므로 위성·별자리 모듈을 끌어오지 않는다(순환). `bundle-` 머리라 `isBundleNodeId` 의 제외(자리 저장 등)를 그대로 받는다.
 */
export const DEDICATED_HUB_PREFIX = 'bundle-dedicated-hub-';
export const DEDICATED_CATEGORY_PREFIX = 'bundle-dedicated-cat-';

/** 이 노드 id 가 전용 버블인가(`bundle-dedicated-hub-…` · `sat-bundle-dedicated-hub-…`). 종류 묶음은 아니다. */
export function isDedicatedHubNodeId(id: string | null | undefined): boolean {
  if (!id) return false;
  return id.startsWith(DEDICATED_HUB_PREFIX) || id.startsWith(`sat-${DEDICATED_HUB_PREFIX}`);
}

/** 전용 버블 사본에 싣는 값 — 원시값만(노드 data 얕은 비교). */
export interface DedicatedHubMarks {
  readonly _dedicatedAppId: string | null;
  readonly _dedicatedColor: string | null;
  readonly _dedicatedGlow: string | null;
  /** 지금 보이는 종류의 항목 수. */
  readonly _dedicatedCount: number;
}
