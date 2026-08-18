/**
 * storageRetention.ts — §3.2.3 보존 정책의 **파일 쪽** 집행 + 저장소 사용량 실측.
 *
 * 체크포인트 안쪽(`fileEdits`·`completedCommands`)은 `projectGraph`/`index` 가 각자 상한을 걸고,
 * 여기는 **디스크에 따로 놓인 파일**(sub-streams jsonl · attachments · 워크트리)을 다룬다.
 *
 * 규칙 셋(§3.2.3):
 *  1. **살아있는 것은 나이와 무관하게 보존** — 화면에 떠 있는 서브에이전트의 스트림 파일은 지우지 않는다.
 *  2. **되돌릴 수 없는 정리는 사용자가 고른다** — 워크트리는 실측만 하고 자동 삭제하지 않는다.
 *  3. **조용히 지우지 않는다** — 무엇을 얼마나 지웠는지 그대로 돌려준다(로그 + 화면).
 */
import fs from 'node:fs';
import path from 'node:path';
import type {
  ProjectInfo,
  ProjectStorageUsage,
  StorageCleanupResult,
  StorageUsageEntry,
  StorageUsageKind,
  StorageUsageReport,
  WorktreeStorageUsage,
} from '@vibisual/shared';
import { isExpiredByDays } from '@vibisual/shared';
import { appStateGetRetention } from './appState.js';
import { projectDirForInfo } from './statePersistence.js';
import { logger } from '../logger.js';

/** 재귀 용량 합산. 접근 못 하는 항목은 조용히 건너뛴다(실측이 목적이라 실패가 치명적이지 않다). */
function measureDir(dir: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { bytes, files };
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    try {
      if (e.isDirectory()) {
        const sub = measureDir(p);
        bytes += sub.bytes;
        files += sub.files;
      } else if (e.isFile()) {
        bytes += fs.statSync(p).size;
        files += 1;
      }
    } catch { /* 사라졌거나 권한 없음 — 무시 */ }
  }
  return { bytes, files };
}

function measureFile(fp: string): { bytes: number; files: number } {
  try {
    return { bytes: fs.statSync(fp).size, files: 1 };
  } catch {
    return { bytes: 0, files: 0 };
  }
}

/** `<file>.bak1..N` 합계 — 본체와 따로 보여 줘야 "백업이 3벌 더 있다"가 눈에 띈다. */
function measureBackups(fp: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  for (let i = 1; i <= 5; i += 1) {
    const m = measureFile(`${fp}.bak${i}`);
    bytes += m.bytes;
    files += m.files;
  }
  return { bytes, files };
}

/** 프로젝트 하나의 `.vibisual` 사용량을 갈래별로 실측. */
export function scanProjectStorage(info: ProjectInfo): ProjectStorageUsage {
  const saveDir = projectDirForInfo(info);
  const vibiDir = path.join(info.path, '.vibisual');
  const add = (kind: StorageUsageKind, m: { bytes: number; files: number }): StorageUsageEntry =>
    ({ kind, bytes: m.bytes, fileCount: m.files });

  const cp = measureFile(path.join(saveDir, 'checkpoint.json'));
  const cpBak = measureBackups(path.join(saveDir, 'checkpoint.json'));
  const activity = measureFile(path.join(saveDir, 'activity.json'));
  const activityBak = measureBackups(path.join(saveDir, 'activity.json'));
  const identity = measureFile(path.join(saveDir, 'identity.json'));
  const identityBak = measureBackups(path.join(saveDir, 'identity.json'));
  const subStreams = measureDir(path.join(saveDir, 'sub-streams'));
  const attachments = measureDir(path.join(vibiDir, 'attachments'));
  const brain = measureDir(path.join(vibiDir, 'brain'));
  const logs = measureDir(path.join(vibiDir, 'logs'));
  const video = measureDir(path.join(vibiDir, 'video'));

  const entries: StorageUsageEntry[] = [
    add('checkpoint', cp),
    add('activity', activity),
    add('identity', identity),
    // 백업 3세대는 본체와 같은 크기라 합치면 "왜 4배인가"가 안 보인다 — 한 줄로 따로 세운다.
    add('checkpointBackups', {
      bytes: cpBak.bytes + activityBak.bytes + identityBak.bytes,
      files: cpBak.files + activityBak.files + identityBak.files,
    }),
    add('subStreams', subStreams),
    add('attachments', attachments),
    add('brain', brain),
    add('logs', logs),
    add('video', video),
  ].filter((e) => e.bytes > 0);

  const totalBytes = entries.reduce((s, e) => s + e.bytes, 0);
  return { projectPath: info.path, projectName: info.name, totalBytes, entries };
}

