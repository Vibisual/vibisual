import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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
  ROOT_NODE_KEY_PREFIX,
  LEGACY_ROOT_NODE_KEY,
  mergePathLocks,
} from '@vibisual/shared';
import { logger } from '../logger.js';
import {
  writeFileAtomicSyncRaw,
  queueAtomicWrite,
  flushPendingDiskWritesSync,
  acknowledgeSynchronousDiskWrite,
  retryFailedDiskWrites,
} from './diskWriteQueue.js';
import { isDeadWorktreeProject, isLiveWorktreeDir, isUnderDeadWorktree, shouldReportDeadWorktree } from './worktreeLiveness.js';
// 경로 대소문자 정책 SSOT — win32/darwin 만 접고 linux 는 접지 않는다.
import { pathKey } from './pathKey.js';

// §3.2 / §3.5 — 체크포인트는 각 프로젝트 폴더 안 `<projectPath>/.vibisual/save/`(이 레포에 남의 데이터를 두지 않는다). 워크트리는 그 워크트리 폴더 안.

const SAVE_SUBDIR = '.vibisual/save';
/** §3.2.2 — 정체성 데이터 분리 파일(같은 save 디렉토리). */
const IDENTITY_FILENAME = 'identity.json';
const CHECKPOINT_FILENAME = 'checkpoint.json';
/**
 * §3.2.2 — 활동 이력 전용 파일(§3.2 "별도 JSON 저장 금지"의 네 번째 명시적 예외).
 * `identity.json`(저빈도·고신뢰) / `checkpoint.json`(고빈도·그래프 골격) / `activity.json`(고빈도·이력) 3층.
 */
const ACTIVITY_FILENAME = 'activity.json';

// §3.2.1 손실 방지: 원자적 쓰기 + 다세대 백업 + 복구

/** 원자적 쓰기 — `.tmp` 에 쓰고 fsync 후 rename(같은 디렉토리 안에서 원자적). 도중 종료·전원 손실에도 반파되지 않는다(§3.2.1-1). 디렉토리 fsync 는 되는 플랫폼에서만. */
export function atomicWriteFileSync(filePath: string, data: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    // 최종 방어선: 죽은 워크트리(`.git` 없음) 안엔 mkdir 하지 않는다 — 지운 워크트리 폴더가 되살아나는 지점이다(가드를 뚫은 배경 쓰기까지 막는다).
    if (isUnderDeadWorktree(filePath)) {
      throw new Error(`refusing to create a directory inside a worktree that git no longer tracks: ${dir}`);
    }
    fs.mkdirSync(dir, { recursive: true });
  }
  // 쓰기 절차(tmp → fsync → rename → 디렉토리 fsync)의 **유일한 구현**은 diskWriteQueue 에 있다.
  // 여기(가드) 와 워커(성능) 가 같은 절차를 두 벌로 들고 있다가 어긋나는 것을 막기 위함이다.
  writeFileAtomicSyncRaw(filePath, data);
}

/**
 * §9 — 체크포인트 3종(core·activity·identity) 전용 쓰기 창구(가드 통과 뒤에만). 워커가 있으면 넘기고 즉시 돌아오고, 없거나 큐가 차면 동기로 쓴다.
 * ⚠ 범용 `atomicWriteFileSync` 는 비동기로 만들지 마라 — 쓴 직후 읽는 호출자가 옛 내용을 본다(체크포인트 읽기엔 `flushPendingDiskWritesSync()` 가 걸려 있다).
 */
function atomicWriteCheckpointFile(filePath: string, data: string): void {
  if (queueAtomicWrite(filePath, data)) return;
  atomicWriteFileSync(filePath, data);
  acknowledgeSynchronousDiskWrite(filePath);
}

/** 저장 직전 `.bak1 → … → .bakN` 회전(가장 오래된 것은 버리고 현재 파일을 .bak1 로 복사). 빈/급감 저장·실수를 손으로 되돌리는 안전망(§3.2.1-2). */
/** §9 — 파일당 최소 회전 간격. 저장마다 돌리면 같은 판본 3벌에 I/O 만 탄다 — 5분이면 .bak1~3 이 5·10·15분 전 판본이 된다(30초는 90초 안에 몰렸다, 실측). */
const ROTATE_MIN_INTERVAL_MS = 5 * 60_000;
const lastRotatedAt = new Map<string, number>();

