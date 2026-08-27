/**
 * worktreeLiveness.ts — "이 워크트리 폴더가 아직 살아있는 git 워크트리인가" 단일 판정기 (v3.71).
 *
 * 배경: Vibisual 은 워크트리 상태를 워크트리 폴더 안(`<wt>/.vibisual/save/`)에 저장한다(§3.2 v1.52).
 * 그런데 저장 경로가 디렉토리를 `mkdirSync(recursive)` 로 **없으면 만들기** 때문에, 이미 죽은
 * 워크트리(외부 Claude Code `--isolation worktree` 가 만들고 정리한 폴더, 또는 Windows 잠금 파일로
 * 반만 지워진 폴더)를 사용자가 지워도 다음 오토세이브가 폴더를 통째로 되살렸다.
 * "폴더가 디스크에 있는가"만 보던 가드는 (a) 외부가 만든 워크트리, (b) 잠금 파일 하나만 남은
 * 좀비 폴더에서 무력했다.
 *
 * 판정 기준: 워크트리 루트의 `.git` 존재 여부. linked 워크트리의 `.git` 은 관리 디렉토리를 가리키는
 * **파일**이고, `git worktree remove`/`prune` 이 지나가면 사라진다. 즉 git 프로세스를 띄우지 않고
 * stat 한 번으로 "등록이 끊긴 폴더"를 가려낼 수 있다(저장 경로는 hook 이벤트마다 도는 핫패스라
 * 프로세스 스폰 판정은 부적합).
 *
 * 쓰기(statePersistence·streamBufferStore)·발견(discoverWorktrees)·존재검사(checkFileExistence)가
 * 모두 이 모듈의 같은 판정을 공유한다 — 한쪽만 알면 "지워도 되살아나는" 고리가 다시 생긴다.
 *
 * 같은 이유로 **"아직 만들어지는 중인가"(생성 유예)도 여기 있다** — "이 폴더가 버블이 될 자격이
 * 있는가"를 두 모듈이 나눠 쥐면 한쪽만 아는 상태가 다시 생긴다.
 */
import fs from 'node:fs';
import path from 'node:path';
// 경로 대소문자 정책 SSOT — win32/darwin 만 접고 linux 는 접지 않는다.
import { pathKey } from './pathKey.js';

/** `<parent>/.claude/worktrees/<name>` 경로 패턴(대소문자 무시, 정규화된 forward-slash 기준). */
const WORKTREE_PATH_RE = /^(.*)\/\.claude\/worktrees\/([^/]+)(?:\/|$)/i;

/** 백슬래시·중복 슬래시를 forward-slash 로 통일(대소문자는 보존 — fs 접근에 그대로 쓴다). */
function toSlash(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/');
}

/**
 * 임의 경로가 `.claude/worktrees/<name>` 아래면 그 워크트리 루트를 반환. 아니면 null.
 * 파일 경로(`<wt>/.vibisual/save/checkpoint.json`)를 넣어도 루트를 돌려준다.
 */
export function worktreeRootOf(anyPath: string): string | null {
  if (!anyPath) return null;
  const m = WORKTREE_PATH_RE.exec(toSlash(anyPath));
  if (!m) return null;
  return `${m[1]}/.claude/worktrees/${m[2]}`;
}

// ─── 살아있음 판정 (짧은 TTL 캐시) ───

/** 저장 경로는 hook 이벤트마다 도는 핫패스 — 같은 워크트리를 밀리초 단위로 반복 stat 하지 않도록
 *  짧게 캐시한다. 사용자가 폴더를 지운 사실은 이 간격 안에 반영된다(오토세이브 주기보다 훨씬 짧다). */
const LIVENESS_TTL_MS = 5_000;
const livenessCache = new Map<string, { live: boolean; at: number }>();

/**
 * 워크트리 루트가 아직 살아있는 git 워크트리인가.
 * - `<root>/.git` 있음 → 살아있음.
 * - 루트 자체가 없거나 `.git` 이 없음 → 죽음.
 * - stat 실패(권한 등) → **보수적으로 살아있음**(판단이 서지 않으면 사용자 데이터를 건드리지 않는다).
 */
