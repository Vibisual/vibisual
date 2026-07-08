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
  ProjectIdentity,
  ProjectMeta,
  ProjectMetaSnapshot,
} from '@vibisual/shared';
import {
  CHECKPOINT_BACKUP_GENERATIONS,
  CHECKPOINT_EMPTY_GUARD_MIN_PRIOR,
  CHECKPOINT_SHRINK_GUARD_MIN_PRIOR,
  CHECKPOINT_SHRINK_GUARD_RATIO,
  CHECKPOINT_SHRINK_GUARD_ENABLED,
} from '@vibisual/shared';
import { logger } from '../logger.js';

// v1.52: 체크포인트 = 각 프로젝트 폴더 안의 `<projectPath>/.vibisual/save/`.
// SCENARIO §3.2 / §3.5 — Vibisual 레포 안에는 다른 프로젝트의 데이터를 두지 않는다.
// 워크트리는 워크트리 폴더 자체 안(ProjectInfo.path 가 워크트리 절대경로).

const SAVE_SUBDIR = '.vibisual/save';
/** §3.2.2 v2.62 — 정체성 데이터 물리 분리 파일명. checkpoint.json 과 같은 save 디렉토리. */
const IDENTITY_FILENAME = 'identity.json';
const CHECKPOINT_FILENAME = 'checkpoint.json';

// ─── §3.2.1 v2.62 손실 방지 인프라: 원자적 쓰기 + 다세대 백업 + 복구 ───

/**
 * 원자적 파일 쓰기 — `<file>.tmp` 에 쓰고 fsync 후 rename 으로 교체.
 * 쓰는 도중 프로세스 종료·전원 손실에도 기존 파일이 반파되지 않는다(§3.2.1-1).
 * rename 은 같은 디렉토리 내에서 원자적. 디렉토리 fsync 까지 시도(가능한 플랫폼).
 */
export function atomicWriteFileSync(filePath: string, data: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, data, 'utf8');
    try { fs.fsyncSync(fd); } catch { /* 일부 FS 는 fsync 미지원 — best effort */ }
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
  // 디렉토리 엔트리(rename 메타데이터)도 디스크 도달 강제 — 전원 손실 시 옛 파일 부활 방지.
  try {
    const dfd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(dfd); } catch { /* Windows 등은 디렉토리 fsync 미지원 — best effort */ }
    finally { fs.closeSync(dfd); }
  } catch { /* 디렉토리 open 실패해도 rename 자체는 이미 완료 */ }
}

/**
 * 저장 직전 기존 파일을 다세대 백업으로 회전(`<file>.bak1 → .bak2 → ... → .bakN`).
 * 가장 오래된 세대(.bakN)는 폐기, 현재 파일을 .bak1 로 복사(원자 쓰기가 곧 덮어쓸 것이므로
 * 복사 후 보존). 논리적 실수(빈/급감 저장)·사용자 실수의 수동 복구 안전망(§3.2.1-2).
 */
