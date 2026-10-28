/**
 * §5.5 #17-50 [버블] — 세션 버블 모델 → 캔버스가 그리는 모양(순수). 버블을 새로 그리지 않고 캔버스 배치 훅·`CanvasBubbleNode` 를 쓰므로
 * 캔버스 서버가 짓는 노드 모양 그대로 옮긴다: 안 = 첫 마디부터 계층(`internal_folder`), 밖 = 직속 부모 하나(`external_folder`, 파일 없으면 안 세움),
 * 웹 = `domain` · 명령 앱 = `bash`+`commandApp` · 서브에이전트 = `agent`, 선 = `ActivityEdge`(방향은 마지막 도구, §2.1 #3).
 * 노드 id 는 `sb:` 로 시작(캔버스와 한 화면이라 강조·미리보기 예산이 id 로 갈린다). 가운데만 데이터 id 가 그 에이전트, React Flow id 는 `SESSION_CENTER_NODE_ID`.
 */
import {
  BUNDLE_BUBBLE,
  DEFAULT_MAX_SATELLITES,
  READ_TOOLS,
  WEB_SEARCH_HOST,
  fileFaceKindOf,
  isMediaFaceKind,
  isPathWithin,
  keepSatelliteSeats,
  kindBundleCommonDir,
  normalizePathShape,
  pathKey,
  type ActivityEdge,
  type BubbleData,
  type KindBundleKind,
  type NodeStatus,
  type PlatformName,
} from '@vibisual/shared';
import type {
  SessionAppBubble,
  SessionBubbleModel,
  SessionFileBubble,
  SessionTaskBubble,
  SessionTouch,
  SessionWebBubble,
} from './sessionBubbles.js';

/** 지도의 가운데(그 에이전트) 노드의 React Flow id — 캔버스의 그 에이전트 노드 id 와 갈라 둔다(데이터 id 는 에이전트). */
export const SESSION_CENTER_NODE_ID = 'sb:center';

const ID = {
  folder: (key: string) => `sb:dir:${key}`,
  file: (key: string) => `sb:file:${key}`,
  web: (key: string) => `sb:${key}`,
  app: (key: string) => `sb:${key}`,
  task: (key: string) => `sb:${key}`,
  edge: (target: string) => `sb:edge:${target}`,
} as const;

/** 폴더 하나 — 세션 모델의 폴더(직속 부모·검색 범위)를 계층으로 다시 세운 것. 닿은 기록은 그 아래 전부를 합친 것이다. */
export interface SessionFolderNode extends SessionTouch {
  id: string;
  key: string;
  /** 전체 경로(모양만 정규화). */
  path: string;
  /** 프로젝트 기준 상대 경로(안쪽만 — 루트 자신은 폴더 버블이 아니다). */
  relPath: string | null;
  internal: boolean;
  label: string;
  /** 이 폴더를 검색 범위로 쓴 횟수(자기 몫만). */
  searches: number;
  /** 그 아래(모든 깊이)에서 만진 파일 — 최근 것부터. */
  files: SessionFileBubble[];
  /** 직속 하위 폴더 id(처음 닿은 순서). */
  subfolders: string[];
  /** 직속 파일(처음 닿은 순서). */
  directFiles: SessionFileBubble[];
  /** 한 단계 위 폴더 id — 최상위면 null. */
  parentId: string | null;
}

/** 정보 칸·더블클릭이 묻는 사실 — 노드 id(위성이면 `sat-` 를 뗀 것)로 찾는다. */
export type SessionCanvasEntry =
  | { kind: 'center' }
  | { kind: 'folder'; folder: SessionFolderNode }
  | { kind: 'file'; file: SessionFileBubble }
  | { kind: 'web'; web: SessionWebBubble }
  | { kind: 'app'; app: SessionAppBubble }
  | { kind: 'task'; task: SessionTaskBubble };

/** 폴더 안 화면의 재료 — `useFolderLayout` 에 그대로 넘긴다. */
export interface SessionCanvasFolder {
  bubble: BubbleData;
  /** 원 둘레 — 하위 폴더 · 직속 파일. */
  children: BubbleData[];
  /** 이 폴더(화면에서는 `← Back` 자리) ↔ 자식 선. */
  innerEdges: ActivityEdge[];
  parentId: string | null;
}

