import fs from 'node:fs';
import path from 'node:path';
import type {
  BubbleData,
  BashEntry,
  ServerEntry,
  FileEdit,
  ActivityEdge,
  ProjectInfo,
  ProjectCheckpoint,
  ProjectMeta,
  ProjectMetaSnapshot,
} from '@vibisual/shared';
import { logger } from '../logger.js';

// v1.52: 체크포인트 = 각 프로젝트 폴더 안의 `<projectPath>/.vibisual/save/`.
// SCENARIO §3.2 / §3.5 — Vibisual 레포 안에는 다른 프로젝트의 데이터를 두지 않는다.
// 워크트리는 워크트리 폴더 자체 안(ProjectInfo.path 가 워크트리 절대경로).

const SAVE_SUBDIR = '.vibisual/save';

// 마이그레이션 전용 — 구 위치는 1회만 스캔해서 끌어올린 뒤 .bak 백업.
const LEGACY_SAVE_ROOT = path.resolve(process.cwd(), '../../save');
const LEGACY_FILE = path.join(LEGACY_SAVE_ROOT, 'state.json');

/** ProjectInfo 기반 체크포인트 디렉토리.
 *  v1.52: `<projectPath>/.vibisual/save/`. 워크트리는 워크트리 자체 폴더 안(ProjectInfo.path 가 워크트리 절대경로). */
export function projectDirForInfo(info: ProjectInfo): string {
  // path 가 비어있는 ghost meta 방어 — writeCheckpoint 가드와 같은 기준.
  if (!info?.path) {
    throw new Error(`projectDirForInfo: ProjectInfo.path is empty for "${info?.name ?? 'unknown'}"`);
  }
  return path.join(info.path, SAVE_SUBDIR);
}

// ─── 레거시 SavedState (v1, 마이그레이션용) ───

export interface LegacySavedState {
  root: string | null;
  agentCounter: number;
  agents: [string, BubbleData][];
  nodes: [string, BubbleData][];
  childrenMap: [string, string[]][];
  topLevelPaths: string[];
  satelliteMap: [string, string[]][];
  agentSpecialPaths: [string, string[]][];
  bashHistory: [string, BashEntry[]][];
  runningServers: [string, ServerEntry[]][];
  fileEdits?: [string, FileEdit[]][];
  nodeAgentRefs?: [string, string[]][];
  sessionCwds?: [string, string][];
  projects?: [string, ProjectInfo][];
  mainEdges?: { edges: [string, ActivityEdge][]; groups: [string, string][]; refs: [string, string[]][] };
  innerEdges?: { edges: [string, ActivityEdge][]; groups: [string, string][]; refs: [string, string[]][] };
  savedAt: number;
}

// ─── 프로젝트 메타 ───

function writeMeta(dir: string, project: ProjectInfo): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const meta: ProjectMeta = {
    project,
    createdAt: Date.now(),
    lastSavedAt: Date.now(),
  };

  // 기존 메타가 있으면 createdAt 유지
  const mp = path.join(dir, 'project.json');
  if (fs.existsSync(mp)) {
    try {
      const existing = JSON.parse(fs.readFileSync(mp, 'utf8')) as ProjectMeta;
      meta.createdAt = existing.createdAt;
    } catch { /* 파싱 실패 시 새로 생성 */ }
  }

  fs.writeFileSync(mp, JSON.stringify(meta, null, 2), 'utf8');
}

// ─── 체크포인트 ───