export function rotateBackups(filePath: string, generations: number = CHECKPOINT_BACKUP_GENERATIONS): void {
  if (generations < 1) return;
  if (!fs.existsSync(filePath)) return;
  const now = Date.now();
  if (now - (lastRotatedAt.get(filePath) ?? 0) < ROTATE_MIN_INTERVAL_MS) return;
  lastRotatedAt.set(filePath, now);
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

/** 체크포인트 디렉토리 `<projectPath>/.vibisual/save/`(워크트리는 그 폴더 안). */
export function projectDirForInfo(info: ProjectInfo): string {
  // path 가 비어있는 ghost meta 방어 — writeCheckpoint 가드와 같은 기준.
  if (!info?.path) {
    throw new Error(`projectDirForInfo: ProjectInfo.path is empty for "${info?.name ?? 'unknown'}"`);
  }
  return path.join(info.path, SAVE_SUBDIR);
}

/**
 * §3.2.1-4 — 그 경로의 save 폴더에 파일이 하나라도 있는가(어느 파일이든 복구 근거). 부팅 청소가 "손상 → 보존"과 "프로젝트 아님 → 제거"를 가른다.
 * 접근 실패는 true — 판단이 안 서면 지우지 않는다.
 */
export function hasProjectSaveData(projectPath: string): boolean {
  if (!projectPath) return false;
  const saveDir = path.join(projectPath, SAVE_SUBDIR);
  try {
    if (!fs.existsSync(saveDir)) return false;
    return fs.readdirSync(saveDir).length > 0;
  } catch {
    return true;
  }
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

/** §9 — 내용이 같으면 lastSavedAt 만으로 이 간격보다 자주 다시 쓰지 않는다(그 값은 "더 새로운 쪽" 비교용이라 초 정밀도가 필요 없다). */
const META_REWRITE_MIN_INTERVAL_MS = 30_000;
const lastMetaWrite = new Map<string, { projectJson: string; writtenAt: number }>();

function writeMeta(dir: string, project: ProjectInfo): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const mp = path.join(dir, 'project.json');

  // §9 — 내용 불변 + 최근 기록이면 건너뛴다(바뀌면 즉시).
  const projectJson = JSON.stringify(project);
  const recent = lastMetaWrite.get(mp);
  if (recent && recent.projectJson === projectJson && Date.now() - recent.writtenAt < META_REWRITE_MIN_INTERVAL_MS) {
    return;
  }

  const meta: ProjectMeta = {
    project,
    createdAt: Date.now(),
    lastSavedAt: Date.now(),
  };

  // 기존 메타가 있으면 createdAt 유지
  if (fs.existsSync(mp)) {
    try {
      const existing = JSON.parse(fs.readFileSync(mp, 'utf8')) as ProjectMeta;
      meta.createdAt = existing.createdAt;
    } catch { /* 파싱 실패 시 새로 생성 */ }
  }

  // §3.2.1-1: project.json 도 원자적으로 — 도중 크래시로 잘리면 부팅 때 프로젝트가 사라진다.
  atomicWriteFileSync(mp, JSON.stringify(meta, null, 2));
  lastMetaWrite.set(mp, { projectJson, writtenAt: Date.now() });
}

// ─── 체크포인트 ───

/** §3.2.2 — 잃으면 안 되는 정체성만 추린다(휘발 런타임 상태 제외). */
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
    // §4 (설정 3층) — 갈라진 칸이 권위다. 완성본(`agentConfigs`)은 구버전 앱이 읽을 사본으로 함께 남긴다.
    agentConfigOverrides: cp.agentConfigOverrides,
    customLabels: cp.customLabels ?? {},
    sessionCwds: cp.graph.refs.sessionCwds ?? {},
    taskEdges: cp.taskEdges ?? {},
    commentBoxes: cp.commentBoxes ?? [],
    captureBubbles: cp.captureBubbles ?? [],
    appBubbles: cp.appBubbles ?? [],
    // §5.14 — 플레이 버블(놓은 버튼 + 확정 레시피)은 정체성이다.
    playBubbles: cp.playBubbles ?? [],
    // §5.15 — 스펙 보드는 사람이 쓴 요구사항 문장이라 잃으면 복구할 길이 없다(정체성).
    specDocs: cp.specDocs ?? [],
    // §5.18 — 에이전트 랩도 사람이 쓴 과제 문장 + 손으로 짠 설정 조합이라 정체성이다.
    labRuns: cp.labRuns ?? [],
    // §5.20 — 선반은 사람이 모아 둔 명령·프롬프트라 코드에서 되살릴 길이 없다(정체성).
    shelfBubbles: cp.shelfBubbles ?? [],
    contis: cp.contis ?? {},
    // §5.5 #17-17 — 세션 목표는 사람이 쓴 문장이라 정체성이다.
    sessionGoals: cp.sessionGoals ?? {},
    // §5.5 #17-17 ⑪(h) — 시각 종류 카드. 에이전트가 만든 것이라 잃으면 복구할 길이 없다.
    visualKinds: cp.visualKinds ?? {},
    // §5.5 #17-17 ⑫(b) — 팔레트 고정도 사용자가 고른 것이라 재계산으로 되살릴 수 없다.
    pinnedGoalActions: cp.pinnedGoalActions ?? [],
    // §5.5 #17-36 — 메인 탭 스티키 메모도 사람이 쓴 글이다(세션 탭 메모는 세션과 함께 산다).
    agentMemos: cp.agentMemos ?? {},
    // §5.3 #12-3 — 자물쇠는 사용자가 손으로 건 보호다. 잃으면 AI 가 그대로 연다(정체성).
    ...(cp.pathLocks && cp.pathLocks.length > 0 ? { pathLocks: cp.pathLocks } : {}),
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
  // §9 — 워커 큐에 남아 있는 쓰기를 먼저 디스크에 앉힌다. 이 한 줄이 없으면 방금 저장한
  // 내용을 못 본 채 옛 파일을 읽어 복원하는 창이 생긴다(탭 닫고 바로 다시 여는 흐름).
  flushPendingDiskWritesSync();
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
 * §3.2.1-3 — 묘비 기반 급감 가드: 디스크 identity 에서 사라진 커스텀 에이전트가 전부 묘비로 설명되면 저장(명시 삭제),
 * 하나라도 아니면 보류(복원 실패 의심) — 유령 부활도 원본 파괴도 막는다.
 */
/** §9 — 마지막 기록 identity 캐시. 보류(guarded-skip) 땐 갱신하지 않아 디스크 판본이 기준으로 남는다. */
const lastWrittenIdentityByDir = new Map<string, ProjectIdentity>();

function passesShrinkGuard(saveDir: string, nextIdentity: ProjectIdentity): boolean {
  const prev = lastWrittenIdentityByDir.get(saveDir) ?? loadIdentityFromDir(saveDir);
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

/** 가드 비교용 그래프 합계. `rootNodes` 는 `nodes` 중 프로젝트 루트 노드의 개수(= 보호 대상에서 뺀다). */
interface CheckpointTotals {
  agents: number;
  nodes: number;
  rootNodes: number;
}

/** 프로젝트 루트 노드 키인가(`__root__:<이름>` + 레거시 단일 키). 그래프 계층의 `isRootKey` 와 같은 기준. */
function isRootNodeKey(key: string): boolean {
  return key.startsWith(ROOT_NODE_KEY_PREFIX) || key === LEGACY_ROOT_NODE_KEY;
}

/** 노드 맵에서 개수 + 그중 루트 노드 개수를 센다. */
function countNodes(nodes: Record<string, unknown> | undefined): { nodes: number; rootNodes: number } {
  const keys = Object.keys(nodes ?? {});
  let rootNodes = 0;
  for (const k of keys) if (isRootNodeKey(k)) rootNodes += 1;
  return { nodes: keys.length, rootNodes };
}

/** §3.2.1-3 — 디스크(없으면 `.bak1`) 합계만 조용히 읽는다(`loadCheckpointFromPath` 는 매번 로그를 찍는다). */
function readCheckpointTotalsFromDisk(cpPath: string): CheckpointTotals | null {
  const tryRead = (f: string): CheckpointTotals | null => {
    try {
      if (!fs.existsSync(f)) return null;
      const o = JSON.parse(fs.readFileSync(f, 'utf8')) as Record<string, unknown>;
      if (!isValidCheckpointObj(o)) return null;
      const g = (o['graph'] ?? {}) as { agents?: Record<string, unknown>; nodes?: Record<string, unknown> };
      return { agents: Object.keys(g.agents ?? {}).length, ...countNodes(g.nodes) };
    } catch {
      return null;
    }
  };
  return tryRead(cpPath) ?? tryRead(`${cpPath}.bak1`);
}

/**
 * §3.2.1-3 — checkpoint.json 급감 가드: 디스크 합계(agents+nodes) ≥ MIN_PRIOR 인데 새 합계 0 이면 거부(크래시 뒤 빈 인스턴스의 덮어쓰기). 비율 가드는 오탐이 커 토글로만.
 * ⚠ 디스크 합계는 루트 노드를 뺀 수다 — 넣으면 워크트리(자기 버블 0개가 정상)가 매번 거부되고, 거부는 아무것도 갱신하지 않아 영원히 되풀이된다.
 */
/** §9 — 마지막 기록 합계 캐시. 이 프로세스만 쓰므로 첫 저장 때 한 번만 디스크를 읽는다(매번 수 MB 를 파싱하면 메인 스레드가 포화된다). */
const lastWrittenCheckpointTotals = new Map<string, CheckpointTotals>();

function passesCheckpointShrinkGuard(
  cpPath: string,
  next: ProjectCheckpoint,
): { ok: true } | { ok: false; reason: string } {
  const prev = lastWrittenCheckpointTotals.get(cpPath) ?? readCheckpointTotalsFromDisk(cpPath);
  if (!prev) return { ok: true }; // 첫 저장 / 디스크에 비교 대상 없음 — 보호할 것 없음
  const prevTotal = prev.agents + prev.nodes;
  // 보호 대상 = 자동 생성 골격(루트 노드)을 뺀 실제 버블. 이게 0이면 지킬 것이 없다.
  const prevProtected = prev.agents + (prev.nodes - prev.rootNodes);
  const nextAgents = Object.keys(next.graph?.agents ?? {}).length;
  const nextNodes = Object.keys(next.graph?.nodes ?? {}).length;
  const nextTotal = nextAgents + nextNodes;

  // (1) 통째-0 가드.
  if (prevProtected >= CHECKPOINT_EMPTY_GUARD_MIN_PRIOR && nextTotal === 0) {
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

/**
 * @param preSerialized 호출자가 이미 만든 core(`splitCheckpointForDisk(cp).core`) 직렬화 — 넘기면 다시 직렬화하지 않는다(전체가 아니라 core).
 * @param opts.skipCore 이력만 바뀌었으면 `checkpoint.json` 재작성(백업 회전 포함)을 건너뛴다.
 * @param opts.activityJson 이미 만든 `activity.json` 직렬화.
 * @returns 저장 완료 또는 워커 큐 접수. 실패·거부는 재시도하게 false.
 */
export function writeCheckpoint(
  checkpoint: ProjectCheckpoint,
  preSerialized?: string,
  opts?: { skipCore?: boolean; activityJson?: string },
): boolean {
  // Ghost 방지: path 가 비었거나 name 이 "unknown" 이면 거부 — ghost 메타가 인스턴스 키를 선점해 빈 상태로 덮는 연쇄 손실을 막는다.
  const proj = checkpoint?.project;
  if (!proj || !proj.name || proj.name === 'unknown' || !proj.path) {
    logger.warn(
      `writeCheckpoint: refusing to save invalid project ` +
      `{ name: ${JSON.stringify(proj?.name)}, path: ${JSON.stringify(proj?.path)} } — ghost prevention`,
    );
    return false;
  }
  // 폴더가 지워졌으면(인메모리만 남음) 저장하지 않는다(orphan ghost).
  if (!fs.existsSync(proj.path)) {
    logger.warn(`writeCheckpoint: project path missing on disk: ${proj.path} — skipping write`);
    return false;
  }
  // 워크트리는 폴더 존재가 아니라 살아있는 git 워크트리인지로 본다 — 저장이 mkdir 하므로, 아니면 지운 좀비 워크트리 폴더(Windows 잠금으로 반만 지워진 것 등)를 오토세이브가 되살린다.
  if (isDeadWorktreeProject(proj)) {
    if (shouldReportDeadWorktree(`write:${proj.path}`)) {
      logger.warn(
        `writeCheckpoint: "${proj.name}" is a worktree that is no longer registered with git ` +
        `(no .git at ${proj.path}) — skipping write so the folder is not recreated`,
      );
    }
    return false;
  }
  try {
    const dir = projectDirForInfo(checkpoint.project);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const cpPath = path.join(dir, CHECKPOINT_FILENAME);

    // §3.2.1-3 통째-0 가드 — writeMeta·백업 회전보다 먼저, 거부 시 디스크를 건드리지 않는다.
    const cpVerdict = passesCheckpointShrinkGuard(cpPath, checkpoint);
    if (!cpVerdict.ok) {
      logger.warn(
        `writeCheckpoint: REFUSING checkpoint.json overwrite for "${checkpoint.project.name}" — ${cpVerdict.reason}; ` +
        `preserving existing checkpoint + backups (identity.json untouched)`,
      );
      return false;
    }

    writeMeta(dir, checkpoint.project);

    const identity = deriveIdentity(checkpoint);

    // §3.2.1-3 빈/급감 가드 — identity 가 비어 보이면 identity.json 은 보존(체크포인트는 저장).
    // checkpoint.json 자체는 휘발성 포함 전체 스냅샷이라 정상 저장하되(현재 화면 반영),
    // 권위 있는 정체성 파일(identity.json)만 빈 상태로 덮어쓰지 않는다.
    const identityOk = passesShrinkGuard(dir, identity);

    // §3.2.2 — 이력(activity·completedCommands)은 `activity.json` 으로 갈라 담는다.
    // 골격과 이력은 바뀌는 시점이 달라서, 나눠 두면 바뀐 쪽만 다시 쓰면 된다.
    const { core, activity } = splitCheckpointForDisk(checkpoint);

    // §3.2.1-2 백업 롤링 후 §3.2.1-1 원자적 쓰기.
    if (!opts?.skipCore) {
      rotateBackups(cpPath);
      atomicWriteCheckpointFile(cpPath, preSerialized ?? JSON.stringify(core));
      // §9 — 다음 가드는 이 캐시로 비교한다. ⚠ `readCheckpointTotalsFromDisk` 와 같은 모양(`rootNodes` 포함)이어야 한다 — 다르면 캐시 경로만 판정이 갈린다.
      lastWrittenCheckpointTotals.set(cpPath, {
        agents: Object.keys(checkpoint.graph?.agents ?? {}).length,
        ...countNodes(checkpoint.graph?.nodes as Record<string, unknown> | undefined),
      });
    }
    const activityOk = writeActivityFile(dir, activity, opts?.activityJson);

    if (identityOk) {
      const idPath = path.join(dir, IDENTITY_FILENAME);
      rotateBackups(idPath);
      atomicWriteCheckpointFile(idPath, JSON.stringify(identity));
      lastWrittenIdentityByDir.set(dir, identity);
    }

    const worktreeTag = checkpoint.project.parentProjectPath ? ' [worktree]' : '';
    logger.debug(
      `Checkpoint saved: ${checkpoint.project.name}${worktreeTag} (seq=${checkpoint.seq}, ` +
      `${Object.keys(checkpoint.graph.agents).length} agents, ` +
      `${Object.keys(checkpoint.graph.nodes).length} nodes, ` +
      `${Object.keys(identity.customAgents).length} custom identity${identityOk ? '' : ' [guarded]'})`,
    );
    return activityOk;
  } catch (err) {
    logger.error('Checkpoint write failed', err);
    return false;
  }
}

// activity.json 분해·병합(§3.2.2) — 이력과 골격은 바뀌는 때가 달라 바뀐 쪽만 쓴다(실측 2026-08-13: activity 가 checkpoint 의 62%).

/** `activity.json` 디스크 포맷. ⚠ 저장 시각 같은 "매번 달라지는 값"을 넣으면 변경 감지가 무력해진다. */
interface ActivityFileData {
  version: number;
  projectName: string;
  activity: ProjectCheckpoint['activity'];
  completedCommands?: ProjectCheckpoint['completedCommands'];
}

const EMPTY_ACTIVITY: ProjectCheckpoint['activity'] = { bashHistory: {}, runningServers: {}, fileEdits: {} };

/** 체크포인트를 디스크 2파일로 분해. `core.activity` 는 **빈 객체**로 남는다(타입은 필수 필드 유지). */
export function splitCheckpointForDisk(cp: ProjectCheckpoint): { core: ProjectCheckpoint; activity: ActivityFileData } {
  const core: ProjectCheckpoint = { ...cp, activity: EMPTY_ACTIVITY };
  delete (core as Partial<ProjectCheckpoint>).completedCommands;
  const data: ActivityFileData = {
    version: 1,
    projectName: cp.project?.name ?? '',
    activity: cp.activity ?? EMPTY_ACTIVITY,
  };
  if (cp.completedCommands) data.completedCommands = cp.completedCommands;
  return { core, activity: data };
}

function isValidActivityObj(obj: Record<string, unknown>): boolean {
  const v = obj['version'];
  return typeof v === 'number' && v >= 1 && typeof obj['activity'] === 'object' && obj['activity'] !== null;
}

/** `activity.json` 을 되붙인다 — 없으면(구버전 트리) 체크포인트 안의 `activity` 를 그대로 두고, 있으면 그쪽이 권위다. */
function attachActivityFromDisk(cp: ProjectCheckpoint, dir: string): ProjectCheckpoint {
  const fp = path.join(dir, ACTIVITY_FILENAME);
  let data: ActivityFileData | null = null;
  try {
    if (fs.existsSync(fp)) {
      const parsed: unknown = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (typeof parsed === 'object' && parsed !== null && isValidActivityObj(parsed as Record<string, unknown>)) {
        data = parsed as ActivityFileData;
      } else {
        logger.warn(`Activity invalid: ${fp} — trying backups`);
      }
    }
  } catch (err) {
    logger.warn(`Activity load failed (${fp}): ${err instanceof Error ? err.message : String(err)} — trying backups`);
  }
  if (!data) {
    const recovered = loadFromBackups<ActivityFileData>(fp, isValidActivityObj);
    if (recovered) {
      data = recovered.data;
      logger.warn(`Activity recovered from ${ACTIVITY_FILENAME}.bak${recovered.bakIndex}`);
    }
  }
  if (!data) return cp; // 구버전 트리 — checkpoint 안의 activity 를 그대로 쓴다
  const next: ProjectCheckpoint = { ...cp, activity: data.activity ?? EMPTY_ACTIVITY };
  if (data.completedCommands) next.completedCommands = data.completedCommands;
  return next;
}

/** 디렉토리별 마지막 activity 지문 — 같으면 쓰지 않는다(§3.2.4 — 문자열 전체를 들면 프로젝트마다 12MB). */
const lastWrittenActivityJson = new Map<string, string>();

/** 통째-0 가드는 걸지 않는다 — 이력은 보존 정책(§3.2.3)상 정상적으로 0 이 된다. 원자 쓰기·백업 회전은 같게. */
function writeActivityFile(dir: string, data: ActivityFileData, preSerialized?: string | null): boolean {
  try {
    const json = preSerialized ?? JSON.stringify(data);
    const stamp = contentFingerprint(json);
    if (lastWrittenActivityJson.get(dir) === stamp) return true;
    const target = path.join(dir, ACTIVITY_FILENAME);
    rotateBackups(target);
    atomicWriteCheckpointFile(target, json);
    lastWrittenActivityJson.set(dir, stamp);
    return true;
  } catch (err) {
    // 이력 저장 실패는 비치명 — 그래프·정체성은 이미 제 파일에 있다.
    logger.warn(`Activity write failed (${dir}): ${err instanceof Error ? err.message : String(err)}`);
    return false;
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
  // §9 — 워커 큐에 남아 있는 쓰기를 먼저 디스크에 앉힌다. 이 한 줄이 없으면 방금 저장한
  // 내용을 못 본 채 옛 파일을 읽어 복원하는 창이 생긴다(탭 닫고 바로 다시 여는 흐름).
  flushPendingDiskWritesSync();
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const data: unknown = JSON.parse(raw);
      if (typeof data === 'object' && data !== null && isValidCheckpointObj(data as Record<string, unknown>)) {
        const cp = data as ProjectCheckpoint;
        const tag = cp.project.parentProjectPath ? ' [worktree]' : '';
        logger.info(`Checkpoint loaded: ${cp.project.name}${tag} (seq=${cp.seq})`);
        // §3.2.2 — 이력은 별도 파일. 없으면(구버전 트리) checkpoint 안의 것을 그대로 쓴다.
        return attachActivityFromDisk(cp, path.dirname(filePath));
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
    return attachActivityFromDisk(recovered.data, path.dirname(filePath));
  }
  return null;
}

/**
 * 죽은 워크트리에 남은 우리 `.vibisual` 정리(외부가 만든 워크트리는 그것이 untracked 로 남아 폴더가 산다).
 * 조건: `.git` 없음 + 처음 본 뒤 PRUNE_GRACE_MS 경과(`git worktree add` 찰나 오판 방지) + `.vibisual` 이 실제로 있음.
 * 지우는 건 `.vibisual` 서브트리뿐, 폴더는 비었을 때만 non-recursive rmdir.
 */
const PRUNE_MIN_INTERVAL_MS = 60_000;
/** 죽은 것으로 처음 관측된 뒤 실제 삭제까지의 유예. */
const PRUNE_GRACE_MS = 5 * 60_000;
let lastPruneAt = 0;
const deadWorktreeFirstSeen = new Map<string, number>();

export function pruneOrphanWorktreeDirs(liveProjects: ProjectInfo[]): number {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_MIN_INTERVAL_MS) return 0;
  lastPruneAt = now;

  // 후보 워크트리 디렉토리 수집: (a) 살아있는 부모의 `.claude/worktrees/*` 디스크 스캔,
  // (b) 등록된 워크트리 인스턴스 경로(임의 위치 워크트리 포함).
  const candidates = new Set<string>();
  for (const p of liveProjects) {
    if (!p?.path) continue;
    if (p.parentProjectPath) {
      candidates.add(p.path.replace(/\//g, path.sep));
      continue;
    }
    const wtRoot = path.join(p.path.replace(/\//g, path.sep), '.claude', 'worktrees');
    try {
      if (!fs.existsSync(wtRoot)) continue;
      for (const entry of fs.readdirSync(wtRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        candidates.add(path.join(wtRoot, entry.name));
      }
    } catch { /* 접근 불가 — 이 부모는 건너뛴다 */ }
  }

  let removed = 0;
  for (const wtDir of candidates) {
    // "죽은 워크트리 첫 목격" 맵의 키 — linux 에서 접으면 케이스만 다른 두 워크트리가 유예 시간을
    // 공유해, 살아 있는 쪽 저장분이 유예 없이 삭제될 수 있다.
    const key = pathKey(wtDir);
    if (isLiveWorktreeDir(wtDir)) { deadWorktreeFirstSeen.delete(key); continue; }
    const firstSeen = deadWorktreeFirstSeen.get(key);
    if (firstSeen === undefined) { deadWorktreeFirstSeen.set(key, now); continue; }
    if (now - firstSeen < PRUNE_GRACE_MS) continue;

    const vibiDir = path.join(wtDir, '.vibisual');
    try {
      if (!fs.existsSync(wtDir)) { deadWorktreeFirstSeen.delete(key); continue; }
      if (!fs.existsSync(vibiDir)) continue;
      fs.rmSync(vibiDir, { recursive: true, force: true });
      removed += 1;
      logger.info(`pruneOrphanWorktreeDirs: removed Vibisual save data from dead worktree ${wtDir}`);
      // 우리 데이터만 남아 있던 폴더면 여기서 빈다 — 빈 경우에만 폴더도 정리(non-recursive).
      try {
        fs.rmdirSync(wtDir);
        logger.info(`pruneOrphanWorktreeDirs: removed now-empty worktree folder ${wtDir}`);
        deadWorktreeFirstSeen.delete(key);
      } catch { /* 다른 파일이 남아 있음 — 폴더는 사용자 소관으로 둔다 */ }
    } catch (err) {
      logger.warn(`pruneOrphanWorktreeDirs: cleanup failed for ${wtDir}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return removed;
}

// ─── Lazy API ───

/**
 * AppState.projectPaths 의 각 프로젝트 메타를 모은다(`<path>/.vibisual/save/`). 부모의 `.claude/worktrees/<wt>/.vibisual/save/` 도 훑어
 * 워크트리를 stub 으로 발견한다(§5.7 #26). 같은 path 는 lastSavedAt 최신 1건.
 */
export function discoverProjectMetas(projectPaths: string[]): ProjectMetaSnapshot[] {
  // §9 — 워커 큐에 남아 있는 쓰기를 먼저 디스크에 앉힌다. 이 한 줄이 없으면 방금 저장한
  // 내용을 못 본 채 옛 파일을 읽어 복원하는 창이 생긴다(탭 닫고 바로 다시 여는 흐름).
  flushPendingDiskWritesSync();
  const byPath = new Map<string, ProjectMetaSnapshot>();

  /** §3.2.1-4 — project.json 이 없거나 깨졌으면 checkpoint/identity(+백업)에서 ProjectInfo 를 되살린다(path 가 비면 무효). */
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
    // checkpoint 가 없어도 identity(또는 백업)가 있으면 발견한다 — identity 골격으로 되살린다(§3.2.2).
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
    // §4 온보딩 ③ — 이름 빈 프로젝트는 되살리지 않는다(폴더 고르기 전 `process.cwd()` 가 mac Finder 실행에선 `/` 라 `basename` 이 빈 탭이 된다 — 이미 저장된 메타를 고친다).
    if (!snap.project.name) {
      snap = { ...snap, project: { ...snap.project, name: path.basename(key) || key } };
    }
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
          // 죽은 워크트리의 잔여 데이터는 프로젝트로 되살리지 않는다(정리는 pruneOrphanWorktreeDirs).
          if (!isLiveWorktreeDir(path.join(wtRoot, wt.name))) continue;
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

/** §3.2.2 — identity 를 checkpoint 에 보충 병합(in-place). 이미 있는 키는 덮지 않는다(checkpoint 가 더 최신). */
function mergeIdentityIntoCheckpoint(cp: ProjectCheckpoint, identity: ProjectIdentity): void {
  // §3.2.1-3 — 묘비는 양쪽 합집합(부활 차단 + 다음 왕복에서 유실 방지).
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
  // §4 (설정 3층) — 체크포인트에 그 필드가 아예 없으면 보충하지 않는다(구버전 저장분 — 복원이 완성본을 대조해야 하는데
  // 반쪽만 채우면 전부 위층을 따르는 것으로 접힌다).
  if (cp.agentConfigOverrides && identity.agentConfigOverrides) {
    for (const [id, overrides] of Object.entries(identity.agentConfigOverrides)) {
      if (!(id in cp.agentConfigOverrides)) cp.agentConfigOverrides[id] = overrides;
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
  // §5.5 captureBubbles 보충 — id 기준 합집합.
  if (identity.captureBubbles && identity.captureBubbles.length > 0) {
    const existing = cp.captureBubbles ?? [];
    const seen = new Set(existing.map((b) => b.id));
    cp.captureBubbles = [...existing, ...identity.captureBubbles.filter((b) => !seen.has(b.id))];
  }
  // §5.13 appBubbles 보충 — 같은 규칙(id 기준 합집합).
  if (identity.appBubbles && identity.appBubbles.length > 0) {
    const existing = cp.appBubbles ?? [];
    const seen = new Set(existing.map((b) => b.id));
    cp.appBubbles = [...existing, ...identity.appBubbles.filter((b) => !seen.has(b.id))];
  }
  // §5.14 playBubbles 보충 — 같은 규칙(id 기준 합집합).
  if (identity.playBubbles && identity.playBubbles.length > 0) {
    const existing = cp.playBubbles ?? [];
    const seen = new Set(existing.map((b) => b.id));
    cp.playBubbles = [...existing, ...identity.playBubbles.filter((b) => !seen.has(b.id))];
  }
  // §5.15 specDocs 보충 — 같은 규칙(id 기준 합집합).
  if (identity.specDocs && identity.specDocs.length > 0) {
    const existing = cp.specDocs ?? [];
    const seen = new Set(existing.map((d) => d.id));
    cp.specDocs = [...existing, ...identity.specDocs.filter((d) => !seen.has(d.id))];
  }
  // §5.18 labRuns 보충 — 같은 규칙(id 기준 합집합).
  if (identity.labRuns && identity.labRuns.length > 0) {
    const existing = cp.labRuns ?? [];
    const seen = new Set(existing.map((r) => r.id));
    cp.labRuns = [...existing, ...identity.labRuns.filter((r) => !seen.has(r.id))];
  }
  // §5.20 shelfBubbles 보충 — 같은 규칙(id 기준 합집합).
  if (identity.shelfBubbles && identity.shelfBubbles.length > 0) {
    const existing = cp.shelfBubbles ?? [];
    const seen = new Set(existing.map((b) => b.id));
    cp.shelfBubbles = [...existing, ...identity.shelfBubbles.filter((b) => !seen.has(b.id))];
  }
  // contis 보충.
  if (identity.contis && Object.keys(identity.contis).length > 0) {
    cp.contis = cp.contis ?? {};
    for (const [id, conti] of Object.entries(identity.contis)) {
      if (!(id in cp.contis)) cp.contis[id] = conti;
    }
  }
  // §5.5 #17-17 ⑪(h) 시각 종류 카드 보충 — 없는 키만 되살린다(진행 중 상태를 디스크가 덮지 않게).
  if (identity.visualKinds && Object.keys(identity.visualKinds).length > 0) {
    cp.visualKinds = cp.visualKinds ?? {};
    for (const [key, card] of Object.entries(identity.visualKinds)) {
      if (!(key in cp.visualKinds)) cp.visualKinds[key] = card;
    }
  }
  // §5.5 #17-17 ⑫(b) 팔레트 고정 보충 — 없는 id 만 되살린다(합집합, 순서는 checkpoint 가 먼저).
  if (identity.pinnedGoalActions && identity.pinnedGoalActions.length > 0) {
    const have = new Set(cp.pinnedGoalActions ?? []);
    const merged = [...(cp.pinnedGoalActions ?? [])];
    for (const id of identity.pinnedGoalActions) {
      if (typeof id === 'string' && id.trim() && !have.has(id)) {
        have.add(id);
        merged.push(id);
      }
    }
    if (merged.length > 0) cp.pinnedGoalActions = merged;
  }
  // §5.5 #17-17 — 없는 세션 목표만 되살린다(진행 중인 목표를 되감지 않게).
  if (identity.sessionGoals && Object.keys(identity.sessionGoals).length > 0) {
    cp.sessionGoals = cp.sessionGoals ?? {};
    for (const [subId, goal] of Object.entries(identity.sessionGoals)) {
      if (!(subId in cp.sessionGoals)) cp.sessionGoals[subId] = goal;
    }
  }
  // §5.5 #17-36 agentMemos 보충 — 에이전트 키가 없으면 통째로, 있으면 memo id 기준 합집합.
  //   사용자가 쓴 글이라 "이미 있으니 건너뛴다"로 한 장이라도 흘리지 않는다.
  if (identity.agentMemos && Object.keys(identity.agentMemos).length > 0) {
    cp.agentMemos = cp.agentMemos ?? {};
    for (const [agentId, memos] of Object.entries(identity.agentMemos)) {
      const existing = cp.agentMemos[agentId];
      if (!existing) { cp.agentMemos[agentId] = memos; continue; }
      const seen = new Set(existing.map((m) => m.id));
      cp.agentMemos[agentId] = [...existing, ...memos.filter((m) => !seen.has(m.id))];
    }
  }
  // §5.3 #12-3 자물쇠 보충 — id 기준 합집합. 어긋나도 **잠긴 쪽으로** 남는다(사라진 자물쇠는 AI 가
  //   그대로 열고, 되살아난 자물쇠는 카드 한 장으로 끝난다). 검증·id 재계산은 복원(`normalizePathLocks`)이 한다.
  if (identity.pathLocks && identity.pathLocks.length > 0) {
    cp.pathLocks = mergePathLocks(cp.pathLocks, identity.pathLocks);
  }
  // agentCounter 는 최대값 유지(라벨 번호 역행 방지).
  cp.graph.agentCounter = Math.max(cp.graph.agentCounter ?? 0, identity.agentCounter ?? 0);
}

/** meta.checkpointPath의 체크포인트 1개를 로드 + identity.json 보충(§3.2.2). 검증 실패 시 null. */
export function loadCheckpointByMeta(meta: ProjectMetaSnapshot): ProjectCheckpoint | null {
  // §9 — 워커 큐에 남아 있는 쓰기를 먼저 디스크에 앉힌다. 이 한 줄이 없으면 방금 저장한
  // 내용을 못 본 채 옛 파일을 읽어 복원하는 창이 생긴다(탭 닫고 바로 다시 여는 흐름).
  flushPendingDiskWritesSync();
  const saveDir = path.dirname(meta.checkpointPath);
  let cp = loadCheckpointFromPath(meta.checkpointPath);
  const identity = loadIdentityFromDir(saveDir);

  // checkpoint 가 완전히 죽었지만 identity 는 살아있으면 — identity 로 최소 골격을 세워 부활.
  if (!cp && identity) {
    logger.warn(`loadCheckpoint: checkpoint dead but identity.json alive — reconstructing skeleton for "${identity.project.name}"`);
    cp = attachActivityFromDisk(buildCheckpointSkeletonFromIdentity(identity), saveDir);
  }
  if (!cp) return null;

  if (identity) mergeIdentityIntoCheckpoint(cp, identity);
  // 백업 checkpoint에는 삭제 전 버블이 이미 들어 있을 수 있다. identity의 보충만 막으면
  // 그 버블은 살아남으므로, 양쪽 묘비를 합친 뒤 기존 버블·소속도 함께 제거한다.
  // identity 자체가 없거나 손상된 경우에도 checkpoint의 삭제 기록은 유효하다.
  for (const sid of cp.deletedCustomAgentIds ?? []) {
    delete cp.graph.agents[sid];
    delete cp.graph.refs.sessionCwds?.[sid];
  }
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
      // 체크포인트 `graph.projects` 키 — ProjectGraph.normalize 와 같은 규칙이어야 복원이 맞물린다.
      projects: { [pathKey(identity.project.path)]: identity.project },
      hierarchy: { topLevelPaths: [], childrenMap: {}, satelliteMap: {} },
      refs: { nodeAgentRefs: {}, sessionCwds: { ...identity.sessionCwds } },
    },
    activity: { bashHistory: {}, runningServers: {}, fileEdits: {} },
    edges: {
      main: { edges: {}, groups: {}, refs: {} },
      inner: { edges: {}, groups: {}, refs: {} },
    },
    agentConfigs: { ...identity.agentConfigs },
    // §4 (설정 3층) — identity 만 남은 복구 경로. 갈라진 칸이 있으면 그대로, 없으면(구버전 identity)
    //   필드 자체를 두지 않아 복원이 완성본에서 되만들게 한다.
    ...(identity.agentConfigOverrides ? { agentConfigOverrides: { ...identity.agentConfigOverrides } } : {}),
    customLabels: { ...identity.customLabels },
    taskEdges: { ...identity.taskEdges },
    commentBoxes: [...identity.commentBoxes],
    captureBubbles: [...identity.captureBubbles],
    appBubbles: [...(identity.appBubbles ?? [])],
    playBubbles: [...(identity.playBubbles ?? [])],
    specDocs: [...(identity.specDocs ?? [])],
    labRuns: [...(identity.labRuns ?? [])],
    shelfBubbles: [...(identity.shelfBubbles ?? [])],
    contis: { ...identity.contis },
    agentMemos: { ...(identity.agentMemos ?? {}) },
    // §5.3 #12-3 — 체크포인트가 죽어도 자물쇠는 identity 에서 선다(조용히 열리지 않게).
    ...(identity.pathLocks && identity.pathLocks.length > 0 ? { pathLocks: [...identity.pathLocks] } : {}),
    deletedCustomAgentIds: identity.deletedSessionIds ?? [],
  };
}

// ─── 스케줄러 ───

/** §3.2.4 — 변경 감지 지문 = 길이 + SHA-1(직렬화 문자열 전체를 들면 프로젝트당 수십 MB). 길이를 붙여 해시 충돌도 걸러진다(보안 용도 아님). */
function contentFingerprint(json: string): string {
  return `${json.length}:${crypto.createHash('sha1').update(json).digest('hex')}`;
}

/** 지문에서 지워야 할 휘발 필드. 중첩된 `savedAt`(identity 등)도 같은 성격이라 함께 고정한다. */
const VOLATILE_STAMP_RE = /"savedAt":\d+/g;

/**
 * 지문 전 `savedAt` 처럼 매번 바뀌는 값을 고정한다 — 없으면 안 바뀐 저장도 지문이 달라 쓰기 생략(§3.2.4)이 발동하지 않는다(실측 2026-08-31: 6.1시간 15.2GB 쓰기).
 * 비교용 사본에만 적용한다 — 파일의 `savedAt` 은 진짜 시각이고, 건너뛴 동안 과거에 머무는 것은 의도다(신선도는 `lastSavedAt`).
 */
export function fingerprintSource(json: string): string {
  return json.replace(VOLATILE_STAMP_RE, '"savedAt":0');
}

/** 체크포인트 저장 스케줄러 */
export class SaveScheduler {
  /**
   * §3.2.4 — 경로별 마지막 체크포인트 지문. 같으면 쓰기·백업 회전을 건너뛴다(hook 마다 모든 프로젝트를 저장하므로 N-1 개의 I/O 가 빠진다).
   * 같을 때만이라 debounce 와 달리 유실 창이 없다.
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

  /** 프로젝트 경로별 마지막으로 디스크에 쓴 `activity.json` 의 **지문**(§3.2.2 · §3.2.4). */
  private lastWrittenActivity = new Map<string, string>();

  private writeIfChanged(cp: ProjectCheckpoint): void {
    // 큐 접수 뒤의 비동기 실패는 저장 지문과 별개다. 내용 불변이어도 미저장분은 재시도한다.
    retryFailedDiskWrites();
    const key = cp.project?.path ?? cp.project?.name ?? '';
    // §3.2.2 — 골격과 이력을 나눠 **각자** 변경 감지한다. 둘은 바뀌는 시점이 달라서,
    // 한쪽만 바뀐 저장에서 다른 쪽의 백업 회전 + 원자적 쓰기를 통째로 아낀다.
    const { core, activity } = splitCheckpointForDisk(cp);
    const coreJson = JSON.stringify(core);
    const activityJson = JSON.stringify(activity);
    // §3.2.4 — 비교는 지문으로. 직렬화 결과 자체를 들고 있으면 프로젝트마다 수십 MB 가 상주한다.
    // core 는 `savedAt` 을 고정한 사본으로 비교한다 — 안 그러면 저장 시각 하나 때문에 매번
    // "변경됨"이 되어 이 스킵이 영영 발동하지 않는다(`fingerprintSource` 주석).
    const coreFp = contentFingerprint(fingerprintSource(coreJson));
    const activityFp = contentFingerprint(activityJson);
    const coreChanged = !key || this.lastWritten.get(key) !== coreFp;
    const activityChanged = !key || this.lastWrittenActivity.get(key) !== activityFp;
    if (!coreChanged && !activityChanged) return; // 양쪽 다 불변 — 디스크 쓰기 스킵
    // 직렬화를 넘겨 재직렬화를 피한다.
    const accepted = writeCheckpoint(cp, coreJson, { skipCore: !coreChanged, activityJson });
    // 실패/가드 거부를 저장 완료로 기억하면 같은 내용의 다음 autosave가 영원히 생략된다.
    if (key) {
      if (accepted) {
        if (coreChanged) this.lastWritten.set(key, coreFp);
        this.lastWrittenActivity.set(key, activityFp);
      } else {
        // core만 저장된 뒤 activity가 실패했을 수도 있다. 이전 성공 지문도 지워야
        // 사용자가 변경을 되돌릴 때 "이전과 같음"으로 잘못 생략하지 않는다.
        this.lastWritten.delete(key);
        this.lastWrittenActivity.delete(key);
      }
    }
  }
}

// 마이그레이션: 구 SAVE_ROOT → 프로젝트별 분산 저장

/**
 * 구 `<Vibisual>/save/<name>/`(+`worktrees/<wt>/`) 를 각 `project.path` 의 `.vibisual/save/` 로 1회 옮긴다 — 도착지가 있으면 lastSavedAt 이 새로운 쪽,
 * 끝나면 구 루트를 `save.bak-v1.52/` 로 rename(재이전 방지). 부팅 때 `discoverProjectMetas` 직전에 부른다.
 */
export function migrateLegacySaveRootToProjectDirs(): { moved: number; skipped: number; bakPath: string | null } {
  let moved = 0;
  let skipped = 0;
  let bakPath: string | null = null;

  if (!fs.existsSync(LEGACY_SAVE_ROOT)) return { moved, skipped, bakPath };

  // 진짜 프로젝트 데이터(project.json 하위 폴더)가 있을 때만 — 이미 옮긴 환경에서 백업이 무한 증식하지 않게.
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

  // 재이전 방지 백업 — `save.bak-v1.52/` 가 있으면 타임스탬프를 붙인다.
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

/** 레거시 state.json 변환 — 구 save/ 가 살아있는 동안(백업으로 옮기기 전)만 의미가 있다. */
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