export function rotateBackups(filePath: string, generations: number = CHECKPOINT_BACKUP_GENERATIONS): void {
  if (generations < 1) return;
  if (!fs.existsSync(filePath)) return;
  try {
    // 가장 오래된 것부터 한 칸씩 밀어낸다: .bak(N-1) → .bakN, ..., .bak1 → .bak2
    for (let i = generations - 1; i >= 1; i -= 1) {
      const from = `${filePath}.bak${i}`;
      const to = `${filePath}.bak${i + 1}`;
      if (fs.existsSync(from)) {
        try { fs.renameSync(from, to); } catch { /* 한 세대 밀기 실패는 비치명 */ }
      }
    }
    // 현재 파일 → .bak1 (copy: 원본은 곧 atomicWrite 가 교체하므로 복사로 보존)
    fs.copyFileSync(filePath, `${filePath}.bak1`);
  } catch (err) {
    logger.warn(`rotateBackups: failed for ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 백업 세대(.bak1~N)에서 유효 JSON 을 찾아 파싱 반환. 손상 시 다음 세대 시도(§3.2.1-4). */
export function loadFromBackups<T>(
  filePath: string,
  validate: (obj: Record<string, unknown>) => boolean,
  generations: number = CHECKPOINT_BACKUP_GENERATIONS,
): { data: T; bakIndex: number } | null {
  for (let i = 1; i <= generations; i += 1) {
    const bak = `${filePath}.bak${i}`;
    if (!fs.existsSync(bak)) continue;
    try {
      const raw = fs.readFileSync(bak, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && validate(parsed as Record<string, unknown>)) {
        return { data: parsed as T, bakIndex: i };
      }
    } catch { /* 이 세대 손상 — 다음 세대로 */ }
  }
  return null;
}

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

  // §3.2.1-1 (v3.29): project.json 도 원자적 쓰기. 과거엔 plain writeFileSync 라 크래시가
  // 쓰기 도중이면 파일이 truncate → discoverProjectMetas 파싱 실패 → 부팅 시 프로젝트 소실로 이어졌다.
  atomicWriteFileSync(mp, JSON.stringify(meta, null, 2));
}

// ─── 체크포인트 ───

/**
 * §3.2.2 v2.62 — 체크포인트에서 정체성(identity) 데이터를 파생한다.
 * 잃으면 안 되는 것만 추린다: customCreated 에이전트 정체성 + agentConfigs + customLabels
 * + sessionCwds + taskEdges + commentBoxes + contis. 휘발성 런타임 상태는 제외.
 */
function deriveIdentity(cp: ProjectCheckpoint): ProjectIdentity {
  const customAgents: Record<string, BubbleData> = {};
  for (const [sessionId, agent] of Object.entries(cp.graph.agents)) {
    if (agent.customCreated) customAgents[sessionId] = agent;
  }
  return {
    version: 1,
    project: cp.project,
    savedAt: cp.savedAt ?? Date.now(),
    agentCounter: cp.graph.agentCounter,
    customAgents,
    agentConfigs: cp.agentConfigs ?? {},
    customLabels: cp.customLabels ?? {},
    sessionCwds: cp.graph.refs.sessionCwds ?? {},
    taskEdges: cp.taskEdges ?? {},
    commentBoxes: cp.commentBoxes ?? [],
    contis: cp.contis ?? {},
    deletedSessionIds: cp.deletedCustomAgentIds ?? [],
  };
}

function isValidIdentityObj(obj: Record<string, unknown>): boolean {
  // 전방 호환: version >= 1 이면 수용(미래 구조도 거부하지 않음, §3.2.1-5).
  const v = obj['version'];
  return typeof v === 'number' && v >= 1 && typeof obj['customAgents'] === 'object';
}

/** identity.json 1개를 읽어 반환(백업 복구 포함). 없거나 손상되면 null. */
export function loadIdentityFromDir(saveDir: string): ProjectIdentity | null {
  const filePath = path.join(saveDir, IDENTITY_FILENAME);
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && isValidIdentityObj(parsed as Record<string, unknown>)) {
        return parsed as ProjectIdentity;
      }
      logger.warn(`loadIdentity: ${filePath} invalid — trying backups`);
    }
  } catch (err) {
    logger.warn(`loadIdentity: parse failed at ${filePath} (${err instanceof Error ? err.message : String(err)}) — trying backups`);
  }
  const recovered = loadFromBackups<ProjectIdentity>(filePath, isValidIdentityObj);
  if (recovered) {
    logger.warn(`loadIdentity: recovered from ${IDENTITY_FILENAME}.bak${recovered.bakIndex}`);
    return recovered.data;
  }
  return null;
}

/**
 * §3.2.1-3 v2.63 — 빈/급감 덮어쓰기 거부 가드 (묘비 기반 정밀 구분).
 *
 * 디스크 identity 의 커스텀 에이전트 중, 지금 저장본에서 사라진 것들을 본다:
 *  - 사라진 게 **전부 묘비(deletedSessionIds)로 설명되면** = 사용자 명시 삭제 → 저장 진행(true).
 *  - 묘비로 **설명 안 되는 소멸이 하나라도 있으면** = 복원 실패로 인한 유실 의심 → 보류(false).
 *
 * 이로써 "정상 삭제는 그대로 반영(유령 부활 ❌), 복원 실패는 디스크 보존(원본 파괴 ❌)"이
 * 깔끔히 갈린다. nextIdentity.deletedSessionIds 는 메모리 묘비의 직렬화본. true=저장 진행.
 */
function passesShrinkGuard(saveDir: string, nextIdentity: ProjectIdentity): boolean {
  const prev = loadIdentityFromDir(saveDir);
  if (!prev) return true; // 비교 대상 없음 — 첫 저장

  const prevIds = Object.keys(prev.customAgents ?? {});
  if (prevIds.length === 0) return true; // 디스크에 정체성이 없으면 보호할 것도 없음

  const nextAgents = nextIdentity.customAgents ?? {};
  const tombstones = new Set(nextIdentity.deletedSessionIds ?? []);

  // 디스크엔 있었는데 새 저장본엔 없고, 묘비로도 설명 안 되는 sessionId = 설명 불가 소멸.
  const unexplained = prevIds.filter((sid) => !(sid in nextAgents) && !tombstones.has(sid));
  if (unexplained.length > 0) {
    logger.warn(
      `writeCheckpoint: shrink guard — ${unexplained.length} custom agent(s) vanished without ` +
      `an explicit-delete tombstone (likely a failed restore / empty-state overwrite); ` +
      `preserving existing identity.json. Tombstoned (intentional) deletes still apply normally. ` +
      `Vanished ids: ${unexplained.slice(0, 5).map((s) => s.slice(0, 12)).join(', ')}` +
      `${unexplained.length > 5 ? ` (+${unexplained.length - 5})` : ''}`,
    );
    return false;
  }
  return true;
}

/**
 * §3.2.1-3 (v3.03) — 디스크 checkpoint(없으면 `.bak1`)에서 그래프 합계만 가볍게 읽는다.
 * `loadCheckpointFromPath` 는 매번 info 로그를 찍어 고빈도 저장 경로에 부적합하므로 별도 조용한 reader.
 */
function readCheckpointTotalsFromDisk(cpPath: string): { agents: number; nodes: number } | null {
  const tryRead = (f: string): { agents: number; nodes: number } | null => {
    try {
      if (!fs.existsSync(f)) return null;
      const o = JSON.parse(fs.readFileSync(f, 'utf8')) as Record<string, unknown>;
      if (!isValidCheckpointObj(o)) return null;
      const g = (o['graph'] ?? {}) as { agents?: Record<string, unknown>; nodes?: Record<string, unknown> };
      return { agents: Object.keys(g.agents ?? {}).length, nodes: Object.keys(g.nodes ?? {}).length };
    } catch {
      return null;
    }
  };
  return tryRead(cpPath) ?? tryRead(`${cpPath}.bak1`);
}

/**
 * §3.2.1-3 (v3.03) — checkpoint.json 빈/급감 덮어쓰기 거부 가드.
 * 크래시 후 재시작 시 빈 인스턴스가 멀쩡한 checkpoint 를 빈 그래프로 덮어쓰는 손실을 막는다.
 * 판정은 `graph.agents + graph.nodes` 합계 기준.
 * - (1) 통째-0 가드(1차 활성): 디스크 합계 ≥ MIN_PRIOR 인데 새 저장본 합계 == 0 → 거부.
 * - (2) 급감 비율 가드(기본 비활성): 정상 대량 만료 오탐 위험이 커 상수 토글로만 둔다.
 * 정상 만료는 프로젝트 루트 노드가 남아 통째-0 이 되지 않으므로 오탐하지 않는다.
 */
function passesCheckpointShrinkGuard(
  cpPath: string,
  next: ProjectCheckpoint,
): { ok: true } | { ok: false; reason: string } {
  const prev = readCheckpointTotalsFromDisk(cpPath);
  if (!prev) return { ok: true }; // 첫 저장 / 디스크에 비교 대상 없음 — 보호할 것 없음
  const prevTotal = prev.agents + prev.nodes;
  const nextAgents = Object.keys(next.graph?.agents ?? {}).length;
  const nextNodes = Object.keys(next.graph?.nodes ?? {}).length;
  const nextTotal = nextAgents + nextNodes;

  // (1) 통째-0 가드.
  if (prevTotal >= CHECKPOINT_EMPTY_GUARD_MIN_PRIOR && nextTotal === 0) {
    return {
      ok: false,
      reason: `prior had ${prevTotal} bubble(s) (agents=${prev.agents}, nodes=${prev.nodes}), next is empty — likely empty-instance overwrite`,
    };
  }

  // (2) 급감 비율 가드 — 기본 비활성. 활성화 시 묘비(deletedCustomAgentIds, =sessionId) 미설명 소멸 정밀 검증 필요.
  if (
    CHECKPOINT_SHRINK_GUARD_ENABLED &&
    prevTotal >= CHECKPOINT_SHRINK_GUARD_MIN_PRIOR &&
    nextTotal < prevTotal * CHECKPOINT_SHRINK_GUARD_RATIO
  ) {
    return { ok: false, reason: `steep shrink ${prevTotal}→${nextTotal} (ratio guard)` };
  }

  return { ok: true };
}

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

    const cpPath = path.join(dir, CHECKPOINT_FILENAME);

    // §3.2.1-3 (v3.03) checkpoint.json 통째-0 가드 — 빈 인스턴스가 멀쩡한 디스크를 덮어쓰는 손실 차단.
    // writeMeta(lastSavedAt 갱신)·백업 롤링보다 먼저 검사해 거부 시 디스크를 일절 건드리지 않는다.
    const cpVerdict = passesCheckpointShrinkGuard(cpPath, checkpoint);
    if (!cpVerdict.ok) {
      logger.warn(
        `writeCheckpoint: REFUSING checkpoint.json overwrite for "${checkpoint.project.name}" — ${cpVerdict.reason}; ` +
        `preserving existing checkpoint + backups (identity.json untouched)`,
      );
      return;
    }

    writeMeta(dir, checkpoint.project);

    const identity = deriveIdentity(checkpoint);

    // §3.2.1-3 빈/급감 가드 — identity 가 비어 보이면 identity.json 은 보존(체크포인트는 저장).
    // checkpoint.json 자체는 휘발성 포함 전체 스냅샷이라 정상 저장하되(현재 화면 반영),
    // 권위 있는 정체성 파일(identity.json)만 빈 상태로 덮어쓰지 않는다.
    const identityOk = passesShrinkGuard(dir, identity);

    // §3.2.1-2 백업 롤링 후 §3.2.1-1 원자적 쓰기.
    rotateBackups(cpPath);
    atomicWriteFileSync(cpPath, JSON.stringify(checkpoint));

    if (identityOk) {
      const idPath = path.join(dir, IDENTITY_FILENAME);
      rotateBackups(idPath);
      atomicWriteFileSync(idPath, JSON.stringify(identity));
    }

    const worktreeTag = checkpoint.project.parentProjectPath ? ' [worktree]' : '';
    logger.debug(
      `Checkpoint saved: ${checkpoint.project.name}${worktreeTag} (seq=${checkpoint.seq}, ` +
      `${Object.keys(checkpoint.graph.agents).length} agents, ` +
      `${Object.keys(checkpoint.graph.nodes).length} nodes, ` +
      `${Object.keys(identity.customAgents).length} custom identity${identityOk ? '' : ' [guarded]'})`,
    );
  } catch (err) {
    logger.error('Checkpoint write failed', err);
  }
}

function isValidCheckpointObj(obj: Record<string, unknown>): boolean {
  // 전방 호환(§3.2.1-5): version >= 1 이면 수용(미래 버전도 버리지 않음) + graph 존재.
  const v = obj['version'];
  return typeof v === 'number' && v >= 1 && typeof obj['graph'] === 'object' && obj['graph'] !== null;
}

/** 체크포인트 파일 1개를 읽어 반환. 경로 기반 — worktree/일반 공통.
 *  손상 시 .bak1~N 백업에서 복구 시도(§3.2.1-4). */
function loadCheckpointFromPath(filePath: string): ProjectCheckpoint | null {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const data: unknown = JSON.parse(raw);
      if (typeof data === 'object' && data !== null && isValidCheckpointObj(data as Record<string, unknown>)) {
        const cp = data as ProjectCheckpoint;
        const tag = cp.project.parentProjectPath ? ' [worktree]' : '';
        logger.info(`Checkpoint loaded: ${cp.project.name}${tag} (seq=${cp.seq})`);
        return cp;
      }
      logger.warn(`Checkpoint invalid (not version>=1 / no graph): ${filePath} — trying backups`);
    }
  } catch (err) {
    logger.error(`Checkpoint load failed: ${filePath} — trying backups`, err);
  }
  // §3.2.1-4 백업 복구 — 빈 상태로 출발하지 않는다.
  const recovered = loadFromBackups<ProjectCheckpoint>(filePath, isValidCheckpointObj);
  if (recovered) {
    logger.warn(`Checkpoint recovered from ${CHECKPOINT_FILENAME}.bak${recovered.bakIndex}: ${recovered.data.project?.name}`);
    return recovered.data;
  }
  return null;
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

  /** §3.2.1-4 (v3.29) project.json 이 없거나 손상됐을 때 checkpoint/identity(+백업)에서
   *  `project`(ProjectInfo) 를 복구한다. 작은 메타 파일 하나가 truncate 됐다고 프로젝트를
   *  잃지 않도록 하는 자가 치유 경로. path 가 비면 무효로 본다. */
  function recoverProjectInfo(saveDir: string): ProjectInfo | null {
    const cpPath = path.join(saveDir, 'checkpoint.json');
    const idPath = path.join(saveDir, IDENTITY_FILENAME);
    const candidates = [
      cpPath, `${cpPath}.bak1`, `${cpPath}.bak2`, `${cpPath}.bak3`,
      idPath, `${idPath}.bak1`, `${idPath}.bak2`, `${idPath}.bak3`,
    ];
    for (const f of candidates) {
      if (!fs.existsSync(f)) continue;
      try {
        const obj = JSON.parse(fs.readFileSync(f, 'utf8')) as { project?: ProjectInfo };
        if (obj?.project?.path) return obj.project;
      } catch { /* 이 후보 손상 — 다음 후보로 */ }
    }
    return null;
  }

  function buildSnap(saveDir: string): ProjectMetaSnapshot | null {
    const mp = path.join(saveDir, 'project.json');
    const cpPath = path.join(saveDir, 'checkpoint.json');
    // v2.62 — checkpoint.json 이 사라졌어도 identity.json(또는 그 백업)이 있으면 발견 대상.
    // loadCheckpointByMeta 가 identity 골격으로 부활시킨다(§3.2.2).
    const cpAlive = fs.existsSync(cpPath) || fs.existsSync(`${cpPath}.bak1`);
    const idAlive = fs.existsSync(path.join(saveDir, IDENTITY_FILENAME))
      || fs.existsSync(path.join(saveDir, `${IDENTITY_FILENAME}.bak1`));
    // 데이터 실체(checkpoint/identity)가 하나도 없으면 발견 대상 아님.
    if (!cpAlive && !idAlive) return null;

    // 1) 정상 경로 — project.json 파싱.
    if (fs.existsSync(mp)) {
      try {
        const meta = JSON.parse(fs.readFileSync(mp, 'utf8')) as ProjectMeta;
        if (meta?.project?.path) {
          let lastSavedAt = meta.lastSavedAt ?? 0;
          if (!lastSavedAt) {
            try { lastSavedAt = fs.statSync(fs.existsSync(cpPath) ? cpPath : mp).mtimeMs; } catch { /* keep 0 */ }
          }
          return { project: meta.project, lastSavedAt, createdAt: meta.createdAt, checkpointPath: cpPath, isHydrated: false };
        }
      } catch (err) {
        logger.warn(`discoverProjectMetas: failed to parse ${mp}: ${err instanceof Error ? err.message : String(err)} — recovering project from checkpoint/identity`);
      }
    }

    // 2) §3.2.1-4 자가 치유 — project.json 부재/손상. checkpoint/identity 에서 project 복구.
    const recovered = recoverProjectInfo(saveDir);
    if (!recovered) return null;
    let lastSavedAt = 0;
    try { lastSavedAt = fs.statSync(fs.existsSync(cpPath) ? cpPath : `${cpPath}.bak1`).mtimeMs; } catch { /* keep 0 */ }
    logger.warn(`discoverProjectMetas: recovered "${recovered.name}" @ ${recovered.path} from checkpoint/identity (project.json missing/corrupt) — data-loss guard.`);
    return { project: recovered, lastSavedAt, createdAt: lastSavedAt, checkpointPath: cpPath, isHydrated: false };
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

/**
 * §3.2.2 v2.62 — checkpoint 에 identity 의 정체성을 보충 병합한다(in-place).
 * checkpoint 가 비거나 일부 손실됐어도 identity.json 의 커스텀 에이전트/설정/엣지를 되살린다.
 * **이미 checkpoint 에 있는 키는 덮어쓰지 않는다**(checkpoint = 더 최신 휘발 상태 포함). 없으면 부활.
 */
function mergeIdentityIntoCheckpoint(cp: ProjectCheckpoint, identity: ProjectIdentity): void {
  // §3.2.1-3 v2.63 — 묘비 우선 합산: checkpoint 와 identity 양쪽 삭제 이력 합집합.
  //   부활 차단 + 다음 저장 왕복에서 묘비 유실 방지.
  const tombstones = new Set<string>([
    ...(cp.deletedCustomAgentIds ?? []),
    ...(identity.deletedSessionIds ?? []),
  ]);
  if (tombstones.size > 0) cp.deletedCustomAgentIds = [...tombstones];

  // 커스텀 에이전트 부활 — checkpoint.graph.agents 에 없고, **묘비에 없는** sessionId 만 보충.
  //   묘비에 있는(=사용자가 명시 삭제한) 에이전트는 절대 되살리지 않는다(유령 부활 차단).
  for (const [sessionId, agent] of Object.entries(identity.customAgents ?? {})) {
    if (tombstones.has(sessionId)) continue;
    if (!cp.graph.agents[sessionId]) cp.graph.agents[sessionId] = agent;
  }
  // sessionCwds 보충 — 저장 필터·재개 근거. 없고 묘비에도 없는 것만.
  cp.graph.refs.sessionCwds = cp.graph.refs.sessionCwds ?? {};
  for (const [sid, cwd] of Object.entries(identity.sessionCwds ?? {})) {
    if (tombstones.has(sid)) continue;
    if (!(sid in cp.graph.refs.sessionCwds)) cp.graph.refs.sessionCwds[sid] = cwd;
  }
  // agentConfigs 보충.
  if (identity.agentConfigs && Object.keys(identity.agentConfigs).length > 0) {
    cp.agentConfigs = cp.agentConfigs ?? {};
    for (const [id, cfg] of Object.entries(identity.agentConfigs)) {
      if (!(id in cp.agentConfigs)) cp.agentConfigs[id] = cfg;
    }
  }
  // customLabels 보충.
  if (identity.customLabels && Object.keys(identity.customLabels).length > 0) {
    cp.customLabels = cp.customLabels ?? {};
    for (const [id, label] of Object.entries(identity.customLabels)) {
      if (!(id in cp.customLabels)) cp.customLabels[id] = label;
    }
  }
  // taskEdges 보충.
  if (identity.taskEdges && Object.keys(identity.taskEdges).length > 0) {
    cp.taskEdges = cp.taskEdges ?? {};
    for (const [id, edge] of Object.entries(identity.taskEdges)) {
      if (!(id in cp.taskEdges)) cp.taskEdges[id] = edge;
    }
  }
  // commentBoxes 보충 — id 기준 합집합.
  if (identity.commentBoxes && identity.commentBoxes.length > 0) {
    const existing = cp.commentBoxes ?? [];
    const seen = new Set(existing.map((b) => b.id));
    cp.commentBoxes = [...existing, ...identity.commentBoxes.filter((b) => !seen.has(b.id))];
  }
  // contis 보충.
  if (identity.contis && Object.keys(identity.contis).length > 0) {
    cp.contis = cp.contis ?? {};
    for (const [id, conti] of Object.entries(identity.contis)) {
      if (!(id in cp.contis)) cp.contis[id] = conti;
    }
  }
  // agentCounter 는 최대값 유지(라벨 번호 역행 방지).
  cp.graph.agentCounter = Math.max(cp.graph.agentCounter ?? 0, identity.agentCounter ?? 0);
}

/** meta.checkpointPath의 체크포인트 1개를 로드 + identity.json 보충(§3.2.2). 검증 실패 시 null. */
export function loadCheckpointByMeta(meta: ProjectMetaSnapshot): ProjectCheckpoint | null {
  const saveDir = path.dirname(meta.checkpointPath);
  let cp = loadCheckpointFromPath(meta.checkpointPath);
  const identity = loadIdentityFromDir(saveDir);

  // checkpoint 가 완전히 죽었지만 identity 는 살아있으면 — identity 로 최소 골격을 세워 부활.
  if (!cp && identity) {
    logger.warn(`loadCheckpoint: checkpoint dead but identity.json alive — reconstructing skeleton for "${identity.project.name}"`);
    cp = buildCheckpointSkeletonFromIdentity(identity);
  }
  if (!cp) return null;

  if (identity) mergeIdentityIntoCheckpoint(cp, identity);
  return cp;
}

/** identity.json 만 살아남았을 때 — 최소 유효 ProjectCheckpoint 골격을 만든다(정체성 부활용). */
function buildCheckpointSkeletonFromIdentity(identity: ProjectIdentity): ProjectCheckpoint {
  // §3.2.1-3 — 골격 단계부터 묘비(명시 삭제) 에이전트는 제외(이후 merge 는 "없는 것만 보충"이라
  //   여기서 넣으면 제거되지 않으므로 처음부터 빼야 유령 부활이 안 생긴다).
  const tombstones = new Set(identity.deletedSessionIds ?? []);
  const liveAgents: Record<string, BubbleData> = {};
  for (const [sid, agent] of Object.entries(identity.customAgents ?? {})) {
    if (!tombstones.has(sid)) liveAgents[sid] = agent;
  }
  return {
    version: 1,
    project: identity.project,
    seq: 0,
    savedAt: identity.savedAt ?? Date.now(),
    graph: {
      agentCounter: identity.agentCounter ?? 0,
      agents: liveAgents,
      nodes: {},
      projects: { [identity.project.path.replace(/\\/g, '/').toLowerCase()]: identity.project },
      hierarchy: { topLevelPaths: [], childrenMap: {}, satelliteMap: {} },
      refs: { nodeAgentRefs: {}, sessionCwds: { ...identity.sessionCwds } },
    },
    activity: { bashHistory: {}, runningServers: {}, fileEdits: {} },
    edges: {
      main: { edges: {}, groups: {}, refs: {} },
      inner: { edges: {}, groups: {}, refs: {} },
    },
    agentConfigs: { ...identity.agentConfigs },
    customLabels: { ...identity.customLabels },
    taskEdges: { ...identity.taskEdges },
    commentBoxes: [...identity.commentBoxes],
    contis: { ...identity.contis },
    deletedCustomAgentIds: identity.deletedSessionIds ?? [],
  };
}

// ─── 스케줄러 ───

/** 체크포인트 저장 스케줄러 */
export class SaveScheduler {
  /**
   * 성능: 프로젝트 경로별 마지막으로 디스크에 쓴 체크포인트의 직렬화 결과.
   * 내용이 동일하면 디스크 쓰기(원자적 write + 백업 rotate)를 스킵한다. saveCheckpoint() 는
   * 매 hook 이벤트마다 "모든 프로젝트"를 저장하는데, 활동은 보통 한 프로젝트에서만 일어나므로
   * 안 바뀐 프로젝트의 반복 디스크 I/O 가 N-1 만큼 제거된다. 내용이 같을 때만 스킵하므로
   * debounce 와 달리 영속 유실 위험이 없다(종료 시 미저장분 같은 창이 존재하지 않음).
   */
  private lastWritten = new Map<string, string>();

  /** 단일 프로젝트 체크포인트 저장 */
  forceCheckpoint(checkpoint: ProjectCheckpoint): void {
    this.writeIfChanged(checkpoint);
  }

  /** 여러 프로젝트 체크포인트 일괄 저장 */
  forceCheckpointAll(checkpoints: ProjectCheckpoint[]): void {
    for (const cp of checkpoints) {
      this.writeIfChanged(cp);
    }
  }

  private writeIfChanged(cp: ProjectCheckpoint): void {
    const key = cp.project?.path ?? cp.project?.name ?? '';
    const json = JSON.stringify(cp);
    if (key && this.lastWritten.get(key) === json) return; // 내용 불변 — 디스크 쓰기 스킵
    writeCheckpoint(cp);
    if (key) this.lastWritten.set(key, json);
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
