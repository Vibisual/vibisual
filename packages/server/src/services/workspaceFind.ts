import fs from 'node:fs';
import path from 'node:path';
import {
  WORKSPACE_FIND_DIR_CONCURRENCY,
  WORKSPACE_FIND_RESULT_MAX,
  WORKSPACE_FIND_SCAN_MAX,
  WORKSPACE_FIND_SKIP_DIRS,
  WORKSPACE_FIND_TIME_BUDGET_MS,
  isEditorPaneListable,
  workspaceFileExt,
} from '@vibisual/shared';
import type {
  EditorPaneFileKind,
  WorkspaceEntry,
  WorkspaceFindResult,
  WorkspaceOpenAppClaim,
} from '@vibisual/shared';
import { isExecutableWorkspacePath, resolveWorkspacePath } from './workspaceExplorer.js';

/**
 * §5.5 #17-27 ⑱ — 그 갈래의 파일 찾기(`GET /api/workspace-find`). 서버가 Electron main 과 한 몸이라(§3.7) 전부 `fs.promises`(§9).
 * 항목 수·시간·담는 수 상한 중 하나라도 걸리면 멈추고 `truncated` 로 알린다(조용히 자르면 없는 줄 안다). 너비 우선이라 얕은 결과가 먼저 잡힌다.
 * 판정은 shared `isEditorPaneListable`(화면과 한 벌). 심볼릭 링크는 따라가지 않는다(루트 밖·고리 방지).
 */

export interface FindWorkspaceFilesOptions {
  /** 훑는 항목(파일 + 폴더) 상한. 기본 `WORKSPACE_FIND_SCAN_MAX`. */
  readonly scanMax?: number;
  /** 걷기 · 시각 재기 **각각의** 시간 상한(ms). 기본 `WORKSPACE_FIND_TIME_BUDGET_MS`. */
  readonly timeBudgetMs?: number;
  /** 돌려주는 파일 수 상한. 기본 `WORKSPACE_FIND_RESULT_MAX`. */
  readonly resultMax?: number;
  /** 동시에 읽는 폴더 수. 기본 `WORKSPACE_FIND_DIR_CONCURRENCY`. */
  readonly concurrency?: number;
  /** 시계 — 시험이 시간 상한을 결정적으로 건드리게. */
  readonly now?: () => number;
  /** 실행 파일 판정의 플랫폼 — 시험이 세 OS 를 한 기계에서 보게(멀티플랫폼 규약). */
  readonly platform?: NodeJS.Platform;
}

/** 시각을 잴 때 한 번에 띄우는 `stat` 수 — 파일 수천 개를 한꺼번에 열지 않는다. */
const STAT_BATCH = 32;

const SKIP_DIRS: ReadonlySet<string> = new Set(WORKSPACE_FIND_SKIP_DIRS);

/** 이름을 코드 단위로 견준다 — 로케일 정렬(ICU)은 기계마다 답이 달라 상한 근처의 결과가 흔들린다. */
function byName(a: fs.Dirent, b: fs.Dirent): number {
  if (a.name < b.name) return -1;
  return a.name > b.name ? 1 : 0;
}

/**
 * `root` 아래에서 `kind` 갈래로 그릴 수 있는 파일을 모은다. 루트가 없거나 폴더가 아니거나 루트 경계를
 * 지나지 못하면 `null`(호출부가 404 로 옮긴다).
 *
 * @param apps 앱이 받겠다고 선언한 확장자(화면이 실어 보낸 것) — 그 파일은 판에 오지 않으므로 빠진다.
 */
