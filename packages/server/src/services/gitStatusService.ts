import { execFile } from 'node:child_process';
import { GIT_STATUS_CONFIG } from '@vibisual/shared';
import type { GitStatus, GitCommit, GitWorktreeStatus } from '@vibisual/shared';

export interface WorktreeResolveInfo {
  nodeId: string;
  name: string;
  /** 절대 경로 (OS 구분자). */
  absPath: string;
}

interface CacheEntry {
  status: GitStatus;
  expiresAt: number;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * 프로젝트별 git 상태 캐시·조회 서비스.
 * §7.6 GitStatusCard 데이터 공급원. 서버 SSOT 원칙에 따라 클라이언트는 REST로만 수신.
 */
class GitStatusService {
  private cache = new Map<string, CacheEntry>();
  private dirtyMap = new Map<string, boolean>();
  private inflight = new Map<string, Promise<GitStatus>>();
  private changeListener: (() => void) | null = null;

  setChangeListener(cb: () => void): void {
    this.changeListener = cb;
  }

  /** projectName → dirty 여부 스냅샷 (GraphSnapshot.gitDirty 주입용) */
  getDirtyMap(): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    for (const [k, v] of this.dirtyMap) out[k] = v;
    return out;
  }

  /** 캐시 무효화 (git init 등 변경 액션 후 호출) */
  invalidate(projectName: string): void {
    this.cache.delete(projectName);
    this.inflight.delete(projectName);
  }

  /** 프로젝트 제거 시 dirty 정보도 정리 */
  forget(projectName: string): void {
    this.cache.delete(projectName);
    this.inflight.delete(projectName);
    if (this.dirtyMap.delete(projectName)) this.changeListener?.();
  }

  async getStatus(
    projectName: string,
    cwd: string,
    worktrees: WorktreeResolveInfo[],
    force = false,
  ): Promise<GitStatus> {
    const now = Date.now();
    if (!force) {
      const entry = this.cache.get(projectName);
      if (entry && entry.expiresAt > now) return entry.status;
      const inflight = this.inflight.get(projectName);
      if (inflight) return inflight;
    }

    const promise = this.fetchStatus(cwd, worktrees);
    this.inflight.set(projectName, promise);
    try {
      const status = await promise;
      this.cache.set(projectName, {
        status,
        expiresAt: Date.now() + GIT_STATUS_CONFIG.CACHE_TTL_MS,
      });
      const nextDirty = status.case === 'repo'
        && (status.staged + status.modified + status.untracked) > 0;
      const prev = this.dirtyMap.get(projectName);
      if (prev !== nextDirty || !this.dirtyMap.has(projectName)) {
        this.dirtyMap.set(projectName, nextDirty);
        this.changeListener?.();
      }
      return status;
    } finally {
      this.inflight.delete(projectName);
    }
  }

