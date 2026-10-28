/**
 * §5.1 #2-1 (B) — 화면 하나(메인·폴더 안)의 별자리·묶음 배치. 판정은 shared(`planConstellations`·`planKindBundles` — 서버 위성 상한과 같은 답),
 * 여기서는 그 답을 이 화면 노드로 옮길 뿐이다(순수 — 스토어·DOM 을 안 보고 플랫폼은 인자로). 앱 노드가 선언한 파일은 그 노드를 돌고(구성끼리 크기 범위를 함께 잰다) 선은 호출부가 `converted` 로.
 * 묶음엔 같은 미디어 종류만(파일은 중심 ❌·텍스트 ❌): 위성 무리 안 같은 종류 둘 이상 = `sat-bundle-<부모 id>-<종류>` 하나(하위 폴더 무관, 구성은 낱자리 ❌),
 * 수 `folderKindCount`(확인 안 한 턴에 쓴 것)·이름 `folderKindDir`. 위성은 폴더와 같은 규칙(`bundleMoonsOf`, 더블클릭은 파일 `fileFaceOpenPlan`), 몸은 제 위성까지(`_orbitReach` — §5.1 #2-2 (J) ④).
 * 원 둘레·연속 번호 대표(§5.1 #2-1 (F) ⑦)도 묶음(`bundle-radial-<열쇠>`, 선은 `bundled`). 선은 위성선 `sat-edge-<id>` 그대로. `_bundle`·`_orbitReach`·`_constellation` 은 표시 전용.
 */
import type { AppWorkRole, BubbleData, ConstellationAppHubInput, ConstellationMoon, ConstellationReason, FileFaceKind, HeatScale, NodeStatus, PlatformName } from '@vibisual/shared';
import {
  BUBBLE_COLORS,
  BUNDLE_BUBBLE,
  DEFAULT_MAX_SATELLITES,
  FOLDER_BUBBLE_TYPES,
  READ_TOOLS,
  appWorkRoleOf,
  appWorkRoleRank,
  appWorkSeatAngles,
  fileFaceKindOf,
  kindBundleDirToken,
  kindBundleNameOf,
  planConstellations,
  planKindBundles,
} from '@vibisual/shared';

import { calcBubbleSize, calcFileSizeRange, stableSizeRange } from './sizeCalc.js';
import { satelliteHubReach, type SatelliteInfo } from './satellite.js';
import { appWorkPathKey, type AppWorkMoonMeta } from './appWorkView.js';

/**
 * §5.1 #2-1 (F) ⑤⑥ — 앱 작업 보기가 켜진 앱 노드 중심의 자리 정보. 있으면 그 노드의 위성은 위쪽 반원에 역할 순으로 앉고
 * 앱 색 테를 두른다(`_seatAngle` · 꼬리표 `work`).
 */
export interface AppWorkSeat {
  readonly appName: string;
  /** 앱 색(밝은 쪽) — 위성의 테. */
  readonly ring: string;
  readonly appKind: FileFaceKind | null;
  /** 경로 열쇠 → 작업 파일의 표시 정보(`planAppWork`). */
  readonly meta: ReadonlyMap<string, AppWorkMoonMeta>;
}

/** 앱 노드 중심 하나 — 판정 입력 + 화면이 아는 것(이름 · 원으로 본 지름 · 연결선 숨김). */
export interface ConstellationAppHubView extends ConstellationAppHubInput {
  readonly label: string;
  readonly size: number;
  readonly linksHidden: boolean;
  /** §5.4 #36 (I) — 앱 작업 보기의 초점 노드면 자리 정보. */
  readonly workSeat?: AppWorkSeat;
}

/** §5.1 #2-1 (F) ⑥ — 작업 위성의 꼬리표(툴팁 · 테). */
export interface ConstellationWorkTag {
  readonly appName: string;
  readonly ring: string;
  readonly role: AppWorkRole;
  readonly writes: number;
  readonly script: boolean;
  readonly sequenceLabel?: string;
  readonly sequenceCount?: number;
  readonly sequenceNames?: readonly string[];
  /** 연속 번호 묶음의 파일 노드 id(번호 순) — 묶음 버블의 구성 · 묶음 안이 이것으로 찾는다. */
  readonly sequenceIds?: readonly string[];
}

/** 묶인 이유 — 판정(`planConstellations`)의 이유 그대로다. 같은 종류 묶음의 구성은 `sameFolder`(같은 하위 폴더)다. */
export type ConstellationTagReason = ConstellationReason;

/** 위성 사본에 싣는 이유 꼬리표 — 툴팁이 "무엇과 · 왜"를 말한다. */
export interface ConstellationTag {
  readonly hubLabel: string;
  readonly reason: ConstellationTagReason;
  readonly viaLabel?: string;
  /** §5.1 #2-1 (F) — 앱 작업 보기의 위성이면 그 작업의 정보. */
  readonly work?: ConstellationWorkTag;
}

/** 묶음 버블의 구성 한 줄(툴팁) — 이름과 묶인 이유(같은 폴더 묶음·연속 번호는 이유가 없다 — 묶음이 이미 말한다). */
export interface BundleMember {
  readonly label: string;
  readonly reason: ConstellationTagReason | null;
}

/**
 * §2.2 · §5.1 #2-1 (B) — 묶음 버블 사본에 싣는 구성(`_bundle`). 서버 데이터가 아니다 — 화면이 판정에서 짓는다.
 */
