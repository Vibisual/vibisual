/**
 * storageRetention.ts — §3.2.3 보존 정책의 **파일 쪽** 집행 + 저장소 사용량 실측.
 *
 * 체크포인트 안쪽(`fileEdits`·`completedCommands`)은 `projectGraph`/`index` 가 각자 상한을 걸고,
 * 여기는 **디스크에 따로 놓인 파일**(sub-streams jsonl · attachments · 워크트리)을 다룬다.
 *
 * 규칙 셋(§3.2.3):
 *  1. **살아있는 것은 나이와 무관하게 보존** — 화면에 떠 있는 서브에이전트의 스트림 파일은 지우지 않는다.
 *     ⚠ "살아있는" 은 registry 뿐 아니라 **아카이브(탭 닫아 '다시 열기' 목록에 남은 것)** 도 포함한다.
 *     registry 만 보면 목록에는 항목이 보이는데 누르면 빈 화면이 된다(실측 2026-08-19: 아카이브 102개 중
 *     실제로 돌았던 2개가 이미 기록 소실, 91개가 같은 시계 위에 있었다).
 *  2. **참조되는 것은 나이와 무관하게 보존** — 첨부는 나이만으로 지우지 않는다. 체크포인트·활동 이력이
 *     아직 그 파일을 가리키면(위성 파일 노드·완료 명령 썸네일) 남긴다. 삭제 후보는 **고아**뿐이다.
 *     git 이 reachable/unreachable 을 가르는 것과 같은 갈래이며, 참조되는 쪽을 무기한으로 둔다.
 *  3. **되돌릴 수 없는 정리는 사용자가 고른다** — 워크트리는 실측만 하고 자동 삭제하지 않는다.
 *     자동 정리 대상도 곧바로 지우지 않고 **휴지통으로 옮긴 뒤** `trashRetentionDays` 가 지나서야 지운다.
 *  4. **조용히 지우지 않는다** — 무엇을 얼마나 지웠는지 그대로 돌려준다(로그 + 화면 + 휴지통 목록).
 *
 * ⚠ **판단이 서지 않으면 지우지 않는다** — 참조 목록을 읽지 못한 프로젝트(체크포인트 손상·권한)는
 *   첨부를 아예 건드리지 않는다(`hasProjectSaveData` 가 접근 실패를 보수적으로 true 로 두는 것과 같은 태도).
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
import { isExpiredByDays, RETENTION_LOG_MAX } from '@vibisual/shared';
import type { RetentionLogEntry } from '@vibisual/shared';
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

// ─── 휴지통 (§3.2.3 규칙 3) ───
//
// 정리는 `unlink` 가 아니라 **이동**이다. 원래 상대 구조를 그대로 보존하므로 복원이 계산으로 끝나고,
// 휴지통 자체를 훑으면 그것이 곧 "무엇을 지웠는지" 목록이 된다 — 별도 기록 파일을 만들지 않는 이유다
// (§3.2 "별도 JSON 저장 금지" 를 새 예외 없이 지킨다).

/** 휴지통 루트 — 프로젝트 저장 폴더 안. 저장 폴더와 같은 볼륨이라 `rename` 이 성립한다. */
const TRASH_SUBDIR = 'trash';

/** 휴지통 상대경로 → 원래 절대경로. `attachments/…` 는 `.vibisual` 아래, 그 밖은 저장 폴더 아래. */
export function originalPathForTrashRel(projectPath: string, saveDir: string, trashRel: string): string {
  const rel = trashRel.replace(/\\/g, '/');
  if (rel.startsWith('attachments/')) return path.join(projectPath, '.vibisual', rel);
  return path.join(saveDir, rel);
}

/** 휴지통 상대경로의 첫 세그먼트로 갈래를 정한다(목록 표시·복원 검증 공용). */
function kindForTrashRel(trashRel: string): RetentionLogEntry['kind'] | null {
  const head = trashRel.replace(/\\/g, '/').split('/')[0];
  if (head === 'attachments') return 'attachments';
  if (head === 'sub-streams') return 'subStreams';
  return null;
}

