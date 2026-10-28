import { NODE_MIN_SIZE, NODE_MAX_SIZE, FILE_MIN_SIZE, FILE_MAX_SIZE, IFRAME_BUBBLE_HEIGHT, FILE_FACE, FILE_SIZE_SCALE, BUNDLE_BUBBLE } from '@vibisual/shared';
import { fileFaceKindOf, heatRatio, heatSize, heatValueOf, isHeatBubbleType, isMediaFaceKind } from '@vibisual/shared';
import type { BubbleData, HeatScale, ToolAxis } from '@vibisual/shared';

/**
 * §5.1 #2-1 (A) — 파일 얼굴의 지름 하한. 미디어는 그림이 읽혀야 한다(`mediaMinSize`). 판정 경로는 얼굴과 같다(절대경로 → 노드 키 → 이름).
 * 위성을 거느린 파일 중심의 하한은 없다 — 파일은 중심이 되지 않는다(묶음 버블, §5.1 #2-1 (B)).
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
 * §2.3 · §5.1 #2-1 (A) — 한 화면의 **같은 층**(원 둘레의 버블 · 묶음 안의 구성) 파일끼리 견줄 범위를 싣는다 — 프로젝트 전체 범위(`store.fileSizeRange`)와
 * 견주면 다른 폴더의 큰 파일 하나가 이 화면의 지름을 정한다. 위성은 이미 같은 부모끼리 견준다(`collectSatellites` 의 `localRange`).
 * 파일이 없거나 하나도 크기를 모르면 그대로 돌려준다.
 */
export function withScreenFileRange(bubbles: BubbleData[]): BubbleData[] {
  const files = bubbles.filter((b) => b.bubbleType === 'file' && b.fileSize != null);
  if (files.length === 0) return bubbles;
  const raw = calcFileSizeRange(files);
  const range = stableSizeRange(raw.min, raw.max);
  return bubbles.map((b) => (b.bubbleType === 'file' ? { ...b, _localRange: range } as BubbleData : b));
}

/**
 * §5.1 #2-1 (B) — 파일을 쓴 횟수(읽기 + 쓰기). 묶음 안의 지름이 이것이다.
 * 서버 노드는 도구가 닿을 때마다 `readCount`·`writeCount` 를 올린다(§5.24) — 둘 다 없는 옛 노드는 활동량, 그것도 없으면 1.
 */
export function fileUsageOf(bubble: Pick<BubbleData, 'readCount' | 'writeCount' | 'activity'>): number {
  const counted = (bubble.readCount ?? 0) + (bubble.writeCount ?? 0);
  if (counted > 0) return counted;
  return Number.isFinite(bubble.activity) && bubble.activity > 1 ? bubble.activity : 1;
}

/**
 * §5.1 #2-1 (B) — 묶음 안(같은 화면의 같은 층)의 구성끼리 견줄 **사용 횟수 범위**를 싣는다(`_usageRange` — 표시 전용). 이것이 실린
 * 파일은 `calcBubbleSize` 가 용량 대신 사용 횟수로 지름을 잰다 — 렌더·물리·선 끝점이 같은 자를 쓴다(`_localRange` 와 같은 규칙).
 */
export function withBundleUsageRange(bubbles: BubbleData[]): BubbleData[] {
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  for (const b of bubbles) {
    if (b.bubbleType !== 'file') continue;
    const usage = fileUsageOf(b);
    if (usage < min) min = usage;
    if (usage > max) max = usage;
  }
  if (max === 0) return bubbles;
  const range = stableSizeRange(min, max);
  return bubbles.map((b) => (b.bubbleType === 'file' ? { ...b, _usageRange: range } as BubbleData : b));
}

/** 사본에 실린 묶음 안 사용 횟수 범위(`withBundleUsageRange`) — 없으면 그 파일은 용량으로 잰다. */
function usageRangeOf(bubble: BubbleData): { min: number; max: number } | undefined {
  const range = (bubble as unknown as Record<string, unknown>)['_usageRange'];
  return range !== null && typeof range === 'object' ? range as { min: number; max: number } : undefined;
}

/**
 * §5.1 #2-1 (B) — 묶음 안 구성의 지름: **넓이가 사용 횟수에 비례**한다(지름 ∝ √횟수). 그 화면에서 가장 많이 쓴 것이
 * `BUNDLE_BUBBLE.interiorMaxSize`, 적게 쓴 것은 미디어 하한(`FILE_FACE.mediaMinSize`)까지 — 다 같이 썼으면 다 같은 크기다.
 */