export interface BundleInfo {
  /** 무엇이 묶었나 — 같은 하위 폴더의 같은 종류(`planKindBundles`) · 연속 번호((F) ⑦). */
  readonly source: 'folder' | 'sequence';
  /** 구성의 종류 — 작은 줄 `영상 묶음` 과 테의 배지. 묶음에는 이 종류만 든다. */
  readonly kind: FileFaceKind;
  /** 같은 종류 묶음의 구성이 함께 든 가장 가까운 폴더(외부 표식을 뗀 경로) — 툴팁이 말한다. 연속 번호는 없다. */
  readonly folder?: string;
  /**
   * 같은 종류 묶음이 도는 폴더(위성 무리의 주인)의 노드 id(서버가 위성 사본에 싣는 `folderNodeId`). 묶음 안이 이 폴더를 화면 범위로
   * 선언해 위성 상한으로 빠진 같은 종류까지(그 폴더 아래 모든 깊이) 세운다. 없으면(옛 스냅샷) 묶음 안은 구성만 선다.
   */
  readonly folderId?: string;
  /** 구성 파일 노드 id — 같은 폴더 묶음은 최근 것부터, 연속 번호는 번호 순. 묶음 안(`interiorView` `bundle`)이 이것으로 찾는다. */
  readonly memberIds: readonly string[];
  /** 툴팁 줄(상한 `BUNDLE_BUBBLE.tooltipNameMax` — 넘치면 `count` 가 말한다). */
  readonly members: readonly BundleMember[];
  /** 수 — 같은 폴더 묶음은 그 폴더 아래에서 아직 확인하지 않은 턴에 사용한 그 종류(위성 상한으로 빠진 것 포함), 연속 번호는 그 연속의 장 수. */
  readonly count: number;
}

/** 묶음 버블 노드 id 의 머리(위성 자리면 `sat-` 가 앞에 붙는다). 판정은 `isBundleNodeId` 한 곳. */
export const BUNDLE_NODE_PREFIX = 'bundle-';

/** 이 노드 id 가 화면이 지은 묶음 버블인가(`bundle-…` · `sat-bundle-…`). */
export function isBundleNodeId(id: string): boolean {
  return id.startsWith(BUNDLE_NODE_PREFIX) || id.startsWith(`sat-${BUNDLE_NODE_PREFIX}`);
}

/** 버블 사본의 묶음 구성(묶음 버블이 아니면 `null`). */
export function bundleInfoOf(bubble: Pick<BubbleData, 'bubbleType'>): BundleInfo | null {
  if (bubble.bubbleType !== 'bundle') return null;
  const info = (bubble as unknown as { _bundle?: unknown })._bundle;
  return info && typeof info === 'object' ? info as BundleInfo : null;
}

/** 같은 내용의 구성은 같은 객체 — 꼬리표와 같은 이유(노드 data 얕은 비교). */
const BUNDLE_CACHE_MAX = 256;
const bundleCache = new Map<string, BundleInfo>();
function stableBundle(info: BundleInfo): BundleInfo {
  const key = JSON.stringify(info);
  const hit = bundleCache.get(key);
  if (hit) return hit;
  if (bundleCache.size >= BUNDLE_CACHE_MAX) bundleCache.clear();
  bundleCache.set(key, info);
  return info;
}

/** 묶음 버블의 이름 — 파일 이름에서 확장자만 뗀다(지어내지 않는다). 점으로 시작하는 이름은 그대로. 연속 번호 `frame_####` 가 쓴다. */
export function bundleNameOf(fileLabel: string): string {
  const dot = fileLabel.lastIndexOf('.');
  return dot > 0 ? fileLabel.slice(0, dot) : fileLabel;
}

/** 구성 중 하나라도 돌면 묶음도 돈다 — 나머지는 쉬는 중(완료·오류는 구성 파일이 각자 말한다). */
function bundleStatusOf(bubbles: readonly BubbleData[]): NodeStatus {
  return bubbles.some((b) => b.status === 'active') ? 'active' : 'idle';
}

export interface ConstellationViewInput {
  /** 이 화면에서 원 둘레에 서는 버블 — 파일이 섞여 있으면 후보가 된다. 폴더 버블은 같은 종류 묶음의 부모 경로도 준다. */
  readonly radial: readonly BubbleData[];
  readonly satInfos: readonly SatelliteInfo[];
  readonly appHubs: readonly ConstellationAppHubView[];
  readonly heat: HeatScale | undefined;
  readonly platform: PlatformName;
  /** 서버에 저장된 위성 자리(`sat-<id>` → 좌표). 직속 파일이 위성이 될 때 그 자리가 있으면 쓴다. */
  readonly satellitePositions?: Readonly<Record<string, { x: number; y: number }>> | undefined;
  /** 메인 화면 최상위 파일 묶음(폴더 조각이 없는 프로젝트 루트)의 이름 — 프로젝트 이름. 없으면 빈 이름이다. */
  readonly rootLabel?: string | undefined;
  /**
   * §5.1 #2-1 (B) — 폴더 위성 묶음의 구성을 지금 턴의 것(서버 표시 `inOpenTurn`)만으로 — 새 명령의 묶음 안에 지난 것이 남지 않게.
   * 캔버스만 켠다 — IDE 세션 지도는 그 세션의 도구 호출이 재료라 이 표시가 없다(`bundleInteriorMembers` 의 `openTurnOnly` 와 같은 갈림).
   */
  readonly openTurnOnly?: boolean | undefined;
}

export interface ConstellationViewResult {
  readonly radial: BubbleData[];
  readonly satInfos: SatelliteInfo[];
  /** 위성이 된 직속 파일: 원래 id → 위성 id. */
  readonly converted: ReadonlyMap<string, string>;
  /**
   * 원 둘레 묶음에 든 직속 파일: 원래 id → 묶음 버블 id. 그 파일로 들어오던 선은 묶음으로 옮겨 단다 — 위성이 된
   * 파일(`converted`)과 달리 폴더 쪽 선도 버리지 않고, 같은 끝점이 된 선은 하나만 남긴다.
   */
  readonly bundled: ReadonlyMap<string, string>;
}

/** 앱 노드 별자리까지의 결과 — 원 둘레 묶음(`bundled`)은 그 뒤에 짓는다. */
type HubResult = Omit<ConstellationViewResult, 'bundled'>;

const NO_BUNDLED: ReadonlyMap<string, string> = new Map();

interface Candidate {
  readonly fileId: string;
  readonly viewId: string;
  readonly bubble: BubbleData;
  readonly sat: SatelliteInfo | null;
}