export function isLiveWorktreeDir(worktreeRoot: string): boolean {
  if (!worktreeRoot) return false;
  // 캐시 키는 경로다 — linux 에서 접으면 케이스만 다른 두 워크트리가 서로의 생사 판정을 물려받아
  // 살아 있는 폴더가 "죽음"으로 읽히고 저장분이 정리 대상이 된다.
  const key = pathKey(worktreeRoot);
  const now = Date.now();
  const hit = livenessCache.get(key);
  if (hit && now - hit.at < LIVENESS_TTL_MS) return hit.live;

  let live: boolean;
  try {
    live = fs.existsSync(path.join(worktreeRoot.replace(/\//g, path.sep), '.git'));
  } catch {
    live = true;
  }
  livenessCache.set(key, { live, at: now });
  return live;
}

/** 판정 캐시 무효화(워크트리 생성·삭제 직후 즉시 반영용). 인자 없으면 전체. */
export function invalidateWorktreeLiveness(worktreeRoot?: string): void {
  if (!worktreeRoot) { livenessCache.clear(); return; }
  livenessCache.delete(pathKey(worktreeRoot));
}

// ─── 만들어지는 중 (발견 유예) ───

/**
 * 지금 `git worktree add` 가 돌고 있는 워크트리 루트들.
 *
 * 살아있음 판정(`.git` 존재)은 **체크아웃이 끝나기 한참 전에 이미 true** 가 된다 — git 은 관리
 * 디렉토리를 먼저 연결하고 파일을 나중에 푼다. 그래서 10초 세션 스윕(`scanAllProjects` →
 * `discoverWorktrees`)이 반쯤 만들어진 폴더를 주워 **좌표 없는 버블**을 먼저 만들어 버렸고,
 * 클라이언트는 그것을 방사형 레이아웃 자리에 앉힌 뒤 캐시해 정작 뒤늦게 도착하는 진짜 좌표를
 * 무시했다(사용자가 고른 자리가 아닌 곳에 새 워크트리 버블이 서던 원인).
 *
 * 만드는 쪽이 시작·끝을 알려 주면 그동안은 아무도 그 폴더를 발견하지 않는다. 해제는 반드시
 * `finally` 에서 — 실패해서 남으면 그 이름은 영영 발견되지 않는다.
 */
const underConstruction = new Set<string>();

/** 이 워크트리 루트를 만드는 중이라고 표시. */
export function beginWorktreeCreation(worktreeRoot: string): void {
  underConstruction.add(pathKey(worktreeRoot));
}

/** 생성 유예 해제 — 성공·실패 무관하게 `finally` 에서 부른다. */
export function endWorktreeCreation(worktreeRoot: string): void {
  underConstruction.delete(pathKey(worktreeRoot));
}

/** 지금 만들어지는 중인 워크트리인가(발견·이름 중복 회피가 함께 본다). */
export function isWorktreeUnderConstruction(worktreeRoot: string): boolean {
  return underConstruction.has(pathKey(worktreeRoot));
}

/**
 * 임의 경로(파일·디렉토리)가 **죽은 워크트리 안**인가.
 * `.claude/worktrees/` 밖의 경로는 항상 false — 일반 프로젝트 저장 경로엔 영향이 없다.
 */
export function isUnderDeadWorktree(anyPath: string): boolean {
  const root = worktreeRootOf(anyPath);
  if (!root) return false;
  return !isLiveWorktreeDir(root);
}

/**
 * ProjectInfo 가 죽은 워크트리 인스턴스인가.
 * 워크트리 판정은 `parentProjectPath`(임의 위치 워크트리 포함) 또는 `.claude/worktrees/` 경로 패턴.
 * 일반 프로젝트는 무조건 false — 워크트리가 아닌 프로젝트의 저장은 종전 그대로다.
 */
export function isDeadWorktreeProject(info: { path?: string; parentProjectPath?: string } | null | undefined): boolean {
  const p = info?.path;
  if (!p) return false;
  const isWorktree = Boolean(info?.parentProjectPath) || WORKTREE_PATH_RE.test(toSlash(p));
  if (!isWorktree) return false;
  return !isLiveWorktreeDir(p);
}

// ─── 로그 스로틀 ───

/** 죽은 워크트리로 향하는 쓰기는 이벤트마다 들어온다 — 경고를 매번 찍으면 로그가 도배된다. */
const DEAD_LOG_INTERVAL_MS = 60_000;
const lastDeadLogAt = new Map<string, number>();

/** 같은 키에 대해 1분에 한 번만 true — 죽은 워크트리 스킵 로그용. */
export function shouldReportDeadWorktree(key: string): boolean {
  const now = Date.now();
  const last = lastDeadLogAt.get(key) ?? 0;
  if (now - last < DEAD_LOG_INTERVAL_MS) return false;
  lastDeadLogAt.set(key, now);
  return true;
}