function calcUsageBubbleSize(bubble: BubbleData, range: { min: number; max: number }): number {
  const ratio = Math.sqrt(Math.min(1, fileUsageOf(bubble) / Math.max(1, range.max)));
  return Math.round(Math.max(FILE_FACE.mediaMinSize, BUNDLE_BUBBLE.interiorMaxSize * ratio));
}

/** 활동량 기반 크기 계산을 위한 상한 */
const MAX_EXPECTED_ACTIVITY = 50;

/** 버블 지름 — 활동량 기반(활성이면 부스트), `NODE_MIN_SIZE`~`NODE_MAX_SIZE`. file 은 `fileSizeRange` 가 있으면 용량 기반 상대 크기. */
export function calcBubbleSize(
  bubble: BubbleData,
  fileSizeRange?: { min: number; max: number },
  heat?: HeatScale,
): number {
  // §5.24 — 히트맵 모드: 파일 용량·자식 수·activity 대신 히트 횟수 상대값 하나가 지름을 정한다(축은 `HeatScale.axis`).
  // 대상은 에이전트가 읽는 것(file/internal_folder/external_folder/domain)뿐 — 에이전트가 쪼그라들면 무엇이 도는지 안 보이고, root/back 이 작아지면 탐색이 어렵다.
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

  // file: 파일 용량 기반 상대 크기. §5.1 #2-1 — 미디어 얼굴은 하한을 둔다(히트맵이면 위에서 이미 히트가 이겼다).
  // §5.1 #2-1 (B) — 묶음 안(사본에 `_usageRange`)은 용량이 아니라 **사용 횟수**가 지름이다.
  if (bubble.bubbleType === 'file') {
    const usage = usageRangeOf(bubble);
    if (usage) return calcUsageBubbleSize(bubble, usage);
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

  // 활성 상태 부스트(+15%). §5.1 #3-2 — 1.22 로 올렸다가 되돌린 값이다. 임의로 키우지 마라.
  if (bubble.status === 'active') {
    size = Math.min(size * 1.15, NODE_MAX_SIZE);
  }

  // 에이전트는 기본적으로 더 크게
  if (bubble.bubbleType === 'agent') {
    size = Math.max(size, NODE_MIN_SIZE + (NODE_MAX_SIZE - NODE_MIN_SIZE) * 0.4);
  }

  // 폴더는 childCount 로 부스트. §2.1 — 외부 폴더는 평탄화로 child 가 없고 위성만 가지므로 `satelliteFileCount` 로 폴백한다(실제 만진 파일 수에 비례).
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
 * §2.3 · §5.1 #2-1 (A) — 용량은 **자릿수로** 읽는다(로그 눈금). 정비례면 큰 파일 하나가 최대 지름을 차지하고 나머지가 바닥에 눌린다.
 * 눈금 폭에 하한(`FILE_SIZE_SCALE.minSpread` 배)을 걸어 좁게 갈린 무리는 가운데 지름으로 모은다 — 몇 바이트 차이가 지름 차이가 되지 않게.
 * 하한이라 문턱에서 튀지 않고 이어진다(같은 크기 → 정확히 가운데).
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

/** 파일 버블들의 fileSize min/max — 위성 등에서 `calcBubbleSize` 에 넘긴다. */
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
 * §5.24 — 히트 상대 척도를 **축 하나**에 대해 잰다. 바닥은 언제나 0 이라 최대값 하나면 된다.
 * 축마다 따로 잰다 — 읽기가 쓰기보다 훨씬 큰 세션에서 한 자를 쓰면 쓰기 지도가 통째로 차갑게 눌린다.
 * 프로젝트별로 잰다(§3.5 — 다른 탭의 뜨거운 파일이 지금 프로젝트를 누르지 않게). 소속을 모르는 노드는 **포함**한다 — 빼면 척도가 작아져 실제보다 뜨겁게 보인다.
 * `values` 는 `quantile` 곡선이 읽는 분포 — 서버가 전량으로 실어 주면 그쪽이 권위이고 이것은 폴백이다(최대값과 같은 규칙). 한 순회에서 모은다.
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