export interface SessionCanvasGraph {
  /** 가운데 — 캔버스의 그 에이전트 버블(상태만 이 칸의 판정). */
  center: BubbleData;
  /** 최상위 화면의 원 둘레 — 폴더 · 루트 직속 파일 · 웹 · 명령 앱 · 서브에이전트. */
  top: BubbleData[];
  /** 최상위 화면의 선 — 가운데(또는 경유 서브에이전트) ↔ 원 둘레. */
  edges: ActivityEdge[];
  /**
   * 폴더 id → 위성(최근 자리부터 `DEFAULT_MAX_SATELLITES` 자리 — 같은 미디어 종류는 한 자리). 최상위·폴더 안 화면이 같은 표를 쓴다.
   * 묶음이 될 종류의 위성은 서버 사본과 같은 표시 칸(주인 폴더 id · 그 아래 같은 종류 수 · 공통 폴더)을 실은 사본이다.
   */
  satellites: Record<string, BubbleData[]>;
  /** 폴더 id → 폴더 안 화면의 재료. */
  folders: Record<string, SessionCanvasFolder>;
  /** 폴더 id → 직속 자식(묶음 안이 그 폴더 아래 같은 종류를 깊이까지 더 세울 때 — `bundleInteriorMembers`). */
  children: Record<string, BubbleData[]>;
  /** 파일·폴더 노드(묶음 안이 구성 id 로 찾는다). */
  nodeMap: Record<string, BubbleData>;
  /** 노드 id → 정보 칸의 사실. 가운데는 `SESSION_CENTER_NODE_ID`. */
  entries: Map<string, SessionCanvasEntry>;
}

export interface SessionCanvasInput {
  model: SessionBubbleModel;
  /** 그 칸의 프로젝트 루트 — 안팎 판정·상대 경로·계층의 기준. 모르면 null(전부 바깥 폴더로 선다). */
  rootPath: string | null;
  platform: PlatformName;
  /** 이 칸이 지금 도는가 — 도는 동안만 결과가 안 온 호출이 `active`(흐르는 선 · 작업 파동). */
  running: boolean;
  agentId: string;
  /** 가운데가 될 캔버스의 그 에이전트 노드. 스냅샷에 없으면 null — 최소한의 에이전트 버블을 세운다. */
  agent: BubbleData | null;
  /** 「웹 검색」 버블 이름(번역 낱말 — 캔버스는 의사 호스트 글자 그대로다). */
  webSearchLabel: string;
  /** 같은 파일이 캔버스에 떠 있으면 그 크기·수정 시각(지름·미리보기 판본). */
  fileStats?: ((absPath: string) => { fileSize?: number; fileMtime?: number } | undefined) | undefined;
}

// ─── 닿은 기록 ─────────────────────────────────────────────────────────────

function emptyTouch(): SessionTouch {
  return {
    reads: 0, writes: 0, firstAt: Number.POSITIVE_INFINITY, lastAt: Number.NEGATIVE_INFINITY, lastTool: '',
    lastDirection: 'read', turnId: null, pending: false, direct: false, viaTaskKey: null,
  };
}

/** 두 기록을 합친다 — 횟수는 더하고, "마지막" 칸은 더 늦은 쪽이 갖는다. */
function mergeTouch(into: SessionTouch, t: SessionTouch): void {
  into.reads += t.reads;
  into.writes += t.writes;
  if (t.firstAt < into.firstAt) into.firstAt = t.firstAt;
  if (t.lastAt >= into.lastAt) {
    into.lastAt = t.lastAt;
    into.lastTool = t.lastTool;
    into.lastDirection = t.lastDirection;
    into.turnId = t.turnId;
    if (t.viaTaskKey !== null) into.viaTaskKey = t.viaTaskKey;
  }
  if (t.pending) into.pending = true;
  if (t.direct) into.direct = true;
  if (into.viaTaskKey === null && t.viaTaskKey !== null) into.viaTaskKey = t.viaTaskKey;
}

/**
 * 캔버스가 그 버블에 적는 도구 이름 — **방향에 맞게** 정규화한다. 캔버스 서버는 셸·웹 읽기를 `Read` 로 적어 "한 쌍에 방향은 하나"
 * 규칙을 태우고(§2.1 #3), 위성선 방향은 `READ_TOOLS` 로 가른다(`collectSatellites`). 쓰기인데 읽기 도구 이름이면 `Write` 다.
 */
export function canvasToolOf(t: Pick<SessionTouch, 'lastTool' | 'lastDirection'>): string {
  if (t.lastDirection === 'read') return READ_TOOLS.has(t.lastTool) ? t.lastTool : 'Read';
  return READ_TOOLS.has(t.lastTool) || t.lastTool === '' ? 'Write' : t.lastTool;
}

