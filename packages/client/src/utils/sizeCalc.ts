import { NODE_MIN_SIZE, NODE_MAX_SIZE, FILE_MIN_SIZE, FILE_MAX_SIZE, IFRAME_BUBBLE_HEIGHT } from '@vibisual/shared';
import { heatRatio, heatSize, isHeatBubbleType } from '@vibisual/shared';
import type { BubbleData, HeatScale } from '@vibisual/shared';

/** 활동량 기반 크기 계산을 위한 상한 */
const MAX_EXPECTED_ACTIVITY = 50;

/**
 * 버블 크기를 활동량(activity) 기반으로 계산.
 * 활성 상태면 추가 부스트.
 * NODE_MIN_SIZE ~ NODE_MAX_SIZE 범위.
 *
 * file 타입은 fileSizeRange가 주어지면 파일 용량 기반 상대 크기 사용.
 */
export function calcBubbleSize(
  bubble: BubbleData,
  fileSizeRange?: { min: number; max: number },
  heat?: HeatScale,
): number {
  // §5.24 — 히트맵 모드. 파일 용량·자식 수·activity 대신 **읽기 횟수 상대값 하나**가 지름을 정한다.
  //   대상은 "에이전트가 읽는 것"(file/internal_folder/external_folder/domain) 넷뿐이고,
  //   나머지는 아래 평상시 규칙 그대로다 — 에이전트가 쪼그라들면 무엇이 도는지 안 보이고
  //   root/back 이 작아지면 탐색 자체가 어려워진다.
  if (heat && isHeatBubbleType(bubble.bubbleType)) {
    return heatSize(heatRatio(bubble.readCount, heat));
  }

  // iframe 타입: 원형 버블, 고정 지름
  if (bubble.bubbleType === 'iframe') {
    return IFRAME_BUBBLE_HEIGHT;
  }

  // file 타입: 파일 용량 기반 상대 크기
  if (bubble.bubbleType === 'file') {
    return calcFileBubbleSize(bubble, fileSizeRange);
  }

  // §5.10 — Brain/휴지통 버블: 고정 중간 크기(홈 위성 상주).
  //   v3.82 — Brain 만 0.42 → 0.52. 상주 지식 허브라는 위계를 크기로 주고, 본체 3행이
  //   ts(=size/BUBBLE_TEXT_REF_SIZE) 축소를 거쳐도 전부 10px 이상으로 읽히게 하는 하한이다.
  if (bubble.bubbleType === 'brain') {
    return Math.round(NODE_MIN_SIZE + (NODE_MAX_SIZE - NODE_MIN_SIZE) * 0.52);
  }
  if (bubble.bubbleType === 'trash') {
    return Math.round(NODE_MIN_SIZE + (NODE_MAX_SIZE - NODE_MIN_SIZE) * 0.42);
  }

  // ghost: 원래 타입이 file이었으면 파일 크기, 아니면 기본 최소 크기
  if (bubble.bubbleType === 'ghost') {
    if (bubble.ghostInfo?.originalBubbleType === 'file') {
      return calcFileBubbleSize(bubble, fileSizeRange);
    }
    return NODE_MIN_SIZE;
  }

  const activity = Math.min(bubble.activity, MAX_EXPECTED_ACTIVITY);
  const ratio = activity / MAX_EXPECTED_ACTIVITY;

  let size = NODE_MIN_SIZE + ratio * (NODE_MAX_SIZE - NODE_MIN_SIZE);

  // 활성 상태 부스트 (+15%)
  if (bubble.status === 'active') {
    size = Math.min(size * 1.15, NODE_MAX_SIZE);
  }

  // 에이전트는 기본적으로 더 크게
  if (bubble.bubbleType === 'agent') {
    size = Math.max(size, NODE_MIN_SIZE + (NODE_MAX_SIZE - NODE_MIN_SIZE) * 0.4);
  }

  // 폴더는 childCount에 따라 부스트
  // §2.1 v1.55 — 외부 폴더는 평탄화로 child 가 없고 satellite 만 가지므로
  // satelliteFileCount 폴백을 적용해 실제 만진 파일 수에 비례하게.
  if (bubble.bubbleType === 'internal_folder' || bubble.bubbleType === 'external_folder') {
    // §2.1 #5 접합 트리 — 접합 외부 폴더는 위성 0이라 하위 폴더 수로 떨어진다(BubbleNode 카운트와 같은 규칙).
    const extSat = bubble.satelliteFileCount ?? 0;
    const boostCount =
      bubble.bubbleType === 'external_folder'
        ? (extSat > 0 ? extSat : (bubble.childCount ?? 0))
        : (bubble.childCount ?? 0);
    if (boostCount > 0) {
      const childBoost = Math.min(boostCount * 3, 30);
      size = Math.min(size + childBoost, NODE_MAX_SIZE);
    }
  }

  return Math.round(size);
}

/** 파일 버블 크기 — 현재 보이는 파일들 사이의 상대 용량 기반 */
function calcFileBubbleSize(
  bubble: BubbleData,
  range?: { min: number; max: number },
): number {
  const fileSize = bubble.fileSize;

  // fileSize 정보 없거나 range 없으면 최소 크기
  if (fileSize == null || !range || range.max <= 0) {
    return FILE_MIN_SIZE;
  }

  // 모든 파일이 같은 크기면 중간
  if (range.max === range.min) {
    return Math.round((FILE_MIN_SIZE + FILE_MAX_SIZE) / 2);
  }

  const ratio = (fileSize - range.min) / (range.max - range.min);
  return Math.round(FILE_MIN_SIZE + ratio * (FILE_MAX_SIZE - FILE_MIN_SIZE));
}

/**
 * 파일 버블 목록에서 fileSize min/max 범위 계산.
 * 위성 등에서 calcBubbleSize에 넘겨줄 용도.
 */
export function calcFileSizeRange(files: BubbleData[]): { min: number; max: number } {
  let min = Infinity;
  let max = 0;
  for (const f of files) {
    if (f.fileSize != null) {
      if (f.fileSize < min) min = f.fileSize;
      if (f.fileSize > max) max = f.fileSize;
    }
  }
  return { min: min === Infinity ? 0 : min, max };
}

/**
 * §5.24 — 히트 상대 척도를 잰다. **바닥은 언제나 0**이라 최대값 하나만 돌려준다.
 *
 * **프로젝트별로 잰다** — 다른 탭의 뜨거운 파일 하나가 지금 보는 프로젝트를 통째로 차갑게 눌러
 * 버리면 안 된다(§3.5 프로젝트 독립성). 소속을 모르는 노드는 **포함**한다 — 빼면 척도가 작아져
 * 실제보다 뜨겁게 보이므로, 오차의 방향을 안전한 쪽(덜 뜨겁게)으로 둔다.
 */
export function calcReadCountRange(
  nodes: Iterable<BubbleData>,
  nodeProjects: Record<string, string>,
  activeProject: string | null,
): { max: number } {
  let max = 0;
  for (const n of nodes) {
    if (!isHeatBubbleType(n.bubbleType)) continue;
    if (activeProject) {
      const owner = nodeProjects[n.id];
      if (owner !== undefined && owner !== activeProject) continue;
    }
    const c = n.readCount;
    if (typeof c === 'number' && Number.isFinite(c) && c > max) max = c;
  }
  return { max };
}