export function writeCheckpoint(checkpoint: ProjectCheckpoint): void {
  // Ghost 체크포인트 생성 방지 가드.
  // project.path 가 비었거나 name 이 placeholder("unknown") 면 저장 거부.
  // 과거 연쇄 데이터 손실(ghost 메타가 Vibisual 인스턴스 키 선점 → 빈 상태로 덮어쓰기)의 진원지였음.
  // 정상 프로젝트는 registerProject 시점에 반드시 유효한 path/name 을 갖기에 여기서 걸리지 않는다.
  const proj = checkpoint?.project;
  if (!proj || !proj.name || proj.name === 'unknown' || !proj.path) {
    logger.warn(
      `writeCheckpoint: refusing to save invalid project ` +
      `{ name: ${JSON.stringify(proj?.name)}, path: ${JSON.stringify(proj?.path)} } — ghost prevention`,
    );
    return;
  }
  // v1.52: 프로젝트 폴더가 디스크에서 사라졌으면 저장하지 않는다 (orphan ghost 방지).
  // 예: 사용자가 폴더를 삭제했는데 인메모리 인스턴스가 남아있는 케이스.
  if (!fs.existsSync(proj.path)) {
    logger.warn(`writeCheckpoint: project path missing on disk: ${proj.path} — skipping write`);
    return;
  }
  try {
    const dir = projectDirForInfo(checkpoint.project);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    writeMeta(dir, checkpoint.project);
    fs.writeFileSync(path.join(dir, 'checkpoint.json'), JSON.stringify(checkpoint), 'utf8');

    const worktreeTag = checkpoint.project.parentProjectPath ? ' [worktree]' : '';
    logger.debug(
      `Checkpoint saved: ${checkpoint.project.name}${worktreeTag} (seq=${checkpoint.seq}, ` +
      `${Object.keys(checkpoint.graph.agents).length} agents, ` +
      `${Object.keys(checkpoint.graph.nodes).length} nodes)`,
    );
  } catch (err) {
    logger.error('Checkpoint write failed', err);
  }
}

/** 체크포인트 파일 1개를 읽어 반환. 경로 기반 — worktree/일반 공통. */
function loadCheckpointFromPath(filePath: string): ProjectCheckpoint | null {
  try {
    if (!fs.existsSync(filePath)) return null;

    const raw = fs.readFileSync(filePath, 'utf8');
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return null;
    const obj = data as Record<string, unknown>;
    if (obj['version'] !== 1 || !obj['graph']) return null;

    const cp = data as ProjectCheckpoint;
    const tag = cp.project.parentProjectPath ? ' [worktree]' : '';
    logger.info(`Checkpoint loaded: ${cp.project.name}${tag} (seq=${cp.seq})`);
    return cp;
  } catch (err) {
    logger.error(`Checkpoint load failed: ${filePath}`, err);
    return null;
  }
}

/** v1.52: 분산 저장에선 워크트리 체크포인트가 워크트리 폴더 자체에 살므로
 *  `git worktree remove` 시 함께 사라진다 → orphan prune 자체가 필요 없다.
 *  하위호환을 위해 noop 함수로 유지(호출부 단계적 정리). */
export function pruneOrphanWorktreeDirs(_liveProjects: ProjectInfo[]): number {
  return 0;
}

// ─── Lazy API ───

/** v1.52: AppState.projectPaths 의 절대경로 목록을 받아 각 프로젝트의 메타만 수집.
 *  - 일반 프로젝트: `<path>/.vibisual/save/{project.json,checkpoint.json}`
 *  - 워크트리: 부모 프로젝트의 git worktree 디렉토리들도 함께 스캔(`<parentPath>/.claude/worktrees/<wt>/.vibisual/save/`).
 *    부모 프로젝트가 openProjects 에 있으면 워크트리도 stub 으로 자동 발견됨(SCENARIO §5.7 #26).
 *  - dedup: 같은 ProjectInfo.path 기준 lastSavedAt 최신 1건만 유지. */