/**
 * 파일을 휴지통으로 옮긴다. 같은 이름이 이미 있으면 `-1`, `-2` 를 붙여 덮어쓰기를 피한다.
 * 반환은 실제로 들어간 휴지통 상대경로(복원 요청에 그대로 쓰인다). 실패하면 null.
 */
function moveToTrash(saveDir: string, trashRel: string, absPath: string): string | null {
  const base = path.join(saveDir, TRASH_SUBDIR);
  let rel = trashRel.replace(/\\/g, '/');
  let target = path.join(base, rel);
  try {
    const ext = path.extname(rel);
    const stem = rel.slice(0, rel.length - ext.length);
    for (let i = 1; fs.existsSync(target) && i <= 50; i += 1) {
      rel = `${stem}-${i}${ext}`;
      target = path.join(base, rel);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try {
      fs.renameSync(absPath, target);
    } catch (err) {
      // 볼륨이 다르면 rename 이 EXDEV 로 실패한다 — 복사 후 원본 삭제로 같은 결과를 만든다.
      if ((err as NodeJS.ErrnoException)?.code !== 'EXDEV') throw err;
      fs.copyFileSync(absPath, target);
      fs.unlinkSync(absPath);
    }
    // ⚠ 휴지통 시계는 **들어온 시점**부터다. `rename` 은 원본 mtime 을 그대로 옮기므로 이 한 줄이 없으면
    //   90일 된 파일은 휴지통에 들어가는 순간 이미 만료 상태여서 같은 회차에 영구 삭제된다
    //   = 유예가 0 이 되어 휴지통이 이름만 남는다(테스트로 못 박아 둔 자리).
    try {
      const now = new Date();
      fs.utimesSync(target, now, now);
    } catch { /* 시각 갱신 실패는 치명적이지 않다 — 다음 정리에서 지워질 뿐 */ }
    return rel;
  } catch {
    return null; // 잠김/권한 — 다음 부팅에 다시 본다(원본은 그대로 남는다)
  }
}

/** 빈 폴더를 위로 접는다(고아 폴더가 쌓이면 목록만 길어진다). `stopAt` 위로는 올라가지 않는다. */
function pruneEmptyDirsUpTo(startDir: string, stopAt: string): void {
  let cur = path.resolve(startDir);
  const stop = path.resolve(stopAt);
  while (cur.length > stop.length && cur.startsWith(stop)) {
    try {
      if (fs.readdirSync(cur).length > 0) return;
      fs.rmdirSync(cur);
    } catch {
      return;
    }
    cur = path.dirname(cur);
  }
}

/**
 * 휴지통 목록 — 무엇이 복원 가능한 상태로 남아 있는지. 별도 기록 파일 없이 폴더를 훑어 만든다.
 *
 * `reason` 은 갈래에서 되짚는다(첨부는 참조 0 + 나이 초과, 스트림은 나이 초과) — 기록 파일을 두지
 * 않는 대가로 이 한 칸만 추론이다. 나머지는 전부 파일 자체가 사실이다.
 */
export function listTrash(projects: ProjectInfo[]): { entries: RetentionLogEntry[]; totalBytes: number } {
  const entries: RetentionLogEntry[] = [];
  let totalBytes = 0;
  for (const info of projects) {
    let saveDir: string;
    try {
      saveDir = projectDirForInfo(info);
    } catch {
      continue;
    }
    const root = path.join(saveDir, TRASH_SUBDIR);
    const walk = (dir: string): void => {
      let items: fs.Dirent[];
      try {
        items = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const it of items) {
        const p = path.join(dir, it.name);
        if (it.isDirectory()) { walk(p); continue; }
        if (!it.isFile()) continue;
        try {
          const st = fs.statSync(p);
          const trashRel = path.relative(root, p).replace(/\\/g, '/');
          const kind = kindForTrashRel(trashRel);
          if (!kind) continue;
          totalBytes += st.size;
          entries.push({
            at: st.mtimeMs,
            kind,
            projectPath: info.path,
            projectName: info.name,
            trashRel,
            originalPath: originalPathForTrashRel(info.path, saveDir, trashRel).replace(/\\/g, '/'),
            bytes: st.size,
            reason: kind === 'attachments' ? 'orphan-expired' : 'expired',
          });
        } catch { /* 사라짐 — 무시 */ }
      }
    };
    walk(root);
  }
  // 최근 것이 위로. 목록은 화면용이라 개수에 상한을 둔다(§3.2.3 — 값이 아니라 개수에도 캡).
  entries.sort((a, b) => b.at - a.at);
  return { entries: entries.slice(0, RETENTION_LOG_MAX), totalBytes };
}

/**
 * 휴지통에서 되살린다. 원래 자리에 이미 파일이 있으면 **덮어쓰지 않고** 실패로 돌려준다
 * (되살리기가 지금 것을 지우는 일이 되면 안 된다).
 */
export function restoreFromTrash(info: ProjectInfo, trashRel: string): { ok: boolean; error?: string; restoredTo?: string } {
  const rel = trashRel.replace(/\\/g, '/');
  if (!kindForTrashRel(rel)) return { ok: false, error: 'unknown trash kind' };
  let saveDir: string;
  try {
    saveDir = projectDirForInfo(info);
  } catch {
    return { ok: false, error: 'project has no save dir' };
  }
  const root = path.resolve(path.join(saveDir, TRASH_SUBDIR));
  const src = path.resolve(path.join(root, rel));
  // 경로 탈출 차단 — `..` 이 섞인 요청이 휴지통 밖을 건드리지 못하게.
  if (!src.startsWith(root + path.sep)) return { ok: false, error: 'path outside trash' };
  if (!fs.existsSync(src)) return { ok: false, error: 'not found in trash' };
  const dest = originalPathForTrashRel(info.path, saveDir, rel);
  if (fs.existsSync(dest)) return { ok: false, error: 'destination already exists' };
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      fs.renameSync(src, dest);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'EXDEV') throw err;
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
    }
    pruneEmptyDirsUpTo(path.dirname(src), root);
    return { ok: true, restoredTo: dest.replace(/\\/g, '/') };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 휴지통 만료분 **영구 삭제**. 여기가 유일하게 되돌릴 수 없는 자리라, 지운 양을 따로 돌려준다.
 * `days <= 0` 이면 영구 보관(지우지 않음).
 */
