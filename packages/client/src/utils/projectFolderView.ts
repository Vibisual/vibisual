/**
 * §5.1 #2-3 — 프로젝트 폴더 버블. 메인 화면에서 에이전트에 바로 붙던 프로젝트 루트 파일(과 그 파일들의 같은 종류 묶음)이
 * 둘 이상이면 내부 폴더 모양의 버블 하나로 접는다. 화면이 짓는 표시 전용 자리다(서버 노드·영속 ❌) — 다른 폴더 버블은 건드리지 않는다.
 */
import type { ActivityEdge, BubbleData, HeatScale, NodeStatus } from '@vibisual/shared';
import { DEFAULT_MAX_SATELLITES, READ_TOOLS, previewBundleKindOf } from '@vibisual/shared';
import { collectSatellites, type SatelliteInfo } from './satellite.js';
import { BUNDLE_NODE_PREFIX, withPreviewSeats } from './constellationView.js';

export const PROJECT_FOLDER_NODE_ID = '__project_folder__';
/** 이 수부터 접는다 — 하나뿐이면 폴더가 오히려 한 단계를 더한다. */
export const PROJECT_FOLDER_MIN_MEMBERS = 2;

const RADIAL_BUNDLE_PREFIX = `${BUNDLE_NODE_PREFIX}radial-`;

export function isProjectFolderNodeId(id: string | null | undefined): boolean {
  return id === PROJECT_FOLDER_NODE_ID;
}

/** 메인 원 둘레에서 프로젝트 루트에 속하는 것 — 최상위 파일과 그 파일들의 같은 종류 묶음(`bundle-radial-…`). */
export function isProjectRootMember(b: Pick<BubbleData, 'id' | 'bubbleType'>): boolean {
  return b.bubbleType === 'file' || (b.bubbleType === 'bundle' && b.id.startsWith(RADIAL_BUNDLE_PREFIX));
}

export interface ProjectFolderSource {
  /** 버블 이름 — 지금 탭의 프로젝트 표시명. */
  readonly label: string;
  /** 프로젝트 루트 절대경로(툴팁). */
  readonly absolutePath?: string | null | undefined;
  /** 서버 루트 노드 — 위성 상한을 그대로 따른다. */
  readonly root?: Pick<BubbleData, 'maxSatellites'> | undefined;
  /** 메인 화면의 최상위 파일 전부(앱 노드가 가져간 것 포함) — 수·활동·상태는 이것으로 잰다. */
  readonly files: readonly BubbleData[];
}

function aggregateStatus(files: readonly BubbleData[]): NodeStatus {
  if (files.some((f) => f.status === 'active')) return 'active';
  if (files.some((f) => f.status === 'completed')) return 'completed';
  return 'idle';
}

/** 프로젝트 폴더 버블 자체. 최상위 파일이 없으면 `null`. 같은 입력이면 같은 값이 나온다(노드 data 얕은 비교가 걸린다). */
export function projectFolderBubbleOf(src: ProjectFolderSource): BubbleData | null {
  if (src.files.length === 0) return null;
  let activity = 0;
  let reads = 0;
  let writes = 0;
  let last = 0;
  for (const f of src.files) {
    activity += f.activity ?? 0;
    reads += f.readCount ?? 0;
    writes += f.writeCount ?? 0;
    last = Math.max(last, f.lastActivity ?? 0);
  }
  return {
    id: PROJECT_FOLDER_NODE_ID,
    label: src.label,
    bubbleType: 'internal_folder',
    path: '',
    ...(src.absolutePath ? { absolutePath: src.absolutePath } : {}),
    status: aggregateStatus(src.files),
    activity: Math.max(1, activity),
    ...(last > 0 ? { lastActivity: last } : {}),
    childCount: src.files.length,
    ...(reads > 0 ? { readCount: reads } : {}),
    ...(writes > 0 ? { writeCount: writes } : {}),
    maxSatellites: src.root?.maxSatellites ?? DEFAULT_MAX_SATELLITES,
  };
}

/** 문서 칸을 쓰지 않는 위성 — 묶음과 미리보기 파일(폴더 위성 상한의 예외, §5.1 #2-1 (D)). */
function isPreviewSeat(b: BubbleData): boolean {
  return b.bubbleType === 'bundle' || previewBundleKindOf(b.absolutePath || b.path || b.label) !== null;
}