/**
 * 꼬리표는 같은 내용이면 **같은 객체**를 돌려준다 — 노드 `data` 의 얕은 비교(`shallowEqualData`)가 참조로 걸리므로,
 * 스냅샷마다 새 객체를 만들면 위성이 매번 다시 그려진다. 키 수는 화면의 위성 수 안팎이라 넘치면 통째로 비운다.
 */
const TAG_CACHE_MAX = 1024;
const tagCache = new Map<string, ConstellationTag>();
function tagOf(hubLabel: string, reason: ConstellationTagReason, viaLabel: string | undefined, work?: ConstellationWorkTag): ConstellationTag {
  const key = JSON.stringify([hubLabel, reason, viaLabel ?? null, work ?? null]);
  const hit = tagCache.get(key);
  if (hit) return hit;
  if (tagCache.size >= TAG_CACHE_MAX) tagCache.clear();
  const base: ConstellationTag = viaLabel === undefined ? { hubLabel, reason } : { hubLabel, reason, viaLabel };
  const tag: ConstellationTag = work ? { ...base, work } : base;
  tagCache.set(key, tag);
  return tag;
}

function fileIdOfSat(id: string): string {
  return id.startsWith('sat-') ? id.slice(4) : id;
}

export function applyConstellations(input: ConstellationViewInput): ConstellationViewResult {
  const app = applyAppHubConstellations(input);
  const satInfos = applyKindBundles(app.satInfos, input);
  // 원 둘레 묶음의 위성은 이미 선 위성 id 를 피한다 — 다른 부모가 먼저 거느린 파일이면 같은 노드 id 가 둘이 된다.
  const radial = applyRadialKindBundles(app.radial, input, new Set(satInfos.map((s) => s.bubble.id)));
  return {
    radial: radial.radial,
    satInfos: radial.moons.length > 0 ? [...satInfos, ...radial.moons] : satInfos,
    converted: app.converted,
    bundled: radial.bundled,
  };
}

/** §5.1 #2-1 (B) — 묶음 버블이 거느리는 위성 상한. 묶음에는 폴더 설정(§7.5 `maxSatellites`)이 없으므로 설정 없는 폴더와 같은 기본 상한이다. */
export const BUNDLE_SATELLITE_MAX = DEFAULT_MAX_SATELLITES;

/** 묶음 위성이 될 구성 하나 — 파일 노드 id · 그 파일(원 둘레의 원본 또는 폴더 위성 사본) · 저장된 위성 자리. */
interface BundleMoonSource {
  readonly fileId: string;
  readonly bubble: BubbleData;
  readonly position: { x: number; y: number } | undefined;
}

const NO_TAKEN: ReadonlySet<string> = new Set();

/**
 * §5.1 #2-1 (B) — 묶음 버블의 위성. 폴더 위성(`collectSatellites`)과 같은 규칙이다 — 구성(최근 것부터)에서 `BUNDLE_SATELLITE_MAX` 까지 ·
 * 첫 고리를 그 상한으로 나눈다(`parentSlots` — 다 차면 정오각형, §5.1 #2-2 (J) ③) · 크기는 그 위성끼리 견준다 · 선은 그 파일이 쓰던 방향의 위성선.
 * 더블클릭도 다른 파일 버블과 같다(`fileFaceOpenPlan` — 그 파일을 앱 안에서 열고, 묶음 안·폴더로 들어가지 않는다).
 * `taken` 은 그 화면에 이미 선 위성 id — 그 id 의 구성은 건너뛰고 다음 것을 세운다.
 */
function bundleMoonsOf(
  bundleId: string,
  sources: readonly BundleMoonSource[],
  heat: HeatScale | undefined,
  taken: ReadonlySet<string>,
): SatelliteInfo[] {
  const picked: { fileId: string; bubble: BubbleData }[] = [];
  for (const s of sources) {
    if (picked.length >= BUNDLE_SATELLITE_MAX) break;
    const id = `sat-${s.fileId}`;
    if (taken.has(id) || picked.some((p) => p.bubble.id === id)) continue;
    picked.push({ fileId: s.fileId, bubble: { ...s.bubble, id, activity: 1, position: s.position } as BubbleData });
  }
  if (picked.length === 0) return [];
  const parentSize = BUNDLE_BUBBLE.size;
  const raw = calcFileSizeRange(picked.map((p) => p.bubble));
  const localRange = stableSizeRange(raw.min, raw.max);
  return picked.map(({ fileId, bubble }, index) => {
    const size = calcBubbleSize(bubble, localRange, heat);
    const isRead = bubble.lastTool ? READ_TOOLS.has(bubble.lastTool) : false;
    return {
      bubble,
      parentId: bundleId,
      parentSize,
      edge: {
        id: `sat-edge-${fileId}`,
        source: isRead ? bubble.id : bundleId,
        target: isRead ? bundleId : bubble.id,
        label: bubble.lastTool,
        isActive: bubble.status === 'active',
        color: BUBBLE_COLORS.file,
        sourceRadius: isRead ? size / 2 : parentSize / 2,
        targetRadius: isRead ? parentSize / 2 : size / 2,
      },
      index,
      total: picked.length,
      localRange,
      heat,
      parentSlots: BUNDLE_SATELLITE_MAX,
    };
  });
}

/** §5.1 #2-2 (J) ④ — 위성을 거느린 묶음의 몸집 반경(가장 큰 위성의 바깥 테두리까지). 위성이 없으면 제 원이라 싣지 않는다. */
function bundleReachOf(moons: readonly SatelliteInfo[]): number | undefined {
  if (moons.length === 0) return undefined;
  return satelliteHubReach(BUNDLE_BUBBLE.size / 2, moons.map((m) => calcBubbleSize(m.bubble, m.localRange, m.heat)));
}

