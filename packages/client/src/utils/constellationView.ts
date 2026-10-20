/**
 * §5.1 #2-1 (B) — 화면 하나(메인 · 폴더 안)의 **작업물 별자리 배치**.
 *
 * 판정은 shared `planConstellations` 한 곳이다(서버 위성 상한과 같은 답). 여기서는 그 답을 이 화면의 노드로 옮길 뿐이다:
 *  - 후보 = 이 화면에 선 파일 — 원 둘레(방사형) 파일 + 폴더·에이전트의 파일 위성.
 *  - **위성은 중심을 도는 위성이 된다** — 부모를 중심(파일이면 그 화면의 노드, 앱 노드면 그 노드)으로 바꾸고 선을 다시 건다.
 *    선의 모양·읽기/쓰기 방향은 종전 위성선 그대로다(`sat-edge-<id>` — 새 선 문법 ❌).
 *  - **직속 파일이 위성이 되면** 원 둘레 자리를 떠나 위성(`sat-<id>`)으로 선다. 그 파일로 들어오던 선은 호출부가
 *    `converted` 로 옮겨 단다.
 *  - 중심 사본에는 위성 수(`_moonCount`)를, 위성 사본에는 이유 꼬리표(`_constellation`)를 싣는다 — 둘 다 표시 전용이다.
 *  - 한 별자리의 위성끼리는 크기 범위를 함께 잰다(원래 부모가 갈려 있어도 한 무리로 보이게).
 *
 * 순수 함수다 — 스토어·DOM 을 보지 않고, 플랫폼은 인자로 받는다(멀티플랫폼 1축).
 */
import type { AppWorkRole, BubbleData, ConstellationAppHubInput, ConstellationMoon, ConstellationReason, FileFaceKind, HeatScale, PlatformName } from '@vibisual/shared';
import { BUBBLE_COLORS, READ_TOOLS, appWorkRoleOf, appWorkRoleRank, appWorkSeatAngles, planConstellations } from '@vibisual/shared';

import { calcBubbleSize, calcFileSizeRange } from './sizeCalc.js';
import type { EdgeInput, SatelliteInfo } from './satellite.js';
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
}

/** 위성 사본에 싣는 이유 꼬리표 — 툴팁이 "무엇과 · 왜"를 말한다. */
export interface ConstellationTag {
  readonly hubLabel: string;
  readonly reason: ConstellationReason;
  readonly viaLabel?: string;
  /** §5.1 #2-1 (F) — 앱 작업 보기의 위성이면 그 작업의 정보. */
  readonly work?: ConstellationWorkTag;
}

export interface ConstellationViewInput {
  /** 이 화면에서 원 둘레에 서는 버블 — 파일이 섞여 있으면 후보가 된다. */
  readonly radial: readonly BubbleData[];
  readonly satInfos: readonly SatelliteInfo[];
  readonly appHubs: readonly ConstellationAppHubView[];
  readonly heat: HeatScale | undefined;
  readonly platform: PlatformName;
  /** 서버에 저장된 위성 자리(`sat-<id>` → 좌표). 직속 파일이 위성이 될 때 그 자리가 있으면 쓴다. */
  readonly satellitePositions?: Readonly<Record<string, { x: number; y: number }>> | undefined;
}