export function pruneTrash(
  saveDirs: string[],
  days: number,
): { purgedFiles: number; purgedBytes: number } {
  let purgedFiles = 0;
  let purgedBytes = 0;
  if (days <= 0) return { purgedFiles, purgedBytes };

  for (const saveDir of saveDirs) {
    const root = path.join(saveDir, TRASH_SUBDIR);
    const walk = (dir: string): void => {
      let items: fs.Dirent[];
      try {
        items = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const it of items) {
        const p = path.join(dir, it.name);
        if (it.isDirectory()) { walk(p); continue; }
        if (!it.isFile()) continue;
        try {
          const st = fs.statSync(p);
          if (!isExpiredByDays(st.mtimeMs, days)) continue;
          purgedBytes += st.size;
          fs.unlinkSync(p);
          purgedFiles += 1;
        } catch { /* 사라짐/잠김 — 다음 부팅에 다시 본다 */ }
      }
      pruneEmptyDirsUpTo(dir, root);
    };
    walk(root);
  }
  return { purgedFiles, purgedBytes };
}

// ─── 참조 수집 (§3.2.3 규칙 2) ───

/**
 * 그 프로젝트가 **아직 가리키고 있는 첨부 파일명** 집합. 못 읽으면 `null` — 호출부는 그때 정리를 건너뛴다.
 *
 * 왜 파일명(basename)인가: 같은 파일을 체크포인트는 상대경로(`.vibisual/attachments/…`)로, 완료 명령은
 * 절대경로로 들고 있어 경로 문자열이 한 벌로 맞지 않는다. 파일명은 업로드 때 붙인 UUID 라 충돌이 없고,
 * 혹시 겹쳐도 **더 많이 남기는 쪽**으로만 틀린다(안전한 방향).
 *
 * 왜 JSON.parse 가 아니라 문자열 훑기인가: 필요한 건 "이 이름이 어딘가 나오는가" 뿐이라 파싱은
 * 낭비다(체크포인트 2.5MB + 활동 6.7MB). 부팅 1회라도 파싱 피크를 만들지 않는다.
 */