function statusOf(running: boolean, pending: boolean): NodeStatus {
  return running && pending ? 'active' : 'idle';
}

function lastSegment(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

// ─── 계층 ──────────────────────────────────────────────────────────────────

interface FolderDraft {
  node: SessionFolderNode;
  /** 세션 모델에 그 폴더 자신의 기록이 있었나(직속 파일·검색) — 그 기록이 합계의 출발점이다. */
  own: SessionTouch | null;
}

function newFolder(id: string, key: string, path: string, relPath: string | null, internal: boolean, label: string, parentId: string | null): SessionFolderNode {
  return {
    ...emptyTouch(), id, key, path, relPath, internal, label, searches: 0, files: [], subfolders: [], directFiles: [], parentId,
  };
}

/**
 * 세션 모델의 폴더들 → 캔버스와 같은 계층. 프로젝트 안은 루트 아래 첫 마디부터 마디마다 폴더 하나, 밖은 직속 부모 하나.
 * 돌려주는 순서는 **처음 닿은 순서**다(최상위 차례 = 등장 영역의 12시부터 시계 방향).
 */
function buildFolders(
  model: SessionBubbleModel,
  rootPath: string | null,
  platform: PlatformName,
): { folders: Map<string, FolderDraft>; rootFiles: SessionFileBubble[] } {
  const folders = new Map<string, FolderDraft>();
  const rootFiles: SessionFileBubble[] = [];
  const root = rootPath ? normalizePathShape(rootPath).replace(/\/+$/, '') : null;

  const ensure = (path: string, relPath: string | null, internal: boolean, label: string, parentId: string | null): FolderDraft => {
    const key = pathKey(path, platform);
    const id = ID.folder(key);
    let draft = folders.get(id);
    if (!draft) {
      draft = { node: newFolder(id, key, path, relPath, internal, label, parentId), own: null };
      folders.set(id, draft);
      if (parentId) folders.get(parentId)?.node.subfolders.push(id);
    }
    return draft;
  };

  for (const f of model.folders) {
    const internal = root !== null && f.internal && isPathWithin(f.path, root, platform);
    if (!internal) {
      // §2.1 — 만진 파일이 없는 외부 폴더는 서지 않는다(검색 범위만 닿은 곳은 바닥 줄 호출 수에만).
      if (f.files.length === 0) continue;
      const draft = ensure(normalizePathShape(f.path), null, false, normalizePathShape(f.path), null);
      draft.own = f;
      draft.node.searches += f.searches;
      draft.node.directFiles.push(...f.files);
      continue;
    }
    const rel = f.relPath ?? '';
    if (rel === '') {
      // 루트 자신은 폴더 버블이 아니다 — 그 직속 파일은 최상위에 선다(캔버스의 루트 직속 파일과 같은 자리).
      rootFiles.push(...f.files);
      continue;
    }
    const segments = rel.split('/').filter(Boolean);
    let parentId: string | null = null;
    let draft: FolderDraft | null = null;
    for (let i = 0; i < segments.length; i++) {
      const relPath = segments.slice(0, i + 1).join('/');
      draft = ensure(`${root}/${relPath}`, relPath, true, segments[i]!, parentId);
      parentId = draft.node.id;
    }
    if (!draft) continue;
    draft.own = f;
    draft.node.searches += f.searches;
    draft.node.directFiles.push(...f.files);
  }

  // 합계 — 자기 기록(직속 파일·검색이 이미 들어 있다) + 하위 폴더 합계. 깊은 것부터 위로 올린다.
  const ordered = [...folders.values()].sort((a, b) => depthOf(b.node, folders) - depthOf(a.node, folders));
  for (const draft of ordered) {
    const n = draft.node;
    if (draft.own) mergeTouch(n, draft.own);
    n.files.push(...n.directFiles);
    for (const subId of n.subfolders) {
      const sub = folders.get(subId)?.node;
      if (!sub) continue;
      mergeTouch(n, sub);
      n.files.push(...sub.files);
    }
    n.files.sort((a, b) => b.lastAt - a.lastAt);
  }
  return { folders, rootFiles };
}

function depthOf(node: SessionFolderNode, folders: ReadonlyMap<string, FolderDraft>): number {
  let depth = 0;
  let cur = node.parentId;
  while (cur) {
    depth += 1;
    cur = folders.get(cur)?.node.parentId ?? null;
  }
  return depth;
}

// ─── 노드 ──────────────────────────────────────────────────────────────────

function folderBubble(n: SessionFolderNode, running: boolean): BubbleData {
  return {
    id: n.id,
    label: n.label,
    bubbleType: n.internal ? 'internal_folder' : 'external_folder',
    path: n.internal ? (n.relPath ?? n.path) : n.path,
    absolutePath: n.path,
    status: statusOf(running, n.pending),
    activity: n.reads + n.writes + n.searches,
    lastActivity: n.lastAt,
    lastTool: canvasToolOf(n),
    // 캔버스와 같은 셈 — 직속 자식 수(하위 폴더 + 직속 파일) · 그 아래에서 만진 파일 수.
    childCount: n.subfolders.length + n.directFiles.length,
    satelliteFileCount: n.files.length,
    readCount: n.reads,
    writeCount: n.writes,
  };
}

function fileBubble(
  f: SessionFileBubble,
  input: SessionCanvasInput,
  root: string | null,
): BubbleData {
  const internal = root !== null && isPathWithin(f.path, root, input.platform);
  const rel = internal && root !== null ? f.path.slice(root.length).replace(/^\/+/, '') : null;
  const stats = input.fileStats?.(f.path);
  return {
    id: ID.file(f.key),
    label: f.name,
    bubbleType: 'file',
    path: rel || f.path,
    absolutePath: f.path,
    status: statusOf(input.running, f.pending),
    activity: f.reads + f.writes,
    lastActivity: f.lastAt,
    lastTool: canvasToolOf(f),
    readCount: f.reads,
    writeCount: f.writes,
    ...(stats?.fileSize !== undefined ? { fileSize: stats.fileSize } : {}),
    ...(stats?.fileMtime !== undefined ? { fileMtime: stats.fileMtime } : {}),
  };
}

/**
 * §5.1 #2-1 (B)(D) — 폴더 하나의 위성: 서버와 같은 `keepSatelliteSeats`(한 무리의 같은 미디어 종류는 한 자리)로 최근부터 `DEFAULT_MAX_SATELLITES` 자리.
 * 묶음이 될 종류의 위성은 서버 사본과 같은 표시 칸(주인 폴더 id · 그 종류 수 · 함께 든 가장 가까운 폴더)을 싣는다.
 */
function folderSatellites(n: SessionFolderNode, fileById: ReadonlyMap<string, BubbleData>, platform: PlatformName): BubbleData[] {
  const bubbleOf = (f: SessionFileBubble): BubbleData => fileById.get(ID.file(f.key))!;
  const keep = keepSatelliteSeats(
    n.files.map((f) => ({ id: ID.file(f.key), path: bubbleOf(f).path || f.path, lastActivity: f.lastAt })),
    DEFAULT_MAX_SATELLITES,
    { platform },
  );
  const kept = n.files.filter((f) => keep.has(ID.file(f.key)));
  const mediaKindOf = (f: SessionFileBubble): KindBundleKind | null => {
    const kind = fileFaceKindOf(f.path);
    return isMediaFaceKind(kind) ? kind : null;
  };
  const inList = new Map<KindBundleKind, number>();
  for (const f of kept) {
    const kind = mediaKindOf(f);
    if (kind) inList.set(kind, (inList.get(kind) ?? 0) + 1);
  }
  const shown = new Map<KindBundleKind, { count: number; dir: string }>();
  for (const [kind, count] of inList) {
    if (count < BUNDLE_BUBBLE.minMembers) continue;
    const all = n.files.filter((f) => mediaKindOf(f) === kind);
    shown.set(kind, { count: all.length, dir: kindBundleCommonDir(all.map((f) => bubbleOf(f).path || f.path), platform) });
  }
  return kept.map((f) => {
    const base = bubbleOf(f);
    const kind = mediaKindOf(f);
    const bundle = kind ? shown.get(kind) : undefined;
    return bundle ? { ...base, folderNodeId: n.id, folderKindCount: bundle.count, folderKindDir: bundle.dir } : base;
  });
}

function webBubble(w: SessionWebBubble, running: boolean, webSearchLabel: string): BubbleData {
  const search = w.kind === 'search';
  return {
    id: ID.web(w.key),
    label: search ? webSearchLabel : (w.host ?? ''),
    bubbleType: 'domain',
    path: search ? WEB_SEARCH_HOST : (w.host ?? ''),
    status: statusOf(running, w.pending),
    activity: w.reads,
    lastActivity: w.lastAt,
    lastTool: search ? 'WebSearch' : 'WebFetch',
    readCount: w.reads,
    childCount: 0,
  };
}

function appBubble(a: SessionAppBubble, running: boolean): BubbleData {
  return {
    id: ID.app(a.key),
    label: a.target.name,
    bubbleType: 'bash',
    path: ID.app(a.key),
    status: statusOf(running, a.pending),
    activity: a.reads + a.writes,
    lastActivity: a.lastAt,
    lastTool: a.lastTool,
    commandApp: a.target,
  };
}

function taskBubble(t: SessionTaskBubble, running: boolean): BubbleData {
  return {
    id: ID.task(t.key),
    label: t.description,
    bubbleType: 'agent',
    path: '',
    status: running && !t.done ? 'active' : 'idle',
    activity: t.reads + t.writes,
    lastActivity: t.lastAt,
    lastTool: t.lastTool,
    // 우리가 띄운 세션의 안쪽이다 — 훅 톤·HOOK 표식이 아니라 그 세션과 같은 결로 선다.
    customCreated: true,
  };
}

/**
 * 가운데 — 캔버스의 그 에이전트 노드 그대로. 상태만 이 칸의 판정: 이 칸이 돌면 `active`, 안 돌면 다른 세션 때문에 켜진
 * `active` 는 `idle` 로(완료·실패·권한 대기 표시는 그 노드의 것 그대로).
 */
function centerBubble(input: SessionCanvasInput): BubbleData {
  const base: BubbleData = input.agent ?? {
    id: input.agentId, label: '', bubbleType: 'agent', path: '', status: 'idle', activity: 1,
  };
  const status: NodeStatus = input.running ? 'active' : base.status === 'active' ? 'idle' : base.status;
  return status === base.status ? base : { ...base, status };
}

/** 선 하나 — 읽기 = 버블 → 주인, 쓰기 = 주인 → 버블(§2.1 #3). */
function activityEdge(ownerId: string, targetId: string, t: SessionTouch, running: boolean): ActivityEdge {
  const read = t.lastDirection === 'read';
  return {
    id: ID.edge(targetId),
    source: read ? targetId : ownerId,
    target: read ? ownerId : targetId,
    label: canvasToolOf(t),
    timestamp: t.lastAt,
    isActive: running && t.pending,
  };
}

// ─── 짓기 ──────────────────────────────────────────────────────────────────

export function buildSessionCanvasGraph(input: SessionCanvasInput): SessionCanvasGraph {
  const { model, platform, running } = input;
  const root = input.rootPath ? normalizePathShape(input.rootPath).replace(/\/+$/, '') : null;
  const center = centerBubble(input);
  const { folders, rootFiles } = buildFolders(model, root, platform);
  const entries = new Map<string, SessionCanvasEntry>([[SESSION_CENTER_NODE_ID, { kind: 'center' }]]);
  const nodeMap: Record<string, BubbleData> = {};

  // 서브에이전트 — 다른 버블의 선이 그것에서 나올 수 있어 먼저 세운다.
  const taskIds = new Set<string>();
  const taskBubbles: BubbleData[] = model.tasks.map((t) => {
    const b = taskBubble(t, running);
    taskIds.add(b.id);
    entries.set(b.id, { kind: 'task', task: t });
    return b;
  });
  /** 그 버블의 선이 나오는 주인 — 중첩 서브에이전트로만 닿았으면 그 서브에이전트, 아니면 가운데. */
  const ownerOf = (t: SessionTouch): string => {
    if (!t.direct && t.viaTaskKey !== null) {
      const viaId = ID.task(t.viaTaskKey);
      if (taskIds.has(viaId)) return viaId;
    }
    return center.id;
  };

  // 파일 — 묶음의 수·범위·이름은 위성 사본이 싣는다(`folderSatellites`).
  const fileById = new Map<string, BubbleData>();
  const fileOf = (f: SessionFileBubble): BubbleData => {
    const id = ID.file(f.key);
    let b = fileById.get(id);
    if (!b) {
      b = fileBubble(f, input, root);
      fileById.set(id, b);
      nodeMap[id] = b;
      entries.set(id, { kind: 'file', file: f });
    }
    return b;
  };
  for (const draft of folders.values()) {
    for (const f of draft.node.directFiles) fileOf(f);
  }
  for (const f of rootFiles) fileOf(f);

  // 폴더 — 버블 · 위성 · 폴더 안 화면.
  const folderBubbles = new Map<string, BubbleData>();
  for (const draft of folders.values()) {
    const b = folderBubble(draft.node, running);
    folderBubbles.set(b.id, b);
    nodeMap[b.id] = b;
    entries.set(b.id, { kind: 'folder', folder: draft.node });
  }
  const satellites: Record<string, BubbleData[]> = {};
  const folderViews: Record<string, SessionCanvasFolder> = {};
  const children: Record<string, BubbleData[]> = {};
  for (const draft of folders.values()) {
    const n = draft.node;
    satellites[n.id] = folderSatellites(n, fileById, platform);
    const kids: BubbleData[] = [];
    const innerEdges: ActivityEdge[] = [];
    for (const subId of n.subfolders) {
      const sub = folders.get(subId)?.node;
      const subBubble = folderBubbles.get(subId);
      if (!sub || !subBubble) continue;
      kids.push(subBubble);
      innerEdges.push(activityEdge(n.id, subId, sub, running));
    }
    for (const f of n.directFiles) {
      const b = fileById.get(ID.file(f.key))!;
      kids.push(b);
      innerEdges.push(activityEdge(n.id, b.id, f, running));
    }
    children[n.id] = kids;
    folderViews[n.id] = { bubble: folderBubbles.get(n.id)!, children: kids, innerEdges, parentId: n.parentId };
  }

  // 최상위 — 처음 닿은 순서(등장 영역의 차례). 폴더는 최상위 것만(안쪽은 들어가서 본다).
  type TopItem = { at: number; bubble: BubbleData; touch: SessionTouch };
  const tops: TopItem[] = [];
  for (const draft of folders.values()) {
    if (draft.node.parentId !== null) continue;
    tops.push({ at: draft.node.firstAt, bubble: folderBubbles.get(draft.node.id)!, touch: draft.node });
  }
  for (const f of rootFiles) tops.push({ at: f.firstAt, bubble: fileById.get(ID.file(f.key))!, touch: f });
  for (const w of model.webs) {
    const b = webBubble(w, running, input.webSearchLabel);
    entries.set(b.id, { kind: 'web', web: w });
    tops.push({ at: w.firstAt, bubble: b, touch: w });
  }
  for (const a of model.apps) {
    const b = appBubble(a, running);
    entries.set(b.id, { kind: 'app', app: a });
    tops.push({ at: a.firstAt, bubble: b, touch: a });
  }
  model.tasks.forEach((t, i) => tops.push({ at: t.firstAt, bubble: taskBubbles[i]!, touch: t }));
  tops.sort((a, b) => a.at - b.at);

  const edges: ActivityEdge[] = tops.map(({ bubble, touch }) => {
    // 서브에이전트 버블의 선은 그것을 띄운 쪽에서 나온다(가운데 또는 바깥 서브에이전트) — 띄운 것은 쓰기 방향이다.
    if (bubble.bubbleType === 'agent') {
      const t = entries.get(bubble.id);
      const task = t?.kind === 'task' ? t.task : null;
      const owner = task ? ownerOf(task) : center.id;
      return {
        id: ID.edge(bubble.id), source: owner === bubble.id ? center.id : owner, target: bubble.id,
        label: bubble.lastTool ?? '', timestamp: touch.lastAt, isActive: running && task !== null && !task.done,
      };
    }
    return activityEdge(ownerOf(touch), bubble.id, touch, running);
  });

  return {
    center,
    top: tops.map((t) => t.bubble),
    edges,
    satellites,
    folders: folderViews,
    children,
    nodeMap,
    entries,
  };
}

/** 노드 id(위성이면 `sat-` 붙은 것) → 정보 칸의 사실. 묶음 버블처럼 사실이 없는 자리는 null. */
export function sessionCanvasEntryOf(graph: Pick<SessionCanvasGraph, 'entries'>, nodeId: string): SessionCanvasEntry | null {
  const id = nodeId.startsWith('sat-') ? nodeId.slice(4) : nodeId;
  return graph.entries.get(id) ?? null;
}

/** 폴더의 짧은 이름 — 바깥 폴더는 전체 경로가 이름이라(캔버스 규칙) 경로 표시에서는 끝 마디로 줄인다. */
export function folderCrumbLabel(folder: Pick<SessionFolderNode, 'internal' | 'label' | 'path'>): string {
  return folder.internal ? folder.label : lastSegment(folder.path);
}