/** 앱 노드 별자리 — 앱 노드가 선언한 파일(결과 · 소재 · 코드 소재 폴더 · 작업물)은 그 노드를 돈다. 앱 노드가 없으면 그대로다. */
function applyAppHubConstellations(input: ConstellationViewInput): HubResult {
  const { radial, satInfos, appHubs, heat, platform } = input;
  const unchanged: HubResult = { radial: [...radial], satInfos: [...satInfos], converted: new Map() };
  if (appHubs.length === 0) return unchanged;

  const cands: Candidate[] = [];
  const seen = new Set<string>();
  for (const b of radial) {
    if (b.bubbleType !== 'file' || seen.has(b.id)) continue;
    seen.add(b.id);
    cands.push({ fileId: b.id, viewId: b.id, bubble: b, sat: null });
  }
  for (const s of satInfos) {
    if (s.bubble.bubbleType !== 'file') continue;
    const fileId = fileIdOfSat(s.bubble.id);
    if (seen.has(fileId)) continue;
    seen.add(fileId);
    cands.push({ fileId, viewId: s.bubble.id, bubble: s.bubble, sat: s });
  }
  if (cands.length === 0) return unchanged;

  const plan = planConstellations(
    cands.map((c) => ({
      id: c.fileId,
      path: c.bubble.absolutePath || c.bubble.path || c.bubble.label,
      lastActivity: c.bubble.lastActivity,
      mentions: c.bubble.mentions,
    })),
    appHubs,
    { platform },
  );
  if (plan.memberOf.size === 0) return unchanged;

  const byFileId = new Map(cands.map((c) => [c.fileId, c] as const));
  const appById = new Map(appHubs.map((a) => [a.id, a] as const));
  const labelOf = (id: string): string => byFileId.get(id)?.bubble.label ?? appById.get(id)?.label ?? id;
  const hubSize = (hubId: string): number => appById.get(hubId)?.size ?? 0;

  // 한 앱 노드를 도는 파일끼리 크기 범위 · 그 안의 차례.
  const rangeByHub = new Map<string, { min: number; max: number }>();
  const orderOf = new Map<string, { index: number; total: number }>();
  for (const [hubId, moons] of plan.moonsOf) {
    const bubbles = moons.map((m) => byFileId.get(m.id)?.bubble).filter((b): b is BubbleData => b !== undefined);
    const raw = calcFileSizeRange(bubbles);
    rangeByHub.set(hubId, stableSizeRange(raw.min, raw.max));
    moons.forEach((m, i) => orderOf.set(m.id, { index: i, total: moons.length }));
  }

  // §5.1 #2-1 (F) ⑤ — 앱 작업 보기의 초점 노드: 위성이 위쪽 반원에 **왼쪽부터 역할 순**으로 앉는다(결과 → 같은 종류 → 소재 →
  //   제작 코드 → 데이터 → 메모 → 기타). 결과는 별자리 이유(`appResult`)가, 작업 파일은 판정의 차례가 말한다.
  const seatOf = new Map<string, number>();
  const workTagOf = new Map<string, ConstellationWorkTag>();
  for (const hub of appHubs) {
    const seat = hub.workSeat;
    const moons = seat ? plan.moonsOf.get(hub.id) : undefined;
    if (!seat || !moons || moons.length === 0) continue;
    const entries = moons.map((m) => {
      const bubble = byFileId.get(m.id)?.bubble;
      const path = bubble ? bubble.absolutePath || bubble.path || bubble.label : m.id;
      const meta = seat.meta.get(appWorkPathKey(path, platform));
      const role: AppWorkRole = m.reason === 'appResult' ? 'result' : meta?.role ?? appWorkRoleOf(path, seat.appKind, false);
      return { id: m.id, role, meta, last: bubble?.lastActivity ?? 0, writes: meta?.writes ?? bubble?.writeCount ?? 0 };
    });
    entries.sort((a, b) => (appWorkRoleRank(a.role) - appWorkRoleRank(b.role))
      || ((a.meta?.order ?? Number.MAX_SAFE_INTEGER) - (b.meta?.order ?? Number.MAX_SAFE_INTEGER))
      || (b.last - a.last)
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const angles = appWorkSeatAngles(entries.length);
    entries.forEach((e, i) => {
      seatOf.set(e.id, angles[i]!);
      workTagOf.set(e.id, {
        appName: seat.appName,
        ring: seat.ring,
        role: e.role,
        writes: e.writes,
        script: e.meta?.script === true,
        ...(e.meta?.sequence ? {
          sequenceLabel: e.meta.sequence.label,
          sequenceCount: e.meta.sequence.count,
          sequenceNames: e.meta.sequence.names,
          sequenceIds: e.meta.sequence.ids,
        } : {}),
      });
    });
  }

  /**
   * 앱 노드를 도는 위성 하나. `tag` 는 툴팁의 "무엇과 · 왜", `hubId` 는 앱 노드 id.
   * 연속 번호의 대표(§5.1 #2-1 (F) ⑦)는 파일 사본 대신 묶음 버블로 선다 — 대표 파일의 얼굴을 쓰면 그림 한 장으로 읽힌다.
   * 이름은 확장자를 뗀 `frame_####` — 모든 묶음이 `이름 / 종류 묶음 · 수` 로 같다.
   */
  const makeMember = (bubble: BubbleData, fileId: string, hubId: string, tag: ConstellationTag, fromSat: boolean): SatelliteInfo => {
    const parentId = hubId;
    const parentSize = hubSize(hubId);
    const localRange = rangeByHub.get(hubId) ?? stableSizeRange(0, 0);
    const work = tag.work;
    const seatAngle = seatOf.get(fileId);
    const fileSatId = `sat-${fileId}`;
    const position = fromSat ? bubble.position : input.satellitePositions?.[fileSatId];
    const sequenceIds = work?.sequenceLabel !== undefined && work.sequenceIds && work.sequenceIds.length > 0 ? work.sequenceIds : null;
    let satBubble: BubbleData;
    if (sequenceIds !== null && work?.sequenceLabel !== undefined) {
      const names = work.sequenceNames ?? [];
      satBubble = {
        id: `sat-${BUNDLE_NODE_PREFIX}${fileId}`,
        label: bundleNameOf(work.sequenceLabel),
        bubbleType: 'bundle',
        path: '',
        status: bubble.status === 'active' ? 'active' : 'idle',
        activity: 1,
        lastActivity: bubble.lastActivity,
        ...(position ? { position } : {}),
        _bundle: stableBundle({
          source: 'sequence',
          kind: fileFaceKindOf(bubble.absolutePath || bubble.path || bubble.label),
          memberIds: sequenceIds,
          members: names.slice(0, BUNDLE_BUBBLE.tooltipNameMax).map((label) => ({ label, reason: null })),
          count: work.sequenceCount ?? sequenceIds.length,
        }),
        _constellation: tag,
        ...(seatAngle !== undefined ? { _seatAngle: seatAngle } : {}),
      } as BubbleData;
    } else {
      satBubble = {
        ...bubble,
        id: fileSatId,
        activity: 1,
        position,
        _constellation: tag,
        ...(seatAngle !== undefined ? { _seatAngle: seatAngle } : {}),
      } as BubbleData;
    }
    const size = calcBubbleSize(satBubble, localRange, heat);
    const isRead = bubble.lastTool ? READ_TOOLS.has(bubble.lastTool) : false;
    const order = orderOf.get(fileId) ?? { index: 0, total: 1 };
    const satId = satBubble.id;
    return {
      bubble: satBubble,
      parentId,
      parentSize,
      edge: {
        id: `sat-edge-${fileId}`,
        source: isRead ? satId : parentId,
        target: isRead ? parentId : satId,
        label: bubble.lastTool,
        isActive: bubble.status === 'active',
        color: BUBBLE_COLORS.file,
        sourceRadius: isRead ? size / 2 : parentSize / 2,
        targetRadius: isRead ? parentSize / 2 : size / 2,
      },
      index: order.index,
      total: order.total,
      localRange,
      heat,
      orbitSeat: true,
      // §5.1 #2-2 (J) — 앱 노드 둘레 궤도도 달 수로 나눠 고르게(앱 작업 위성은 정해진 각도라 쓰지 않는다).
      parentSlots: order.total,
      ...(seatAngle !== undefined ? { seatAngle } : {}),
      ...(appById.get(hubId)?.linksHidden === true ? { edgeHidden: true } : {}),
    };
  };
  const moonTag = (fileId: string, moon: ConstellationMoon): ConstellationTag =>
    tagOf(labelOf(moon.hub), moon.reason, moon.via !== undefined ? labelOf(moon.via) : undefined, workTagOf.get(fileId));

  // 원 둘레: 위성이 된 직속 파일은 빼고 위성으로 세운다.
  const converted = new Map<string, string>();
  const nextRadial: BubbleData[] = [];
  const convertedMoons: SatelliteInfo[] = [];
  for (const b of radial) {
    const moon = b.bubbleType === 'file' ? plan.memberOf.get(b.id) : undefined;
    if (moon) {
      const info = makeMember(b, b.id, moon.hub, moonTag(b.id, moon), false);
      converted.set(b.id, info.bubble.id);
      convertedMoons.push(info);
      continue;
    }
    nextRadial.push(b);
  }

  // 위성: 위성이 아닌 것을 먼저 — 새 위성의 첫 자리를 잡을 때 중심이 이미 자리에 있어야 한다.
  const staying: SatelliteInfo[] = [];
  const moons: SatelliteInfo[] = [];
  for (const s of satInfos) {
    const fileId = fileIdOfSat(s.bubble.id);
    const moon = s.bubble.bubbleType === 'file' ? plan.memberOf.get(fileId) : undefined;
    if (moon) {
      moons.push(makeMember(s.bubble, fileId, moon.hub, moonTag(fileId, moon), true));
      continue;
    }
    staying.push(s);
  }

  return { radial: nextRadial, satInfos: [...staying, ...moons, ...convertedMoons], converted };
}

/**
 * 묶음이 도는 폴더(위성 무리의 주인)의 노드 id(서버가 위성 사본에 싣는 `folderNodeId`) — 구성이 모두 같은 폴더를 말할 때만. 한
 * 묶음은 한 주인의 위성이라 어긋날 일이 없지만, 어긋나면 범위를 잘못 선언하느니 싣지 않는다(묶음 안은 구성만 선다).
 */
function bundleFolderIdOf(bubbles: readonly BubbleData[]): string | undefined {
  let id: string | undefined;
  for (const b of bubbles) {
    if (b.folderNodeId === undefined) continue;
    if (id === undefined) id = b.folderNodeId;
    else if (id !== b.folderNodeId) return undefined;
  }
  return id;
}

/**
 * 묶음 구성이 함께 든 가장 가까운 폴더 — 서버가 그 버블 아래 같은 종류 전부로 잰 `folderKindDir`. 구성이 모두 같은 값을
 * 말할 때만 쓴다(한 주인의 사본이라 같다). 없으면(옛 스냅샷) 화면에 온 구성으로 잰 공통 폴더를 쓴다.
 */
function bundleKindDirOf(bubbles: readonly BubbleData[]): string | undefined {
  let dir: string | undefined;
  for (const b of bubbles) {
    if (b.folderKindDir === undefined) continue;
    if (dir === undefined) dir = b.folderKindDir;
    else if (dir !== b.folderKindDir) return undefined;
  }
  return dir;
}

/**
 * §5.1 #2-1 (B) — 같은 종류 묶음. 폴더를 도는 파일 위성 중 같은 미디어 종류(`BUNDLE_BUBBLE.minMembers` 이상)는 어느 하위 폴더에 있든 묶음 버블 하나가 가장 최근 구성의 자리에 선다.
 * 구성은 폴더의 낱자리로 서지 않고, 최근 것이 폴더 위성과 같은 규칙으로 묶음의 위성이 된다(`bundleMoonsOf`). 나머지는 묶음 안(`bundleInteriorMembers`)에서 본다.
 * 판정은 shared `planKindBundles`(서버 위성 상한 §5.1 #2-1 (D)과 같은 답). 수는 아직 확인하지 않은 턴에 사용한 그 종류(상한으로 빠진 것 포함 — `folderKindCount`), 이름은 `folderKindDir`(없으면 화면 구성의 공통 폴더 → 주인 폴더 이름).
 * 앱 노드로 옮겨 간 위성·폴더가 아닌 부모의 위성은 건드리지 않는다.
 * `openTurnOnly`(캔버스): 문턱은 위성 목록 그대로 재지만 구성(수·위성·묶음 안의 출발점)은 지금 턴의 것만. 턴의 것이 없으면 묶음 없이 구성만 걷는다.
 */
function applyKindBundles(sats: SatelliteInfo[], input: ConstellationViewInput): SatelliteInfo[] {
  const folderParents = new Set<string>();
  /** 주인 폴더 이름 — 구성이 함께 든 폴더가 없을 때(다른 드라이브에 흩어진 외부 파일 등) 묶음 이름으로 쓴다(지어내지 않는다). */
  const folderLabelOf = new Map<string, string>();
  for (const b of input.radial) {
    if (!FOLDER_BUBBLE_TYPES.has(b.bubbleType)) continue;
    folderParents.add(b.id);
    folderLabelOf.set(b.id, b.label);
  }
  if (folderParents.size === 0) return sats;

  const byParent = new Map<string, SatelliteInfo[]>();
  for (const s of sats) {
    if (s.bubble.bubbleType !== 'file' || !folderParents.has(s.parentId)) continue;
    const list = byParent.get(s.parentId);
    if (list) list.push(s);
    else byParent.set(s.parentId, [s]);
  }

  /** 묶음의 머리(가장 최근 구성) 위성 id → 그 자리에 서는 묶음 버블. */
  const bundleAt = new Map<string, SatelliteInfo>();
  /** 묶음이 대신하는 구성 위성 id — 폴더의 낱자리에서 걷는다. 그중 최근 것은 아래 `moons` 로 묶음 둘레에 다시 선다. */
  const folded = new Set<string>();
  /** 묶음 버블의 위성 — 모든 자리 뒤에 붙인다(첫 자리를 잡을 때 부모인 묶음이 먼저 앉아 있어야 한다 — `placeSatellitePositions`). */
  const moons: SatelliteInfo[] = [];
  for (const [parentId, list] of byParent) {
    if (list.length < BUNDLE_BUBBLE.minMembers) continue;
    const plans = planKindBundles(
      list.map((s) => ({ id: s.bubble.id, path: s.bubble.path || s.bubble.absolutePath || '', lastActivity: s.bubble.lastActivity })),
      // 화면은 서버가 보낸 구성을 다 담는다 — 한 묶음의 상한은 서버 위성 상한이 이미 적용했다.
      { platform: input.platform, memberMax: Number.MAX_SAFE_INTEGER },
    );
    if (plans.length === 0) continue;
    const bySatId = new Map(list.map((s) => [s.bubble.id, s] as const));
    for (const plan of plans) {
      const listed = [...plan.memberIds, ...plan.overflowIds]
        .map((id) => bySatId.get(id))
        .filter((s): s is SatelliteInfo => s !== undefined);
      if (listed.length < BUNDLE_BUBBLE.minMembers) continue;
      // 구성은 지금 턴의 것만(캔버스). 위성 목록에는 확인한 지난 명령·다른 에이전트의 지난 그림까지 `moonMax` 만큼 실려 온다 —
      //   문턱을 넘은 구성은 낱자리로 서지 않지만, 수·위성·묶음 안에는 턴의 것만 담는다.
      const members = input.openTurnOnly === true ? listed.filter((s) => s.bubble.inOpenTurn === true) : listed;
      const head = members[0];
      if (!head) {
        // 턴의 것이 하나도 없다 — 묶음은 서지 않고, 지난 구성도 낱자리로 내놓지 않는다.
        for (const m of listed) folded.add(m.bubble.id);
        continue;
      }
      // 열쇠는 종류 하나라(한 부모 안에서 종류마다 묶음 하나) 구성이 바뀌어 공통 폴더가 움직여도 노드 id 가 그대로다.
      const bundleId = `sat-${BUNDLE_NODE_PREFIX}${parentId}-${plan.token}`;
      const memberBubbles = members.map((m) => m.bubble);
      const folderId = bundleFolderIdOf(memberBubbles);
      const dir = bundleKindDirOf(memberBubbles) ?? plan.dir;
      const label = kindBundleNameOf(dir) || (folderLabelOf.get(parentId) ?? '');
      // 수는 그 폴더 아래에서 아직 확인하지 않은 턴에 사용한 그 종류 — 서버가 못 셌으면(옛 스냅샷·폴더 노드 없음) 화면의 구성 수다.
      const count = Math.max(members.length, ...memberBubbles.map((b) => b.folderKindCount ?? 0));
      // 구성은 이 부모 하나의 위성이었다(`collectSatellites` 가 파일마다 첫 부모만 남긴다) — 걷힌 그 id 를 묶음의 위성이 그대로 쓴다.
      const bundleMoons = bundleMoonsOf(
        bundleId,
        members.map((m) => ({ fileId: fileIdOfSat(m.bubble.id), bubble: m.bubble, position: m.bubble.position })),
        input.heat,
        NO_TAKEN,
      );
      const reach = bundleReachOf(bundleMoons);
      const bundle = {
        id: bundleId,
        label,
        bubbleType: 'bundle',
        path: '',
        status: bundleStatusOf(memberBubbles),
        activity: 1,
        lastActivity: Math.max(0, ...memberBubbles.map((b) => b.lastActivity ?? 0)),
        ...(head.bubble.position ? { position: head.bubble.position } : {}),
        _bundle: stableBundle({
          source: 'folder',
          kind: plan.kind,
          ...(dir !== '' ? { folder: dir } : {}),
          ...(folderId !== undefined ? { folderId } : {}),
          memberIds: members.map((m) => fileIdOfSat(m.bubble.id)),
          members: members.slice(0, BUNDLE_BUBBLE.tooltipNameMax).map((m) => ({ label: m.bubble.label, reason: null })),
          count,
        }),
        // §5.1 #2-2 (J) ④ — 제 위성까지가 몸이다(물리·등장 영역 장부·정리가 읽는다). 부모 폴더와 그 다른 위성이 묶음 위성 자리를 밟지 않는다.
        ...(reach !== undefined ? { _orbitReach: reach } : {}),
      } as BubbleData;
      bundleAt.set(head.bubble.id, bundleSatellite(head, bundle, head.bubble, reach));
      for (const m of listed) folded.add(m.bubble.id);
      moons.push(...bundleMoons);
    }
  }
  // 턴의 것이 없어 묶음 없이 걷기만 한 구성이 있으면 여기서 돌아가면 안 된다 — 그 구성이 낱자리로 튀어나온다.
  if (bundleAt.size === 0 && folded.size === 0) return sats;

  // 묶음 버블은 가장 최근 구성이 서던 차례에 선다 — 구성은 폴더의 낱자리로 내지 않고, 최근 것이 묶음의 위성으로 맨 뒤에 붙는다.
  const out: SatelliteInfo[] = [];
  for (const s of sats) {
    const bundle = bundleAt.get(s.bubble.id);
    if (bundle) out.push(bundle);
    if (!folded.has(s.bubble.id)) out.push(s);
  }
  return moons.length > 0 ? [...out, ...moons] : out;
}

/**
 * §5.1 #2-1 (B) — 원 둘레 파일도 같은 종류 둘 이상이면 묶음 하나. 대상은 폴더 안 화면의 직속 파일과 메인 화면의 최상위 파일(프로젝트 루트)이다 —
 * 같은 폴더의 같은 미디어 종류 둘 이상은 그 파일들 대신 묶음 버블 하나가 가장 최근 파일이 서던 차례에 선다. 원 둘레 파일은 화면에 다 실려
 * 있으므로(위성 상한 없음) 구성은 전부이고 묶음 안은 그 구성으로 선다. 들어오던 선은 호출부가 `bundled` 로 옮겨 단다.
 * 이 묶음도 원 둘레 폴더 버블처럼 최근 구성을 위성으로 거느린다(`moons`). 몸집은 싣지 않는다(원 둘레 폴더 버블과 같다). `taken` 은 그 화면에 이미 선 위성 id 다.
 */
function applyRadialKindBundles(
  radial: BubbleData[],
  input: ConstellationViewInput,
  taken: ReadonlySet<string> = NO_TAKEN,
): { radial: BubbleData[]; bundled: ReadonlyMap<string, string>; moons: SatelliteInfo[] } {
  const files = radial.filter((b) => b.bubbleType === 'file');
  if (files.length < BUNDLE_BUBBLE.minMembers) return { radial, bundled: NO_BUNDLED, moons: [] };
  const plans = planKindBundles(
    files.map((b) => ({ id: b.id, path: b.path || b.absolutePath || '', lastActivity: b.lastActivity })),
    { platform: input.platform, memberMax: Number.MAX_SAFE_INTEGER, includeRoot: true },
  );
  if (plans.length === 0) return { radial, bundled: NO_BUNDLED, moons: [] };
  const byId = new Map(files.map((b) => [b.id, b] as const));
  /** 묶음의 머리(가장 최근 파일) id → 그 차례에 서는 묶음 버블. */
  const bundleAt = new Map<string, BubbleData>();
  const bundled = new Map<string, string>();
  const moons: SatelliteInfo[] = [];
  const seen = new Set(taken);
  for (const plan of plans) {
    const members = plan.memberIds.map((id) => byId.get(id)).filter((b): b is BubbleData => b !== undefined);
    const head = members[0];
    if (!head || members.length < BUNDLE_BUBBLE.minMembers) continue;
    // 원 둘레 파일은 그 화면의 한 폴더라 폴더까지 담은 열쇠가 움직이지 않는다 — 화면(폴더)마다 다른 id 이고 종전 id 그대로다.
    const bundleId = `${BUNDLE_NODE_PREFIX}radial-${kindBundleDirToken(plan.kind, plan.dir, input.platform)}`;
    bundleAt.set(head.id, {
      id: bundleId,
      // 이름은 그 폴더 이름 — 메인 화면 최상위 파일(폴더 조각 없음)은 프로젝트 이름이다(지어내지 않는다).
      label: plan.dir === '' ? (input.rootLabel ?? '') : kindBundleNameOf(plan.dir),
      bubbleType: 'bundle',
      path: '',
      status: bundleStatusOf(members),
      activity: 1,
      lastActivity: Math.max(0, ...members.map((b) => b.lastActivity ?? 0)),
      _bundle: stableBundle({
        source: 'folder',
        kind: plan.kind,
        ...(plan.dir !== '' ? { folder: plan.dir } : {}),
        memberIds: members.map((b) => b.id),
        members: members.slice(0, BUNDLE_BUBBLE.tooltipNameMax).map((b) => ({ label: b.label, reason: null })),
        count: members.length,
      }),
    } as BubbleData);
    for (const m of members) bundled.set(m.id, bundleId);
    const bundleMoons = bundleMoonsOf(
      bundleId,
      members.map((b) => ({ fileId: b.id, bubble: b, position: input.satellitePositions?.[`sat-${b.id}`] })),
      input.heat,
      seen,
    );
    for (const m of bundleMoons) seen.add(m.bubble.id);
    moons.push(...bundleMoons);
  }
  if (bundled.size === 0) return { radial, bundled: NO_BUNDLED, moons: [] };
  const out: BubbleData[] = [];
  for (const b of radial) {
    const bundle = bundleAt.get(b.id);
    if (bundle) out.push(bundle);
    if (!bundled.has(b.id)) out.push(b);
  }
  return { radial: out, bundled, moons };
}

/**
 * 위성 자리에 서던 구성 대신 그 자리(원래 부모의 위성)에 서는 묶음 버블. 선은 그 구성이 쓰던 방향 그대로다. `reach` 는 제 위성까지의
 * 몸집(§5.1 #2-2 (J) ④) — 부모 둘레에 이 몸집으로 앉는다(`placeSatellitePositions`).
 */
function bundleSatellite(s: SatelliteInfo, bundle: BubbleData, from: BubbleData, reach?: number): SatelliteInfo {
  const size = BUNDLE_BUBBLE.size;
  const isRead = from.lastTool ? READ_TOOLS.has(from.lastTool) : false;
  return {
    ...s,
    ...(reach !== undefined ? { reach } : {}),
    bubble: bundle,
    edge: {
      id: `sat-edge-${bundle.id.slice(4)}`,
      source: isRead ? bundle.id : s.parentId,
      target: isRead ? s.parentId : bundle.id,
      isActive: bundle.status === 'active',
      color: BUBBLE_COLORS.bundle,
      sourceRadius: isRead ? size / 2 : s.parentSize / 2,
      targetRadius: isRead ? s.parentSize / 2 : size / 2,
    },
  };
}

/**
 * §5.1 #2-1 (B) — 묶음 안에 세울 구성 파일 id. 묶음 안에도 그 종류만이다 — 들어온 순간 구성에서 종류가 다른 파일을 거른다(찾지 못한 id 는 묶음 안이 어차피 뺀다).
 * 상한(`BUNDLE_BUBBLE.interiorMax`) 안이면 그대로, 넘치면(연속 번호는 수백 장일 수 있다) 최근에 만진 것부터 그만큼 고르되 원래 차례(최근 순 · 번호 순)는 지킨다.
 */
export function bundleInteriorIds(
  info: Pick<BundleInfo, 'memberIds' | 'kind'>,
  nodes: Readonly<Record<string, Pick<BubbleData, 'lastActivity' | 'path' | 'absolutePath' | 'label'> | undefined>>,
): string[] {
  const ids = info.memberIds.filter((id) => {
    const node = nodes[id];
    return node === undefined || fileFaceKindOf(node.absolutePath || node.path || node.label) === info.kind;
  });
  if (ids.length <= BUNDLE_BUBBLE.interiorMax) return ids;
  const recent = [...ids]
    .sort((a, b) => (nodes[b]?.lastActivity ?? 0) - (nodes[a]?.lastActivity ?? 0))
    .slice(0, BUNDLE_BUBBLE.interiorMax);
  const keep = new Set(recent);
  return ids.filter((id) => keep.has(id));
}

/** 묶음 안에 세울 구성을 고르는 데 쓰는 내부 뷰의 몫(`InteriorView` 의 `bundle`). */
export interface BundleInteriorTarget {
  readonly memberIds: readonly string[];
  readonly folderId?: string | undefined;
  readonly fileKind?: FileFaceKind | undefined;
}

const NO_SATELLITE_LISTS: Readonly<Record<string, readonly BubbleData[] | undefined>> = {};

/**
 * §5.1 #2-1 (B) — 묶음 안에 세울 구성 파일. 같은 폴더 묶음은 들어온 순간의 구성(`memberIds` — 위성 상한이 줄인 것)에 더해, 그 폴더(위성 무리의 주인)를 범위로 선언해 받은 같은 종류 파일 전부를 모든 깊이에서 세운다:
 * ① 서버가 범위로 선언된 폴더의 위성 목록에 그 종류(턴의 것)를 덧붙여 싣고(`satellites`), ② 실려 온 자식은 하위 폴더까지 훑는다(`children` — 캔버스는 범위 안 폴더의 것만, IDE 세션 지도는 모든 폴더의 것).
 * 범위가 도착하기 전에는 구성만 선다(빈 화면 ❌). 차례는 최근에 만진 것부터, 상한 `BUNDLE_BUBBLE.interiorMax`. 연속 번호 묶음은 폴더가 없어 구성(번호 순)이다.
 * `openTurnOnly`(캔버스): 구성 밖에서 더 줍는 것은 서버가 `inOpenTurn` 으로 표시한 것뿐이다 — 범위 안 폴더의 자식에는 지난 턴의 파일도 실려 온다.
 * IDE 세션 지도는 그 표시가 없어 켜지 않는다(그 세션에서 쓴 것 전부).
 */
export function bundleInteriorMembers(
  view: BundleInteriorTarget,
  nodeMap: Readonly<Record<string, BubbleData | undefined>>,
  children: Readonly<Record<string, readonly BubbleData[] | undefined>>,
  satellites: Readonly<Record<string, readonly BubbleData[] | undefined>> = NO_SATELLITE_LISTS,
  options: { readonly openTurnOnly?: boolean } = {},
): BubbleData[] {
  const out: BubbleData[] = [];
  const seen = new Set<string>();
  for (const id of view.memberIds) {
    const node = nodeMap[id];
    if (!node || node.bubbleType !== 'file' || seen.has(id)) continue;
    seen.add(id);
    out.push(node);
  }
  const { folderId, fileKind } = view;
  if (folderId === undefined || fileKind === undefined) return out;
  const take = (node: BubbleData): void => {
    if (node.bubbleType !== 'file' || seen.has(node.id)) return;
    if (options.openTurnOnly === true && node.inOpenTurn !== true) return;
    if (fileFaceKindOf(node.absolutePath || node.path || node.label) !== fileKind) return;
    seen.add(node.id);
    out.push(node);
  };
  for (const node of satellites[folderId] ?? []) take(node);
  const visited = new Set<string>([folderId]);
  const stack = [folderId];
  while (stack.length > 0) {
    for (const node of children[stack.pop()!] ?? []) {
      if (FOLDER_BUBBLE_TYPES.has(node.bubbleType)) {
        if (!visited.has(node.id)) {
          visited.add(node.id);
          stack.push(node.id);
        }
        continue;
      }
      take(node);
    }
  }
  out.sort((a, b) => ((b.lastActivity ?? 0) - (a.lastActivity ?? 0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out.length > BUNDLE_BUBBLE.interiorMax ? out.slice(0, BUNDLE_BUBBLE.interiorMax) : out;
}
