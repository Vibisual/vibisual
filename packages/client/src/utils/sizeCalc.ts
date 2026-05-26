import { NODE_MIN_SIZE, NODE_MAX_SIZE, FILE_MIN_SIZE, FILE_MAX_SIZE, IFRAME_BUBBLE_HEIGHT } from '@vibisual/shared';
import type { BubbleData } from '@vibisual/shared';

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
): number {
  // iframe 타입: 원형 버블, 고정 지름
  if (bubble.bubbleType === 'iframe') {
    return IFRAME_BUBBLE_HEIGHT;
  }

  // file 타입: 파일 용량 기반 상대 크기
  if (bubble.bubbleType === 'file') {
    return calcFileBubbleSize(bubble, fileSizeRange);
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
    const boostCount =
      bubble.bubbleType === 'external_folder'
        ? (bubble.satelliteFileCount ?? bubble.childCount ?? 0)
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