function collectReferencedAttachmentNames(saveDir: string): Set<string> | null {
  const names = new Set<string>();
  let readAny = false;
  for (const fname of ['checkpoint.json', 'activity.json']) {
    const fp = path.join(saveDir, fname);
    if (!fs.existsSync(fp)) continue; // 없는 것은 정상(활동 분리 전 버전 등)
    let text: string;
    try {
      text = fs.readFileSync(fp, 'utf8');
    } catch {
      return null; // 있는데 못 읽었다 = 판단이 서지 않는다 → 정리 금지
    }
    readAny = true;
    const re = /attachments\/[^"\\]+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const seg = m[0].split('/');
      const last = seg[seg.length - 1];
      if (last) names.add(last.toLowerCase());
    }
  }
  // 저장 데이터가 하나도 없으면 참조를 확정할 수 없다 — 이 경우도 건드리지 않는다.
  return readAny ? names : null;
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
  const trash = measureDir(path.join(saveDir, TRASH_SUBDIR));
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
    // 휴지통은 본체와 따로 세운다 — 합치면 "정리했는데 왜 안 줄었나"가 안 보인다.
    add('trash', trash),
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
  protectedSubAgentIds: Set<string>,
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
        // 규칙 1 — 살아있는 것 + **아카이브(다시 열기 목록)** 는 나이와 무관하게 보존.
        if (protectedSubAgentIds.has(subId)) { skipped += 1; continue; }
        const fp = path.join(dir, f);
        try {
          const st = fs.statSync(fp);
          if (!isExpiredByDays(st.mtimeMs, days)) continue;
          const size = st.size;
          // 규칙 3 — 지우지 않고 휴지통으로. 실패하면 원본을 그대로 두고 넘어간다.
          if (!moveToTrash(saveDir, `sub-streams/${agentDir}/${f}`, fp)) continue;
          freedBytes += size;
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
 * 보존 기간이 지난 **고아** 첨부 정리. 명세(`index.ts` 업로드 주석)에는 "완료 후 cleanup" 이 적혀
 * 있었으나 실제 정리 함수가 없어 118파일 6.9MB 가 남아 있었다 — 그 명세를 여기서 이행한다.
 *
 * ⚠ 종전 구현은 두 가지를 함께 틀렸고 그 둘이 겹쳐 **실제 손실 직전까지 갔다**(실측 2026-08-19):
 *  - **살아있음·참조 검사가 없었다** — `liveSubAgentIds` 를 받지도 않아 지금 돌고 있는 세션의 첨부까지
 *    지웠다. 반대편에서 참조하는 쪽은 나이 제한이 없다(위성 파일 노드 89개 · 완료 명령 최고령 37일)
 *    → 읽는 쪽이 파일 쪽보다 멀리 닿아 §3.2.3 의 "소비자에게 no-op" 이 뒤집혔다.
 *  - **세션 폴더 mtime 으로 판정했다** — 손자 파일 추가를 추적하지 못해 살아있는 폴더를 늙은 것으로 봤고,
 *    판정 단위가 폴더라 `rmSync(recursive)` 로 참조 중인 파일까지 함께 날렸다.
 *
 * 사라지는 방식까지 조용했다 — 클라이언트(`attachmentThumb.ts`)는 fetch 실패를 걸러내므로 썸네일이
 * 깨진 아이콘도 없이 없어졌다. 붙여넣은 스크린샷은 클립보드가 사라진 뒤라 이 파일이 유일본이다.
 */
export function pruneAttachments(
  projects: ProjectInfo[],
  protectedSubAgentIds: Set<string>,
  days: number,
): { removedFiles: number; freedBytes: number; keptReferenced: number; skippedProjects: number } {
  let removedFiles = 0;
  let freedBytes = 0;
  let keptReferenced = 0;
  let skippedProjects = 0;
  if (days <= 0) return { removedFiles, freedBytes, keptReferenced, skippedProjects }; // 0 = 무제한

  for (const info of projects) {
    let saveDir: string;
    try {
      saveDir = projectDirForInfo(info);
    } catch {
      continue;
    }
    const attachRoot = path.join(info.path, '.vibisual', 'attachments');
    if (!fs.existsSync(attachRoot)) continue;

    // ① 후보를 먼저 모은다 — **파일 단위 mtime**. 종전에는 1단 세션 폴더의 mtime 을 봤는데,
    //    부모 폴더의 mtime 은 **직속 자식**이 바뀔 때만 갱신되고 손자 파일 추가는 추적하지 않는다
    //    (`<세션>/<서브>/<파일>` 구조라 실제로 늘 손자다) → 방금 쓴 이미지가 든 폴더도 늙은 것으로 오판됐다.
    const candidates: { fp: string; rel: string; size: number; subId: string; name: string }[] = [];
    const walk = (dir: string): void => {
      let items: fs.Dirent[];
      try {
        items = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const it of items) {
        const p = path.join(dir, it.name);
        if (it.isDirectory()) { walk(p); continue; }
        if (!it.isFile()) continue;
        try {
          const st = fs.statSync(p);
          if (!isExpiredByDays(st.mtimeMs, days)) continue;
          const rel = path.relative(attachRoot, p).replace(/\\/g, '/');
          const seg = rel.split('/');
          candidates.push({
            fp: p,
            rel,
            size: st.size,
            // `<세션키>/<서브에이전트id>/<파일>` — 서브가 없는 옛 구조면 빈 문자열.
            subId: seg.length >= 3 ? (seg[seg.length - 2] ?? '') : '',
            name: (seg[seg.length - 1] ?? '').toLowerCase(),
          });
        } catch { /* 사라짐 — 무시 */ }
      }
    };
    walk(attachRoot);
    if (candidates.length === 0) continue; // 후보가 없으면 참조 목록도 읽지 않는다(부팅 비용 0)

    // ② 참조 목록. 못 읽었으면 이 프로젝트는 아예 건드리지 않는다("판단이 서지 않으면 지우지 않는다").
    const referenced = collectReferencedAttachmentNames(saveDir);
    if (!referenced) {
      skippedProjects += 1;
      logger.warn(
        `storage cleanup: attachments untouched for "${info.name}" — 참조 목록을 읽지 못했다(체크포인트 손상/권한). ` +
        `후보 ${candidates.length}건은 그대로 남긴다.`,
      );
      continue;
    }

    for (const c of candidates) {
      // 규칙 2 — 아직 가리켜지고 있으면 나이와 무관하게 남긴다.
      //   (a) 체크포인트·활동 이력에 이름이 남아 있다(위성 파일 노드 · 완료 명령 썸네일).
      //   (b) 그 대화 자체를 보존 중이다 — 살아있거나 "다시 열기" 목록에 있는 서브에이전트의 첨부.
      if (referenced.has(c.name) || (c.subId && protectedSubAgentIds.has(c.subId))) {
        keptReferenced += 1;
        continue;
      }
      if (!moveToTrash(saveDir, `attachments/${c.rel}`, c.fp)) continue;
      removedFiles += 1;
      freedBytes += c.size;
      pruneEmptyDirsUpTo(path.dirname(c.fp), attachRoot);
    }
  }
  return { removedFiles, freedBytes, keptReferenced, skippedProjects };
}

/**
 * 파일 쪽 정리를 한 번에 — 부팅 시 1회 + 사용자가 화면에서 [정리] 를 누를 때.
 *
 * 반환값은 그대로 사용자에게 보여 준다(§3.2.3 "조용히 지우지 않는다").
 */
export function runStorageCleanup(opts: {
  projects: ProjectInfo[];
  /**
   * 나이와 무관하게 지키는 서브에이전트 id — **registry(살아있는 것) + archive(다시 열기 목록)** 합집합.
   * 호출부에서 합쳐 넘긴다(여기서 `getSnapshot()` 만 보면 아카이브가 새어 나간다).
   */
  protectedSubAgentIds: Set<string>;
}): StorageCleanupResult {
  const retention = appStateGetRetention();
  const saveDirs: string[] = [];
  for (const p of opts.projects) {
    try {
      saveDirs.push(projectDirForInfo(p));
    } catch { /* path 빈 ghost meta — 건너뛴다 */ }
  }

  const streams = pruneSubStreams(saveDirs, opts.protectedSubAgentIds, retention.subStreamRetentionDays);
  const attachments = pruneAttachments(opts.projects, opts.protectedSubAgentIds, retention.attachmentRetentionDays);
  // 휴지통 만료분은 **마지막에** 지운다 — 방금 옮긴 것이 같은 회차에 사라지지 않게(mtime 이 지금이라 안전하지만
  // 순서를 뒤집으면 "옮겼다가 곧 지웠다"는 흐름이 로그에서 뒤바뀌어 읽힌다).
  const trash = pruneTrash(saveDirs, retention.trashRetentionDays);

  const skipped: string[] = [];
  if (streams.skipped > 0) skipped.push(`protected-sub-streams:${streams.skipped}`);
  if (attachments.keptReferenced > 0) skipped.push(`referenced-attachments:${attachments.keptReferenced}`);
  if (attachments.skippedProjects > 0) skipped.push(`attachments-unknown-refs:${attachments.skippedProjects}`);
  if (retention.subStreamRetentionDays <= 0) skipped.push('sub-streams:disabled');
  if (retention.attachmentRetentionDays <= 0) skipped.push('attachments:disabled');
  if (retention.trashRetentionDays <= 0) skipped.push('trash:kept-forever');

  const result: StorageCleanupResult = {
    removedFiles: streams.removedFiles + attachments.removedFiles,
    freedBytes: streams.freedBytes + attachments.freedBytes,
    byKind: {
      subStreams: streams.freedBytes,
      attachments: attachments.freedBytes,
      trash: trash.purgedBytes,
    },
    skipped,
    purgedFiles: trash.purgedFiles,
    purgedBytes: trash.purgedBytes,
    keptReferenced: attachments.keptReferenced,
  };

  if (result.removedFiles > 0 || trash.purgedFiles > 0) {
    logger.info(
      `storage cleanup: moved ${result.removedFiles} file(s) to trash (${(result.freedBytes / 1024 / 1024).toFixed(1)}MB) ` +
      `— sub-streams ${streams.removedFiles}, attachments ${attachments.removedFiles}` +
      `${streams.skipped > 0 ? `, kept ${streams.skipped} protected` : ''}` +
      `${attachments.keptReferenced > 0 ? `, kept ${attachments.keptReferenced} referenced` : ''}` +
      `; purged ${trash.purgedFiles} from trash (${(trash.purgedBytes / 1024 / 1024).toFixed(1)}MB)`,
    );
  }
  return result;
}
