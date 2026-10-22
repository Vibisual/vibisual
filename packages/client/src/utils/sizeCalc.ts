import { NODE_MIN_SIZE, NODE_MAX_SIZE, FILE_MIN_SIZE, FILE_MAX_SIZE, IFRAME_BUBBLE_HEIGHT, FILE_FACE, FILE_SIZE_SCALE, BUNDLE_BUBBLE } from '@vibisual/shared';
import { fileFaceKindOf, heatRatio, heatSize, heatValueOf, isHeatBubbleType, isMediaFaceKind } from '@vibisual/shared';
import type { BubbleData, HeatScale, ToolAxis } from '@vibisual/shared';

/**
 * §5.1 #2-1 (A) — 파일 얼굴의 지름 하한. 미디어는 그림이 읽혀야 한다(`mediaMinSize`). 판정 경로는 얼굴과 같다(절대경로 → 노드 키 →
 * 이름). 위성을 거느린 파일 중심의 하한(`hubMinSize`)은 묶음 버블(§5.1 #2-1 (B))이 생기며 걷었다 — 파일은 중심이 되지 않는다.
 */
function fileFaceMinSize(bubble: BubbleData): number {
  const src = bubble.absolutePath || bubble.path || bubble.label;
  return isMediaFaceKind(fileFaceKindOf(src)) ? FILE_FACE.mediaMinSize : 0;
}

/** 같은 범위는 같은 객체 — 노드 `data` 의 얕은 비교가 참조로 걸리므로 스냅샷마다 새 범위를 만들면 버블이 매번 다시 그려진다. */
const RANGE_CACHE_MAX = 512;
const rangeCache = new Map<string, { min: number; max: number }>();

/** `{min, max}` 범위 객체를 값으로 재사용한다(표시 전용 `_localRange` 용). */
export function stableSizeRange(min: number, max: number): { min: number; max: number } {
  const key = `${min}:${max}`;
  const hit = rangeCache.get(key);
  if (hit) return hit;
  if (rangeCache.size >= RANGE_CACHE_MAX) rangeCache.clear();
  const range = Object.freeze({ min, max }) as { min: number; max: number };
  rangeCache.set(key, range);
  return range;
}

/**
 * §2.3 · §5.1 #2-1 (A) — 한 화면의 **같은 층**(원 둘레에 선 버블 · 묶음 안의 구성)에 선 파일들끼리 견줄 범위를 싣는다. 종전에는
 * 원 둘레 파일이 프로젝트 전체 위성의 범위(`store.fileSizeRange`)와 견줘, 다른 폴더의 큰 파일 하나가 이 화면의 지름을 정했다.
 * 위성은 이미 같은 부모끼리 견준다(`collectSatellites` 의 `localRange`). 파일이 없거나 하나도 크기를 모르면 그대로 돌려준다.
 */
export function withScreenFileRange(bubbles: BubbleData[]): BubbleData[] {
  const files = bubbles.filter((b) => b.bubbleType === 'file' && b.fileSize != null);
  if (files.length === 0) return bubbles;
  const raw = calcFileSizeRange(files);
  const range = stableSizeRange(raw.min, raw.max);
  return bubbles.map((b) => (b.bubbleType === 'file' ? { ...b, _localRange: range } as BubbleData : b));
}

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
  // §5.24 — 히트맵 모드. 파일 용량·자식 수·activity 대신 **히트 횟수 상대값 하나**가 지름을 정한다
  //   (어느 축을 보는지는 척도가 들고 온다 — `HeatScale.axis`).
  //   대상은 "에이전트가 읽는 것"(file/internal_folder/external_folder/domain) 넷뿐이고,
  //   나머지는 아래 평상시 규칙 그대로다 — 에이전트가 쪼그라들면 무엇이 도는지 안 보이고
  //   root/back 이 작아지면 탐색 자체가 어려워진다.
  if (heat && isHeatBubbleType(bubble.bubbleType)) {
    return heatSize(heatRatio(heatValueOf(bubble, heat.axis), heat));
  }

  // iframe 타입: 원형 버블, 고정 지름
  if (bubble.bubbleType === 'iframe') {
    return IFRAME_BUBBLE_HEIGHT;
  }

  // §5.1 #2-1 (B) — 묶음 버블은 용량·활동과 무관한 고정 지름(무리의 중심이되 구성 파일을 덮지 않는다).
  if (bubble.bubbleType === 'bundle') {
    return BUNDLE_BUBBLE.size;
  }

  // file 타입: 파일 용량 기반 상대 크기
  // §5.1 #2-1 — 미디어 얼굴·별자리 중심은 하한을 둔다(히트맵이 켜져 있으면 위에서 이미 히트가 이겼다).
  if (bubble.bubbleType === 'file') {
    return Math.max(calcFileBubbleSize(bubble, fileSizeRange), fileFaceMinSize(bubble));
  }

  // §5.10 — 휴지통 버블: 고정 중간 크기(홈 위성 상주).
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
  // §5.1 #3-2 — 1.22 로 올렸다가 사용자 지시로 되돌린 값이다. 임의로 키우지 마라.
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