export function discoverProjectMetas(projectPaths: string[]): ProjectMetaSnapshot[] {
  const byPath = new Map<string, ProjectMetaSnapshot>();

  function buildSnap(saveDir: string): ProjectMetaSnapshot | null {
    const mp = path.join(saveDir, 'project.json');
    const cpPath = path.join(saveDir, 'checkpoint.json');
    if (!fs.existsSync(mp) || !fs.existsSync(cpPath)) return null;
    try {
      const meta = JSON.parse(fs.readFileSync(mp, 'utf8')) as ProjectMeta;
      let lastSavedAt = meta.lastSavedAt ?? 0;
      if (!lastSavedAt) {
        try { lastSavedAt = fs.statSync(cpPath).mtimeMs; } catch { /* keep 0 */ }
      }
      return {
        project: meta.project,
        lastSavedAt,
        createdAt: meta.createdAt,
        checkpointPath: cpPath,
        isHydrated: false,
      };
    } catch (err) {
      logger.warn(`discoverProjectMetas: failed to parse ${mp}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  function upsert(snap: ProjectMetaSnapshot): void {
    const key = snap.project.path.replace(/\\/g, '/');
    const prev = byPath.get(key);
    if (!prev || snap.lastSavedAt > prev.lastSavedAt) {
      byPath.set(key, snap);
    }
  }

  for (const rawPath of projectPaths) {
    if (!rawPath) continue;
    const projectPath = rawPath.replace(/\\/g, '/');
    if (!fs.existsSync(projectPath)) {
      logger.warn(`discoverProjectMetas: project path not found: ${projectPath} — skipping`);
      continue;
    }

    // 1) 본 프로젝트
    const saveDir = path.join(projectPath, SAVE_SUBDIR);
    const snap = buildSnap(saveDir);
    if (snap) upsert(snap);

    // 2) 워크트리들 — `<projectPath>/.claude/worktrees/<wt>/` 안의 `.vibisual/save/`.
    //    SCENARIO §5.7 #26: 부모 프로젝트가 openProjects 에 있으면 워크트리도 자동 노출.
    const wtRoot = path.join(projectPath, '.claude', 'worktrees');
    if (fs.existsSync(wtRoot)) {
      try {
        for (const wt of fs.readdirSync(wtRoot, { withFileTypes: true })) {
          if (!wt.isDirectory()) continue;
          const wtSaveDir = path.join(wtRoot, wt.name, SAVE_SUBDIR);
          const wtSnap = buildSnap(wtSaveDir);
          if (wtSnap) upsert(wtSnap);
        }
      } catch (err) {
        logger.warn(`discoverProjectMetas: worktree scan failed at ${wtRoot}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return [...byPath.values()];
}

/** meta.checkpointPath의 체크포인트 1개를 로드. 검증 실패 시 null. */
export function loadCheckpointByMeta(meta: ProjectMetaSnapshot): ProjectCheckpoint | null {
  return loadCheckpointFromPath(meta.checkpointPath);
}

// ─── 스케줄러 ───

/** 체크포인트 저장 스케줄러 */
export class SaveScheduler {
  /** 단일 프로젝트 체크포인트 저장 */
  forceCheckpoint(checkpoint: ProjectCheckpoint): void {
    writeCheckpoint(checkpoint);
  }

  /** 여러 프로젝트 체크포인트 일괄 저장 */
  forceCheckpointAll(checkpoints: ProjectCheckpoint[]): void {
    for (const cp of checkpoints) {
      writeCheckpoint(cp);
    }
  }
}

// ─── v1.52 마이그레이션: 구 SAVE_ROOT → 분산 저장 ───

/** 구 `<Vibisual>/save/<name>/` 및 `<Vibisual>/save/<name>/worktrees/<wt>/` 트리를 스캔하여
 *  각 메타의 `project.path` 기준 `<path>/.vibisual/save/` 로 1회 이전한다.
 *  - 도착지가 이미 존재하면 lastSavedAt 비교 후 더 새로운 쪽 보존.
 *  - 이전 후 구 SAVE_ROOT 는 `<Vibisual>/save.bak-v1.52/` 로 rename (재마이그레이션 방지 + 사용자 안전망).
 *  - 호출자: 서버 부팅 시 `discoverProjectMetas` 직전. */
export function migrateLegacySaveRootToProjectDirs(): { moved: number; skipped: number; bakPath: string | null } {
  let moved = 0;
  let skipped = 0;
  let bakPath: string | null = null;

  if (!fs.existsSync(LEGACY_SAVE_ROOT)) return { moved, skipped, bakPath };

  // 가드: 진짜 프로젝트 데이터(project.json 가진 하위 디렉토리)가 있을 때만 마이그레이션 실행.
  // 디버그 로그나 잡 파일만 있으면 무한 백업 증식 방지(이미 v1.52 마이그레이션 1회 완료된 환경).
  const hasRealProjectData = (() => {
    try {
      for (const d of fs.readdirSync(LEGACY_SAVE_ROOT, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const parentDir = path.join(LEGACY_SAVE_ROOT, d.name);
        if (fs.existsSync(path.join(parentDir, 'project.json'))) return true;
        const wtRoot = path.join(parentDir, 'worktrees');
        if (fs.existsSync(wtRoot)) {
          for (const wt of fs.readdirSync(wtRoot, { withFileTypes: true })) {
            if (!wt.isDirectory()) continue;
            if (fs.existsSync(path.join(wtRoot, wt.name, 'project.json'))) return true;
          }
        }
      }
    } catch { /* fall through */ }
    return false;
  })();
  if (!hasRealProjectData) {
    logger.info('migrate: legacy save/ has no project.json — skipping (likely stray dir, not real legacy data)');
    return { moved, skipped, bakPath };
  }

  function moveOne(srcDir: string, kind: 'project' | 'worktree'): void {
    const mp = path.join(srcDir, 'project.json');
    const cp = path.join(srcDir, 'checkpoint.json');
    if (!fs.existsSync(mp) || !fs.existsSync(cp)) return;

    let meta: ProjectMeta;
    try {
      meta = JSON.parse(fs.readFileSync(mp, 'utf8')) as ProjectMeta;
    } catch (err) {
      logger.warn(`migrate: parse failed at ${mp}: ${err instanceof Error ? err.message : String(err)}`);
      skipped += 1;
      return;
    }
    const dest = meta.project?.path;
    if (!dest) {
      logger.warn(`migrate: meta has no project.path at ${mp} — skipping`);
      skipped += 1;
      return;
    }
    if (!fs.existsSync(dest)) {
      logger.warn(`migrate: project path missing on disk: ${dest} — skipping (data preserved in legacy save/)`);
      skipped += 1;
      return;
    }
    const destDir = path.join(dest, SAVE_SUBDIR);
    try {
      // 도착지가 이미 있고 더 최신이면 보존(구 데이터 폐기), 아니면 덮어씀.
      if (fs.existsSync(path.join(destDir, 'checkpoint.json'))) {
        let destNewer = false;
        try {
          const existingMeta = JSON.parse(fs.readFileSync(path.join(destDir, 'project.json'), 'utf8')) as ProjectMeta;
          destNewer = (existingMeta.lastSavedAt ?? 0) >= (meta.lastSavedAt ?? 0);
        } catch { /* 비교 실패 시 안전하게 보존 */ destNewer = true; }
        if (destNewer) {
          logger.info(`migrate[${kind}]: destination newer at ${destDir} — keeping destination, dropping legacy`);
          skipped += 1;
          return;
        }
      }
      fs.mkdirSync(destDir, { recursive: true });
      // 파일 단위 복사(일부 경로 + 다양한 sub-streams 디렉토리 포함).
      copyDirRecursive(srcDir, destDir);
      moved += 1;
      logger.info(`migrate[${kind}]: ${srcDir} → ${destDir} (${meta.project.name})`);
    } catch (err) {
      logger.error(`migrate[${kind}]: failed at ${srcDir}: ${err instanceof Error ? err.message : String(err)}`);
      skipped += 1;
    }
  }

  try {
    for (const d of fs.readdirSync(LEGACY_SAVE_ROOT, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      // _app-state.json, .tmp 등은 디렉토리가 아니라 패스.
      const parentDir = path.join(LEGACY_SAVE_ROOT, d.name);
      moveOne(parentDir, 'project');

      const wtRoot = path.join(parentDir, 'worktrees');
      if (!fs.existsSync(wtRoot)) continue;
      for (const wt of fs.readdirSync(wtRoot, { withFileTypes: true })) {
        if (!wt.isDirectory()) continue;
        moveOne(path.join(wtRoot, wt.name), 'worktree');
      }
    }
  } catch (err) {
    logger.error('migrate: scan failed', err);
  }

  // 구 SAVE_ROOT 백업 — 향후 재마이그레이션 방지.
  // 이미 `<Vibisual>/save.bak-v1.52/` 가 있으면 타임스탬프 suffix 로 충돌 회피.
  try {
    let target = path.join(path.dirname(LEGACY_SAVE_ROOT), 'save.bak-v1.52');
    if (fs.existsSync(target)) {
      target = `${target}-${Date.now()}`;
    }
    fs.renameSync(LEGACY_SAVE_ROOT, target);
    bakPath = target;
    logger.info(`migrate: legacy save/ archived to ${target}`);
  } catch (err) {
    logger.warn(`migrate: failed to archive legacy save/: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { moved, skipped, bakPath };
}

function copyDirRecursive(src: string, dest: string): void {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

// ─── 레거시 마이그레이션 (v0 → v1: state.json) ───

function legacyEdgesToSnapshot(
  legacy: { edges: [string, ActivityEdge][]; groups: [string, string][]; refs: [string, string[]][] } | undefined,
): { edges: Record<string, ActivityEdge>; groups: Record<string, string>; refs: Record<string, string[]> } {
  if (!legacy) return { edges: {}, groups: {}, refs: {} };
  const edges: Record<string, ActivityEdge> = {};
  for (const [k, v] of legacy.edges) edges[k] = v;
  const groups: Record<string, string> = {};
  for (const [k, v] of legacy.groups) groups[k] = v;
  const refs: Record<string, string[]> = {};
  for (const [k, v] of legacy.refs) refs[k] = v;
  return { edges, groups, refs };
}

function mapToRecord<V>(entries: [string, V][]): Record<string, V> {
  const result: Record<string, V> = {};
  for (const [k, v] of entries) result[k] = v;
  return result;
}

function setMapToRecord(entries: [string, string[]][]): Record<string, string[]> {
  return mapToRecord(entries);
}

/** 레거시 state.json → ProjectCheckpoint 변환.
 *  v1.52: 구 LEGACY_FILE 경로(`<Vibisual>/save/state.json`)는 `migrateLegacySaveRootToProjectDirs` 가
 *  먼저 save/ 전체를 백업하므로, 부팅 시퀀스상 구 save/ 가 살아있는 동안에만 호출해야 의미가 있다. */
export function migrateLegacy(): ProjectCheckpoint | null {
  try {
    if (!fs.existsSync(LEGACY_FILE)) return null;

    const raw = fs.readFileSync(LEGACY_FILE, 'utf8');
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null || !('agents' in data)) return null;

    const legacy = data as LegacySavedState;

    // 프로젝트 결정: projects 맵에서 첫 번째, 또는 root에서 추출
    let project: ProjectInfo;
    if (legacy.projects && legacy.projects.length > 0) {
      project = legacy.projects[0]![1];
    } else if (legacy.root) {
      project = {
        name: path.basename(legacy.root),
        path: legacy.root.replace(/\\/g, '/'),
      };
    } else {
      project = { name: 'unknown', path: '' };
    }

    const checkpoint: ProjectCheckpoint = {
      version: 1,
      project,
      seq: 0,
      savedAt: legacy.savedAt ?? Date.now(),

      graph: {
        agentCounter: legacy.agentCounter,
        agents: mapToRecord(legacy.agents),
        nodes: mapToRecord(legacy.nodes),
        projects: mapToRecord(legacy.projects ?? []),
        hierarchy: {
          topLevelPaths: legacy.topLevelPaths,
          childrenMap: setMapToRecord(legacy.childrenMap),
          satelliteMap: setMapToRecord(legacy.satelliteMap),
        },
        refs: {
          agentSpecialPaths: setMapToRecord(legacy.agentSpecialPaths),
          nodeAgentRefs: setMapToRecord(legacy.nodeAgentRefs ?? []),
          sessionCwds: mapToRecord(legacy.sessionCwds ?? []),
        },
      },

      activity: {
        bashHistory: mapToRecord(legacy.bashHistory),
        runningServers: mapToRecord(legacy.runningServers),
        fileEdits: mapToRecord(legacy.fileEdits ?? []),
      },

      edges: {
        main: legacyEdgesToSnapshot(legacy.mainEdges),
        inner: legacyEdgesToSnapshot(legacy.innerEdges),
      },
    };

    // 새 포맷으로 저장
    writeCheckpoint(checkpoint);
    logger.info(`Legacy state.json migrated to ${project.name}/checkpoint.json`);

    // 레거시 파일 백업
    const backupPath = LEGACY_FILE + '.bak';
    try { fs.renameSync(LEGACY_FILE, backupPath); } catch { /* 이미 save/ 백업으로 함께 이동했을 수 있음 */ }
    logger.info(`Legacy file backed up to ${backupPath}`);

    return checkpoint;
  } catch (err) {
    logger.error('Legacy migration failed', err);
    return null;
  }
}