export interface ConstellationViewResult {
  readonly radial: BubbleData[];
  readonly satInfos: SatelliteInfo[];
  /** 위성이 된 직속 파일: 원래 id → 위성 id. */
  readonly converted: ReadonlyMap<string, string>;
}

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
function tagOf(hubLabel: string, reason: ConstellationReason, viaLabel: string | undefined, work?: ConstellationWorkTag): ConstellationTag {
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

/** 이 노드가 끝점인 쪽의 반경을 바꾼 선(끝점 폴백 — 실측이 있으면 `CurvedEdge` 가 실측을 쓴다). */
function withRadius(edge: EdgeInput, nodeId: string, radius: number): EdgeInput {
  if (edge.source === nodeId) return { ...edge, sourceRadius: radius };
  if (edge.target === nodeId) return { ...edge, targetRadius: radius };
  return edge;
}

export function applyConstellations(input: ConstellationViewInput): ConstellationViewResult {
  const { radial, satInfos, appHubs, heat, platform } = input;
  const unchanged: ConstellationViewResult = { radial: [...radial], satInfos: [...satInfos], converted: new Map() };

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
  if (cands.length === 0 || (cands.length < 2 && appHubs.length === 0)) return unchanged;

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

  // 중심 사본 — 위성 수를 싣는다(크기 하한·궤도). 앱 노드 중심은 버블이 아니라 사본이 없다.
  const hubCopyByView = new Map<string, BubbleData>();
  for (const [hubId, moons] of plan.moonsOf) {
    const c = byFileId.get(hubId);
    if (c) hubCopyByView.set(c.viewId, { ...c.bubble, _moonCount: moons.length } as BubbleData);
  }
  const hubSize = (hubId: string): number => {
    const app = appById.get(hubId);
    if (app) return app.size;
    const c = byFileId.get(hubId);
    if (!c) return 0;
    return calcBubbleSize(hubCopyByView.get(c.viewId) ?? c.bubble, c.sat?.localRange, heat);
  };
  const viewIdOfHub = (hubId: string): string => (appById.has(hubId) ? hubId : byFileId.get(hubId)?.viewId ?? hubId);

  // 한 별자리의 위성끼리 크기 범위 · 그 안의 차례.
  const rangeByHub = new Map<string, { min: number; max: number }>();
  const orderOf = new Map<string, { index: number; total: number }>();
  for (const [hubId, moons] of plan.moonsOf) {
    const bubbles = moons.map((m) => byFileId.get(m.id)?.bubble).filter((b): b is BubbleData => b !== undefined);
    rangeByHub.set(hubId, calcFileSizeRange(bubbles));
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
        } : {}),
      });
    });
  }

  const makeMoon = (bubble: BubbleData, fileId: string, moon: ConstellationMoon, fromSat: boolean): SatelliteInfo => {
    const satId = `sat-${fileId}`;
    const parentId = viewIdOfHub(moon.hub);
    const parentSize = hubSize(moon.hub);
    const localRange = rangeByHub.get(moon.hub) ?? { min: 0, max: 0 };
    const work = workTagOf.get(fileId);
    const tag = tagOf(labelOf(moon.hub), moon.reason, moon.via !== undefined ? labelOf(moon.via) : undefined, work);
    const position = fromSat ? bubble.position : input.satellitePositions?.[satId];
    const seatAngle = seatOf.get(fileId);
    const satBubble = {
      ...bubble,
      id: satId,
      activity: 1,
      position,
      _constellation: tag,
      ...(seatAngle !== undefined ? { _seatAngle: seatAngle } : {}),
    } as BubbleData;
    const size = calcBubbleSize(satBubble, localRange, heat);
    const isRead = bubble.lastTool ? READ_TOOLS.has(bubble.lastTool) : false;
    const order = orderOf.get(fileId) ?? { index: 0, total: 1 };
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
      ...(seatAngle !== undefined ? { seatAngle } : {}),
      ...(appById.get(moon.hub)?.linksHidden === true ? { edgeHidden: true } : {}),
    };
  };

  // 원 둘레: 위성이 된 직속 파일은 빼고, 중심은 사본으로 바꿔 세운다.
  const converted = new Map<string, string>();
  const nextRadial: BubbleData[] = [];
  const convertedMoons: SatelliteInfo[] = [];
  for (const b of radial) {
    const moon = b.bubbleType === 'file' ? plan.memberOf.get(b.id) : undefined;
    if (moon) {
      converted.set(b.id, `sat-${b.id}`);
      convertedMoons.push(makeMoon(b, b.id, moon, false));
      continue;
    }
    nextRadial.push(hubCopyByView.get(b.id) ?? b);
  }

  // 위성: 위성이 아닌 것(중심 포함)을 먼저 — 새 위성의 첫 자리를 잡을 때 중심이 이미 자리에 있어야 한다.
  const staying: SatelliteInfo[] = [];
  const moons: SatelliteInfo[] = [];
  for (const s of satInfos) {
    const fileId = fileIdOfSat(s.bubble.id);
    const moon = s.bubble.bubbleType === 'file' ? plan.memberOf.get(fileId) : undefined;
    if (moon) {
      moons.push(makeMoon(s.bubble, fileId, moon, true));
      continue;
    }
    const hubCopy = hubCopyByView.get(s.bubble.id);
    if (!hubCopy) {
      staying.push(s);
      continue;
    }
    const size = calcBubbleSize(hubCopy, s.localRange, heat);
    staying.push({ ...s, bubble: hubCopy, edge: withRadius(s.edge, s.bubble.id, size / 2) });
  }

  return { radial: nextRadial, satInfos: [...staying, ...moons, ...convertedMoons], converted };
}