/**
 * `<project>/.claude/worktrees/*` 실측. **삭제하지 않는다** — 사용자 산출물이 섞일 수 있어
 * §3.2.3 대로 화면에 보여 주고 사용자가 고른다.
 */
export function scanWorktrees(projectPaths: string[]): WorktreeStorageUsage[] {
  const out: WorktreeStorageUsage[] = [];
  const seen = new Set<string>();
  for (const root of projectPaths) {
    const wtRoot = path.join(root, '.claude', 'worktrees');
    let names: string[];
    try {
      names = fs.readdirSync(wtRoot);
    } catch {
      continue;
    }
    for (const name of names) {
      const p = path.join(wtRoot, name);
      const key = path.resolve(p).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const st = fs.statSync(p);
        if (!st.isDirectory()) continue;
        const m = measureDir(p);
        out.push({
          path: p.replace(/\\/g, '/'),
          name,
          bytes: m.bytes,
          alive: fs.existsSync(path.join(p, '.git')),
          lastModifiedAt: st.mtimeMs,
        });
      } catch { /* 사라짐 — 무시 */ }
    }
  }
  return out.sort((a, b) => b.bytes - a.bytes);
}

/** 전체 사용량 보고 — `GET /api/storage-usage`. */
export function scanStorageUsage(projects: ProjectInfo[]): StorageUsageReport {
  const seen = new Set<string>();
  const uniq = projects.filter((p) => {
    const k = path.resolve(p.path).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const projectUsages = uniq.map(scanProjectStorage).sort((a, b) => b.totalBytes - a.totalBytes);
  // 워크트리는 부모 프로젝트에만 있다(워크트리 안의 `.claude/worktrees` 는 보지 않는다).
  const worktrees = scanWorktrees(uniq.filter((p) => !p.parentProjectPath).map((p) => p.path));
  const totalBytes =
    projectUsages.reduce((s, p) => s + p.totalBytes, 0) + worktrees.reduce((s, w) => s + w.bytes, 0);
  return { projects: projectUsages, worktrees, totalBytes, scannedAt: Date.now() };
}

/**
 * 보존 기간이 지난 `sub-streams/<agentId>/<subId>.jsonl` 정리.
 *
 * ⚠ `liveSubAgentIds` 에 든 것은 **나이와 무관하게 보존**한다 — 화면에 떠 있는 대화를 지우면
 *   IDE 를 다시 열었을 때 빈 화면이 된다(§3.2.3 규칙 1, `deleteAgentStreams` 주석과 같은 이유).
 */
export function pruneSubStreams(
  saveDirs: string[],
  liveSubAgentIds: Set<string>,
  days: number,
): { removedFiles: number; freedBytes: number; skipped: number } {
  let removedFiles = 0;
  let freedBytes = 0;
  let skipped = 0;
  if (days <= 0) return { removedFiles, freedBytes, skipped }; // 0 = 무제한

  for (const saveDir of saveDirs) {
    const root = path.join(saveDir, 'sub-streams');
    let agentDirs: string[];
    try {
      agentDirs = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const agentDir of agentDirs) {
      const dir = path.join(root, agentDir);
      let files: string[];
      try {
        files = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue;
        const subId = f.slice(0, -'.jsonl'.length);
        if (liveSubAgentIds.has(subId)) { skipped += 1; continue; }
        const fp = path.join(dir, f);
        try {
          const st = fs.statSync(fp);
          if (!isExpiredByDays(st.mtimeMs, days)) continue;
          freedBytes += st.size;
          fs.unlinkSync(fp);
          removedFiles += 1;
        } catch { /* 사라짐/잠김 — 다음 부팅에 다시 본다 */ }
      }
      // 비었으면 폴더도 접는다(고아 폴더가 쌓이면 목록만 길어진다).
      try {
        if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
      } catch { /* noop */ }
    }
  }
  return { removedFiles, freedBytes, skipped };
}

/**
 * 보존 기간이 지난 첨부 정리. 명세(`index.ts` 업로드 주석)에는 "완료 후 cleanup" 이 적혀 있었으나
 * 실제 정리 함수가 없어 118파일 6.9MB 가 남아 있었다 — 그 명세를 여기서 실제로 이행한다.
 */
export function pruneAttachments(
  projectPaths: string[],
  days: number,
): { removedFiles: number; freedBytes: number } {
  let removedFiles = 0;
  let freedBytes = 0;
  if (days <= 0) return { removedFiles, freedBytes }; // 0 = 무제한

  for (const root of projectPaths) {
    const attachRoot = path.join(root, '.vibisual', 'attachments');
    let sessionDirs: string[];
    try {
      sessionDirs = fs.readdirSync(attachRoot);
    } catch {
      continue;
    }
    for (const sd of sessionDirs) {
      const dir = path.join(attachRoot, sd);
      try {
        const st = fs.statSync(dir);
        if (!st.isDirectory()) continue;
        if (!isExpiredByDays(st.mtimeMs, days)) continue;
        const m = measureDir(dir);
        fs.rmSync(dir, { recursive: true, force: true });
        removedFiles += m.files;
        freedBytes += m.bytes;
      } catch { /* noop */ }
    }
  }
  return { removedFiles, freedBytes };
}

/**
 * 파일 쪽 정리를 한 번에 — 부팅 시 1회 + 사용자가 화면에서 [정리] 를 누를 때.
 *
 * 반환값은 그대로 사용자에게 보여 준다(§3.2.3 "조용히 지우지 않는다").
 */
export function runStorageCleanup(opts: {
  projects: ProjectInfo[];
  liveSubAgentIds: Set<string>;
}): StorageCleanupResult {
  const retention = appStateGetRetention();
  const saveDirs = opts.projects.map(projectDirForInfo);
  const projectPaths = opts.projects.map((p) => p.path);

  const streams = pruneSubStreams(saveDirs, opts.liveSubAgentIds, retention.subStreamRetentionDays);
  const attachments = pruneAttachments(projectPaths, retention.attachmentRetentionDays);

  const skipped: string[] = [];
  if (streams.skipped > 0) skipped.push(`live-sub-streams:${streams.skipped}`);
  if (retention.subStreamRetentionDays <= 0) skipped.push('sub-streams:disabled');
  if (retention.attachmentRetentionDays <= 0) skipped.push('attachments:disabled');

  const result: StorageCleanupResult = {
    removedFiles: streams.removedFiles + attachments.removedFiles,
    freedBytes: streams.freedBytes + attachments.freedBytes,
    byKind: {
      subStreams: streams.freedBytes,
      attachments: attachments.freedBytes,
    },
    skipped,
  };

  if (result.removedFiles > 0) {
    logger.info(
      `storage cleanup: removed ${result.removedFiles} file(s), freed ${(result.freedBytes / 1024 / 1024).toFixed(1)}MB ` +
      `(sub-streams ${streams.removedFiles}, attachments ${attachments.removedFiles}` +
      `${streams.skipped > 0 ? `, kept ${streams.skipped} live` : ''})`,
    );
  }
  return result;
}