/**
 * 파일 버블 크기 — 같은 화면에서 견주는 파일들 사이의 상대 용량.
 *
 * §2.3 · §5.1 #2-1 (A) (2026-10-21 사용자 지시) — 용량은 **자릿수로** 읽는다(로그 눈금). 정비례면 큰 파일 하나가 최대 지름을
 * 차지하고 나머지가 바닥에 눌린다. 눈금 폭에는 하한(`FILE_SIZE_SCALE.minSpread` 배)을 걸어 좁게 갈린 무리는 가운데 지름으로
 * 모은다 — 몇 바이트 차이가 지름 차이가 되지 않게. 하한이라 문턱에서 튀지 않고 이어진다(같은 크기 → 정확히 가운데).
 */
function calcFileBubbleSize(
  bubble: BubbleData,
  range?: { min: number; max: number },
): number {
  const fileSize = bubble.fileSize;

  // fileSize 정보 없거나 range 없으면 최소 크기
  if (fileSize == null || !range || range.max <= 0) {
    return FILE_MIN_SIZE;
  }

  const lo = Math.log1p(Math.max(0, range.min));
  const hi = Math.log1p(Math.max(range.min, range.max));
  const v = Math.log1p(Math.min(Math.max(fileSize, range.min), range.max));
  const span = Math.max(hi - lo, Math.log(FILE_SIZE_SCALE.minSpread));
  const ratio = Math.min(1, Math.max(0, 0.5 + (v - (lo + hi) / 2) / span));
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
 * §5.24 — 히트 상대 척도를 **축 하나**에 대해 잰다. **바닥은 언제나 0**이라 최대값 하나면 된다.
 *
 * **축마다 따로 잰다** — 읽기가 쓰기보다 훨씬 큰 흔한 세션에서 한 자를 나눠 쓰면 쓰기 지도가
 * 통째로 차갑게 눌려 축을 바꾼 보람이 없어진다.
 *
 * **프로젝트별로 잰다** — 다른 탭의 뜨거운 파일 하나가 지금 보는 프로젝트를 통째로 차갑게 눌러
 * 버리면 안 된다(§3.5 프로젝트 독립성). 소속을 모르는 노드는 **포함**한다 — 빼면 척도가 작아져
 * 실제보다 뜨겁게 보이므로, 오차의 방향을 안전한 쪽(덜 뜨겁게)으로 둔다.
 *
 * `values` 는 `quantile` 곡선이 읽는 **분포**다 — 서버가 전량으로 실어 주면 그쪽이 권위이고
 * 이것은 폴백이다(최대값이 그런 것과 **같은 규칙**). 같은 순회에서 모으므로 한 바퀴로 끝난다.
 */
export function calcHeatCountRange(
  nodes: Iterable<BubbleData>,
  nodeProjects: Record<string, string>,
  activeProject: string | null,
  axis: ToolAxis,
): { max: number; values: number[] } {
  let max = 0;
  const values: number[] = [];
  for (const n of nodes) {
    if (!isHeatBubbleType(n.bubbleType)) continue;
    if (activeProject) {
      const owner = nodeProjects[n.id];
      if (owner !== undefined && owner !== activeProject) continue;
    }
    // §2.1 (A) — 접합은 자기 히트가 늘 0 이라 자손 합을 본다(척도가 그것을 빼면 색만 뜨거워진다).
    const c = heatValueOf(n, axis);
    if (typeof c !== 'number' || !Number.isFinite(c) || c <= 0) continue;
    if (c > max) max = c;
    values.push(c);
  }
  return { max, values };
}