export async function findWorkspaceFiles(
  root: string,
  kind: EditorPaneFileKind,
  apps: readonly WorkspaceOpenAppClaim[],
  opts: FindWorkspaceFilesOptions = {},
): Promise<WorkspaceFindResult | null> {
  const resolved = resolveWorkspacePath(root, '');
  if (!resolved) return null;
  try {
    if (!(await fs.promises.stat(resolved.abs)).isDirectory()) return null;
  } catch {
    return null;
  }

  const scanMax = opts.scanMax ?? WORKSPACE_FIND_SCAN_MAX;
  const timeBudgetMs = opts.timeBudgetMs ?? WORKSPACE_FIND_TIME_BUDGET_MS;
  const resultMax = opts.resultMax ?? WORKSPACE_FIND_RESULT_MAX;
  const concurrency = Math.max(1, opts.concurrency ?? WORKSPACE_FIND_DIR_CONCURRENCY);
  const now = opts.now ?? Date.now;
  const platform = opts.platform ?? process.platform;

  // ── 1. 걷기 — 너비 우선, 한 겹을 몇 폴더씩 함께 읽는다 ──
  const walkStart = now();
  let scanned = 0;
  let truncated = false;
  /** 판정은 확장자에만 달려 있어 확장자별로 한 번만 묻는다(수만 파일마다 표를 훑지 않게). */
  const listableByExt = new Map<string, boolean>();
  const listable = (relPath: string): boolean => {
    const ext = workspaceFileExt(relPath);
    let hit = listableByExt.get(ext);
    if (hit === undefined) {
      hit = isEditorPaneListable(relPath, kind, apps);
      listableByExt.set(ext, hit);
    }
    return hit;
  };
  /** 고른 파일(상대 경로 · 이름) — 걸은 차례 그대로(얕은 것이 앞). */
  const picked: { relPath: string; name: string }[] = [];
  const queue: string[] = [''];

  while (queue.length > 0) {
    if (scanned >= scanMax || now() - walkStart > timeBudgetMs) {
      truncated = true;
      break;
    }
    const batch = queue.splice(0, concurrency);
    const listings = await Promise.all(batch.map(async (rel) => {
      const abs = rel ? path.join(resolved.abs, rel) : resolved.abs;
      try {
        return { rel, dirents: await fs.promises.readdir(abs, { withFileTypes: true }) };
      } catch {
        // 못 읽는 폴더(권한·사라짐)는 건너뛴다 — 한 폴더 때문에 목록 전체를 잃지 않는다.
        return { rel, dirents: [] as fs.Dirent[] };
      }
    }));
    for (const { rel, dirents } of listings) {
      dirents.sort(byName);
      for (const d of dirents) {
        scanned += 1;
        if (d.isSymbolicLink()) continue;
        const childRel = rel ? `${rel}/${d.name}` : d.name;
        if (d.isDirectory()) {
          if (!SKIP_DIRS.has(d.name)) queue.push(childRel);
          continue;
        }
        if (d.isFile() && listable(childRel)) picked.push({ relPath: childRel, name: d.name });
      }
    }
  }

  // ── 2. 시각 재기 — 최근 고친 순으로 세우려면 mtime 이 있어야 한다 ──
  //   상한 안에서 얕은 것부터 잰다. 못 잰 파일은 시각 없이 남는다(목록에서 지우지 않는다 — 이름으로는 찾힌다).
  const statStart = now();
  const entries: WorkspaceEntry[] = [];
  for (let i = 0; i < picked.length; i += STAT_BATCH) {
    const slice = picked.slice(i, i + STAT_BATCH);
    if (now() - statStart > timeBudgetMs) {
      truncated = true;
      for (const p of slice) entries.push({ name: p.name, relPath: p.relPath, isDirectory: false });
      continue;
    }
    const stats = await Promise.all(slice.map(async (p) => {
      try {
        return await fs.promises.stat(path.join(resolved.abs, p.relPath));
      } catch {
        return null;
      }
    }));
    slice.forEach((p, j) => {
      const st = stats[j];
      const entry: WorkspaceEntry = { name: p.name, relPath: p.relPath, isDirectory: false };
      if (st) {
        // 코드 갈래에서 실행 파일은 뺀다 — 탐색기에서 누르면 편집창이 아니라 **실행**으로 가는 파일이다
        //   (§5.13 (R-7) — 같은 파일은 어디서 눌러도 같은 곳에서 열린다).
        if (kind === 'code' && isExecutableWorkspacePath(path.join(resolved.abs, p.relPath), st, platform)) return;
        entry.size = st.size;
        entry.mtimeMs = st.mtimeMs;
      }
      entries.push(entry);
    });
  }

  // ── 3. 최근 고친 순(시각 없는 것은 뒤 · 같으면 경로순) → 상한 ──
  entries.sort((a, b) => {
    const am = a.mtimeMs ?? -1;
    const bm = b.mtimeMs ?? -1;
    if (am !== bm) return bm - am;
    if (a.relPath < b.relPath) return -1;
    return a.relPath > b.relPath ? 1 : 0;
  });
  const total = entries.length;
  if (total > resultMax) truncated = true;

  return {
    root: path.resolve(root),
    kind,
    entries: total > resultMax ? entries.slice(0, resultMax) : entries,
    total,
    truncated,
  };
}