  private async fetchStatus(cwd: string, worktrees: WorktreeResolveInfo[]): Promise<GitStatus> {
    const now = Date.now();

    // 1) git 바이너리 존재 확인 (cwd 무관 — 전역 PATH)
    const version = await runGitGlobal(['--version']);
    if (version.code !== 0 || !version.stdout.trim().startsWith('git version')) {
      return { case: 'no-git', fetchedAt: now };
    }

    // 2) repo 여부
    const isRepo = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
    if (isRepo.code !== 0 || isRepo.stdout.trim() !== 'true') {
      return { case: 'not-repo', fetchedAt: now };
    }

    // 3) 브랜치 (detached면 짧은 SHA)
    const branchRaw = (await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
    let branch = branchRaw;
    if (!branch || branch === 'HEAD') {
      const sha = (await runGit(cwd, ['rev-parse', '--short', 'HEAD'])).stdout.trim();
      branch = sha || 'detached';
    }

    // 4) ahead/behind (upstream 있을 때만)
    let ahead = 0;
    let behind = 0;
    const upstream = await runGit(cwd, ['rev-parse', '--abbrev-ref', '@{u}']);
    if (upstream.code === 0 && upstream.stdout.trim()) {
      const counts = await runGit(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
      if (counts.code === 0) {
        const parts = counts.stdout.trim().split(/\s+/);
        ahead = parseNonNeg(parts[0]);
        behind = parseNonNeg(parts[1]);
      }
    }

    // 5) staged / modified / untracked
    const { staged, modified, untracked } = await countChanges(cwd);

    // 6) 최근 커밋
    const commits = await readRecentCommits(cwd, GIT_STATUS_CONFIG.COMMIT_LIST_SIZE);

    // 7) worktree 요약 (병렬)
    const wtStatuses = await Promise.all(
      worktrees.map((wt) => fetchWorktreeStatus(cwd, wt)),
    );

    return {
      case: 'repo',
      fetchedAt: now,
      branch,
      ahead,
      behind,
      staged,
      modified,
      untracked,
      commits,
      worktrees: wtStatuses,
    };
  }
}

async function fetchWorktreeStatus(
  parentCwd: string,
  wt: WorktreeResolveInfo,
): Promise<GitWorktreeStatus> {
  const wtCwd = wt.absPath;

  const branchR = await runGit(wtCwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  let branch = branchR.stdout.trim();
  if (!branch || branch === 'HEAD') {
    const sha = (await runGit(wtCwd, ['rev-parse', '--short', 'HEAD'])).stdout.trim();
    branch = sha || 'unknown';
  }

  // base 후보: master → main (부모 cwd에서 조회)
  let ahead = 0;
  let behind = 0;
  for (const base of ['master', 'main']) {
    const verify = await runGit(parentCwd, ['rev-parse', '--verify', '--quiet', base]);
    if (verify.code !== 0) continue;
    const counts = await runGit(wtCwd, ['rev-list', '--left-right', '--count', `HEAD...${base}`]);
    if (counts.code === 0) {
      const parts = counts.stdout.trim().split(/\s+/);
      ahead = parseNonNeg(parts[0]);
      behind = parseNonNeg(parts[1]);
    }
    break;
  }

  const statusR = await runGit(wtCwd, ['status', '--porcelain=v1']);
  const dirty = statusR.code === 0 && statusR.stdout.trim().length > 0;

  const lastR = await runGit(wtCwd, ['log', '-1', '--pretty=format:%at']);
  const ts = parseNonNeg(lastR.stdout.trim());

  return {
    nodeId: wt.nodeId,
    name: wt.name,
    branch,
    ahead,
    behind,
    dirty,
    lastActivityAt: ts > 0 ? ts * 1000 : undefined,
  };
}

async function countChanges(cwd: string): Promise<{ staged: number; modified: number; untracked: number }> {
  const r = await runGit(cwd, ['status', '--porcelain=v1']);
  let staged = 0;
  let modified = 0;
  let untracked = 0;
  if (r.code !== 0) return { staged, modified, untracked };
  for (const line of r.stdout.split(/\r?\n/)) {
    if (!line) continue;
    const x = line[0] ?? ' ';
    const y = line[1] ?? ' ';
    if (x === '?' && y === '?') {
      untracked++;
      continue;
    }
    if (x !== ' ' && x !== '?') staged++;
    if (y !== ' ' && y !== '?') modified++;
  }
  return { staged, modified, untracked };
}

async function readRecentCommits(cwd: string, limit: number): Promise<GitCommit[]> {
  // 필드 구분: \x1f, 레코드 구분: \x1e — 커밋 메시지 body에 newline이 있어도 안전
  const r = await runGit(cwd, [
    'log',
    '-n',
    String(limit),
    '--pretty=format:%H%x1f%s%x1f%an%x1f%at%x1f%b%x1e',
  ]);
  if (r.code !== 0 || !r.stdout) return [];
  const commits: GitCommit[] = [];
  const marker = GIT_STATUS_CONFIG.CLAUDE_COAUTHOR_MARKER;
  for (const record of r.stdout.split('\x1e')) {
    const trimmed = record.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\x1f');
    const sha = parts[0];
    if (!sha) continue;
    const subject = (parts[1] ?? '').trim();
    const author = (parts[2] ?? '').trim();
    const tsRaw = parts[3] ?? '0';
    const body = parts[4] ?? '';
    commits.push({
      sha: sha.slice(0, 7),
      subject,
      author,
      timestamp: parseNonNeg(tsRaw) * 1000,
      coAuthoredByClaude: body.toLowerCase().includes(marker),
    });
  }
  return commits;
}

function parseNonNeg(s: string | undefined): number {
  if (!s) return 0;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function runGit(cwd: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      {
        windowsHide: true,
        timeout: GIT_STATUS_CONFIG.COMMAND_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        const code = normalizeExitCode(err);
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      },
    );
  });
}

function runGitGlobal(args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { windowsHide: true, timeout: GIT_STATUS_CONFIG.COMMAND_TIMEOUT_MS },
      (err, stdout, stderr) => {
        const code = normalizeExitCode(err);
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      },
    );
  });
}

function normalizeExitCode(err: Error | null): number {
  if (!err) return 0;
  const raw = (err as NodeJS.ErrnoException).code;
  return typeof raw === 'number' ? raw : 1;
}

export const gitStatusService = new GitStatusService();
export type { GitStatusService };
export { runGit as runGitCommand };
