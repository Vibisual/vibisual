/**
 * 폴더 목록의 **행 만들기와 창 자르기** — 순수 함수라 단위 테스트가 붙는다(§7.5).
 *
 * 왜 따로 두는가: 목록은 이제 "폴더 하나 = 트리 한 벌"이 아니라 **겹(level)마다 페이지가 따로 도는
 * 구조**다. 화면은 그 겹들을 펼침 상태에 따라 평탄한 행으로 펴서 그리고, 그중 **보이는 구간만**
 * DOM 으로 만든다. 두 계산 모두 React 밖에서 결정되어야 눈으로 확인하지 않고도 고정할 수 있다
 * (§5.5 #17-19 `explorerModel.ts` 가 IDE 탐색기에서 쓰는 수법과 같다).
 *
 * ⚠ 여기서의 재귀는 **이미 메모리에 있는 겹**만 훑는다 — 디스크를 건드리지 않는다.
 */

import type { FolderFileEntry } from '@vibisual/shared';

/** 한 행의 높이(px). 윈도잉이 스크롤 위치로 행 번호를 셈하려면 고정이어야 한다. */
export const FOLDER_ROW_HEIGHT = 22;

/** 보이는 구간 위아래로 더 그려 둘 행 수 — 빠른 스크롤에서 빈 칸이 스치는 것을 막는다. */
export const FOLDER_ROW_OVERSCAN = 8;

/**
 * 겹 하나의 상태. 키는 그 겹의 `subPath`(폴더 자신의 겹은 `''`).
 *
 * `entries` 는 **지금까지 받아 온 페이지들을 이어 붙인 것**이고, `nextCursor` 가 있으면 아직 더 있다.
 */
export interface FolderLevelState {
  entries: FolderFileEntry[];
  /** 다음 장 커서. `null` 이면 이 겹은 끝까지 받았다. */
  nextCursor: string | null;
  /** 이 겹의 전체 항목 수(서버가 센 값). */
  total: number;
  /** 지금 한 장을 받아 오는 중인가. */
  loading: boolean;
  /**
   * 마지막 요청이 실패했는가(끊김·404·시간 초과).
   * 실패를 상태로 들지 않으면 화면이 "불러오는 중" 에서 영영 멈춘다 — 그것이 이 절이 고친 증상이다.
   */
  failed: boolean;
}

/** 화면에 그릴 행 하나. */
export type FolderTreeRow =
  | {
      kind: 'entry';
      /** React key — 겹이 달라도 충돌하지 않게 겹 경로를 앞에 붙인다. */
      key: string;
      entry: FolderFileEntry;
      /** 이 항목이 속한 겹의 subPath. */
      subPath: string;
      /** 이 항목을 펼쳤을 때 자식이 들어갈 겹의 subPath(폴더일 때만 의미 있다). */
      childSubPath: string;
      depth: number;
      expanded: boolean;
    }
  | {
      kind: 'more';
      key: string;
      /** 더 받아야 할 겹. */
      subPath: string;
      depth: number;
      loaded: number;
      total: number;
      loading: boolean;
      failed: boolean;
    };

/** 이 폴더 노드 기준의 자식 겹 경로 — `''` 아래는 `name`, 그 아래는 `a/b`. */
export function childSubPathOf(subPath: string, name: string): string {
  return subPath ? `${subPath}/${name}` : name;
}

/**
 * 겹 지도 + 펼침 집합 → 화면에 그릴 **평탄한 행 목록**.
 *
 * 펼쳐졌는데 아직 그 겹을 못 받았으면 자식 행은 없다(로딩 표시는 훅이 그 겹의 `loading` 으로 말한다).
 * 겹 끝에 아직 더 있으면 그 자리에 `more` 행 하나를 둔다 — 화면은 그 행이 보이는 순간 다음 장을 부른다.
 */