function byRecent(a: BubbleData, b: BubbleData): number {
  return (b.lastActivity ?? 0) - (a.lastActivity ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export interface ProjectFolderGroupInput {
  readonly folder: BubbleData;
  /** 별자리·원 둘레 묶음을 지은 뒤의 원 둘레. */
  readonly radial: readonly BubbleData[];
  readonly satInfos: readonly SatelliteInfo[];
  /** 원 둘레 묶음에 든 파일 → 묶음 id. 묶음 위성선의 방향(가장 최근 구성)을 찾는다. */
  readonly bundled: ReadonlyMap<string, string>;
  /** 별자리 전의 원 둘레 — 묶음 구성 파일을 찾는다. */
  readonly radialBefore: readonly BubbleData[];
  readonly heat: HeatScale | undefined;
  readonly satellitePositions?: Record<string, { x: number; y: number }> | undefined;
}

export interface ProjectFolderGroup {
  /** 구성 대신 폴더 하나가 가장 앞 구성의 차례에 선다. */
  readonly radial: BubbleData[];
  /** 폴더 위성(최근 문서 상한까지 + 미리보기·묶음 전부) + 위성 자리로 옮긴 묶음의 위성. */
  readonly satInfos: SatelliteInfo[];
  /** 원 둘레 구성 id(파일·묶음) → 폴더 id. 선 끝점을 옮긴다. */
  readonly memberOf: ReadonlyMap<string, string>;
}

/**
 * 원 둘레의 루트 구성이 `PROJECT_FOLDER_MIN_MEMBERS` 이상이면 폴더 하나로 접는다. 위성은 폴더 위성과 같은 규칙이다 — 문서는 최근 것부터
 * `maxSatellites` 까지, 미리보기 파일·묶음은 상한 밖이다. 원 둘레 묶음은 폴더의 위성 자리로 옮겨 서고(`sat-` 를 단다), 제 위성은 그대로 거느린다.
 */
export function groupProjectFolder(input: ProjectFolderGroupInput): ProjectFolderGroup | null {
  const members = input.radial.filter(isProjectRootMember);
  if (members.length < PROJECT_FOLDER_MIN_MEMBERS) return null;
  const { folder } = input;
  const memberOf = new Map(members.map((m) => [m.id, folder.id] as const));

  const cap = folder.maxSatellites ?? DEFAULT_MAX_SATELLITES;
  const recent = [...members].sort(byRecent);
  const docs = recent.filter((b) => !isPreviewSeat(b)).slice(0, Math.max(0, cap));
  const keep = new Set([...recent.filter(isPreviewSeat), ...docs].map((b) => b.id));

  // 묶음 위성선의 방향은 가장 최근 구성이 쓰던 읽기/쓰기다 — 묶음 자신에는 도구가 없어 구성에서 빌린다.
  const lastToolOfBundle = new Map<string, string>();
  const lastAtOfBundle = new Map<string, number>();
  for (const f of input.radialBefore) {
    const bundleId = input.bundled.get(f.id);
    if (bundleId === undefined || !f.lastTool) continue;
    const at = f.lastActivity ?? 0;
    if (at >= (lastAtOfBundle.get(bundleId) ?? -1)) {
      lastAtOfBundle.set(bundleId, at);
      lastToolOfBundle.set(bundleId, f.lastTool);
    }
  }
  const seats = recent.filter((b) => keep.has(b.id)).map((b) => {
    if (b.bubbleType !== 'bundle') return b;
    const tool = lastToolOfBundle.get(b.id);
    return tool ? { ...b, lastTool: tool } : b;
  });
  const folderSats = withPreviewSeats(
    collectSatellites([folder], { [folder.id]: seats }, input.heat, input.satellitePositions),
    [folder],
  );

  // 위성 자리로 옮긴 묶음 — 제 위성의 부모 id 와 선 끝점도 새 id 로 고쳐 단다.
  const renamed = new Map<string, string>();
  for (const m of members) if (m.bubbleType === 'bundle') renamed.set(m.id, `sat-${m.id}`);
  const rest = renamed.size === 0 ? [...input.satInfos] : input.satInfos.map((s) => {
    const parent = renamed.get(s.parentId);
    if (parent === undefined) return s;
    return {
      ...s,
      parentId: parent,
      edge: {
        ...s.edge,
        source: renamed.get(s.edge.source) ?? s.edge.source,
        target: renamed.get(s.edge.target) ?? s.edge.target,
      },
    };
  });

  const radial: BubbleData[] = [];
  let placed = false;
  for (const b of input.radial) {
    if (!memberOf.has(b.id)) { radial.push(b); continue; }
    if (!placed) { radial.push(folder); placed = true; }
  }
  return { radial, satInfos: [...rest, ...folderSats], memberOf };
}

/**
 * 에이전트 ↔ 구성 선을 에이전트 ↔ 폴더 선 하나로 접는다. 폴더처럼 한 쌍에 방향은 하나다(§2.1 #3) — 가장 최근 선의 방향을 따르고,
 * 하나라도 살아 있으면 산 선이다. `endOf` 는 끝점 id 를 폴더 id 로 옮기는 함수다(구성이 아니면 그대로 돌려준다).
 */
export function collapseProjectFolderEdges(
  edges: readonly ActivityEdge[],
  endOf: (id: string) => string,
  folderId: string = PROJECT_FOLDER_NODE_ID,
): ActivityEdge[] {
  const out: ActivityEdge[] = [];
  const at = new Map<string, number>();
  for (const e of edges) {
    const source = endOf(e.source);
    const target = endOf(e.target);
    if (source !== folderId && target !== folderId) { out.push(e); continue; }
    if (source === target) continue;
    const other = source === folderId ? target : source;
    const moved: ActivityEdge = { ...e, id: `${folderId}:${other}`, source, target };
    const i = at.get(other);
    if (i === undefined) {
      at.set(other, out.length);
      out.push(moved);
      continue;
    }
    const prev = out[i]!;
    const newer = e.timestamp > prev.timestamp || (e.timestamp === prev.timestamp && e.isActive && !prev.isActive);
    const pick = newer ? moved : prev;
    out[i] = { ...pick, isActive: prev.isActive || e.isActive };
  }
  return out;
}

/** 폴더 안 화면의 폴더 ↔ 파일 선 — 실제 폴더의 안쪽 선과 같은 모양(읽기는 파일 → 폴더, 그 밖은 폴더 → 파일). */
export function projectFolderInteriorEdges(
  files: readonly BubbleData[],
  folderId: string = PROJECT_FOLDER_NODE_ID,
): ActivityEdge[] {
  return files.map((f) => {
    const read = f.lastTool ? READ_TOOLS.has(f.lastTool) : false;
    return {
      id: `${folderId}:inner:${f.id}`,
      source: read ? f.id : folderId,
      target: read ? folderId : f.id,
      label: f.lastTool ?? '',
      timestamp: f.lastActivity ?? 0,
      isActive: f.status === 'active',
    };
  });
}