export function flattenFolderLevels(
  levels: ReadonlyMap<string, FolderLevelState>,
  expanded: ReadonlySet<string>,
  subPath = '',
  depth = 0,
): FolderTreeRow[] {
  const level = levels.get(subPath);
  if (!level) return [];

  const rows: FolderTreeRow[] = [];
  for (const entry of level.entries) {
    const childPath = childSubPathOf(subPath, entry.name);
    const isExpanded = entry.isDirectory && expanded.has(childPath);
    rows.push({
      kind: 'entry',
      key: `${subPath}::${entry.relativePath}`,
      entry,
      subPath,
      childSubPath: childPath,
      depth,
      expanded: isExpanded,
    });
    if (isExpanded) {
      rows.push(...flattenFolderLevels(levels, expanded, childPath, depth + 1));
    }
  }

  // 실패했을 때도 이 행을 남긴다 — 사라지면 사용자가 다시 시도할 자리가 없다.
  if (level.nextCursor !== null || level.failed) {
    rows.push({
      kind: 'more',
      key: `${subPath}::__more__`,
      subPath,
      depth,
      loaded: level.entries.length,
      total: level.total,
      loading: level.loading,
      failed: level.failed,
    });
  }
  return rows;
}

/** 지금 그릴 구간과 위아래로 대신 채울 여백(px). */
export interface FolderRowWindow {
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
}

/**
 * 보이는 구간만 남긴다 — 나머지는 위아래 여백 두 칸으로 대신한다.
 *
 * 목록이 수천 줄이 돼도 DOM 에 남는 행은 화면에 들어가는 만큼 + 여유분뿐이다
 * (사용자 지시 — "안 보면 읽어온 거 메모리 안 잡게").
 */
export function folderRowWindow(
  rowCount: number,
  scrollTop: number,
  clientHeight: number,
  rowHeight: number = FOLDER_ROW_HEIGHT,
  overscan: number = FOLDER_ROW_OVERSCAN,
): FolderRowWindow {
  if (rowCount <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  const safeTop = Math.max(0, scrollTop);
  // 높이를 아직 모를 때(첫 페인트 전 `clientHeight === 0`)는 한 화면치를 넉넉히 그린다 —
  // 0 을 그대로 믿으면 목록이 빈 채로 굳어 스크롤이 시작되지 않는다.
  const viewport = clientHeight > 0 ? clientHeight : rowHeight * (overscan * 2);
  const first = Math.floor(safeTop / rowHeight);
  const visible = Math.ceil(viewport / rowHeight);
  const start = Math.max(0, first - overscan);
  const end = Math.min(rowCount, first + visible + overscan);
  return {
    start,
    end,
    padTop: start * rowHeight,
    padBottom: Math.max(0, (rowCount - end) * rowHeight),
  };
}

/**
 * 접은 겹과 **그 아래 모든 겹**을 지도에서 버린다 — 접는 즉시 메모리에서 사라진다.
 *
 * 접었다 다시 펴면 첫 장을 새로 받는다. 그 왕복(수십 ms)이 안 보는 트리를 계속 들고 있는 것보다 싸고,
 * 다시 펼 때 디스크의 현재 상태가 오는 이득도 있다.
 */
export function dropLevelSubtree(
  levels: ReadonlyMap<string, FolderLevelState>,
  subPath: string,
): Map<string, FolderLevelState> {
  const next = new Map(levels);
  const prefix = `${subPath}/`;
  for (const key of levels.keys()) {
    if (key === subPath || key.startsWith(prefix)) next.delete(key);
  }
  return next;
}

/** 접힌 겹의 펼침 표시도 함께 걷는다(다시 펼 때 "펼쳐졌는데 내용이 없는" 상태를 만들지 않는다). */
export function dropExpandedSubtree(
  expanded: ReadonlySet<string>,
  subPath: string,
): Set<string> {
  const next = new Set(expanded);
  const prefix = `${subPath}/`;
  for (const key of expanded) {
    if (key === subPath || key.startsWith(prefix)) next.delete(key);
  }
  return next;
}
