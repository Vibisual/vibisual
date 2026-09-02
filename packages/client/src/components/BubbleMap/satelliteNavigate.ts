/**
 * satelliteNavigate.ts — §2.1 #5 · **위성 파일 더블클릭 → 그 파일이 있는 폴더 안으로.**
 *
 * 내부 폴더의 위성 파일은 예전부터 이렇게 움직였다(`data.path` 의 부모 경로로 폴더를 찾아
 * `enterFolderDeep`). 그런데 **외부 폴더의 위성은 눌러도 아무 일이 없었다** — 이유는 하나,
 * 비교하는 두 값의 모양이 애초에 달랐기 때문이다:
 *
 *   외부 파일 노드의 `path` = `__ext__c:/users/…/tasks/out.json`  (네임스페이스가 붙은 **노드 키**)
 *   외부 폴더 노드의 `path` = `c:/users/…/tasks`                  (순수 **절대경로**)
 *
 * 그래서 부모 경로를 잘라 봐야 `__ext__c:/users/…/tasks` 가 되고, 어떤 폴더와도 영원히 같지
 * 않았다. 이제 **절대경로도 함께 후보로 놓고** 맞춰 본다.
 *
 * 두 번째 규율은 **깊은 곳부터**다. 조상 폴더가 자손이 만진 파일을 물려받아 띄우게 되면서
 * (§2.1 #5 롤업), 최상위에 뜬 파일의 진짜 부모는 몇 겹 아래일 수 있다. 그런데 §9 폴더 스코프
 * 스냅샷은 "그리는 폴더 + 한 칸 앞"만 실어 주므로 **그 깊은 부모가 아직 안 와 있을 수 있다**.
 * 그때 아무 데도 못 가고 멈추는 것보다, 있는 것 중 가장 깊은 조상까지 들어가 주는 편이
 * "그 파일 쪽으로 이동한다"는 뜻에 맞다(한 번 더 누르면 더 깊이 들어간다).
 *
 * DOM 이 필요 없는 순수 함수로 떼어 둔 이유는 클라 테스트에 jsdom 이 없기 때문이다 —
 * 이 판정만은 단위 테스트로 고정된다.
 */
import type { BubbleData, BubbleType } from '@vibisual/shared';
import { FOLDER_BUBBLE_TYPES } from '@vibisual/shared';

/** 위성 파일에서 읽는 것 — 노드 키(`path`)와 디스크 절대경로(`absolutePath`) 둘뿐. */
export interface SatelliteFileRef {
  path?: string | undefined;
  absolutePath?: string | null | undefined;
}

/** 폴더 후보에서 읽는 것. `bubbleType` 으로 "들어갈 수 있는 자리"만 고른다. */
export interface FolderCandidate {
  id: string;
  path?: string | undefined;
  absolutePath?: string | null | undefined;
  bubbleType: BubbleType;
}

/**
 * 경로의 조상 디렉터리 목록 — **깊은 것부터**.
 *
 * `docs/rules/coding.md` → `['docs/rules', 'docs']`
 * `c:/a/b/out.json`      → `['c:/a/b', 'c:/a', 'c:']`
 *
 * 첫 세그먼트(`docs` · `c:`)까지만 내려간다 — 인덱스 0 의 `/` 는 자르지 않으므로 POSIX 루트
 * `/` 하나만 남는 빈 조상은 만들어지지 않는다.
 */
export function ancestorPaths(p: string | null | undefined): string[] {
  if (!p) return [];
  const out: string[] = [];
  let i = p.lastIndexOf('/');
  while (i > 0) {
    out.push(p.slice(0, i));
    i = p.lastIndexOf('/', i - 1);
  }
  return out;
}

/**
 * 이 위성 파일을 담고 있는 **가장 깊은 폴더 버블의 id**. 못 찾으면 `null`.
 *
 * 노드 키 축을 먼저 다 훑고 절대경로 축으로 넘어간다 — 내부 파일은 첫 축에서 바로 맞고,
 * 외부 파일은 첫 축이 통째로 빗나간 뒤 둘째 축에서 맞는다(두 축이 같은 폴더를 가리키므로
 * 어느 쪽이 먼저 맞든 결과는 같다).
 */
export function resolveSatelliteFolderId(
  file: SatelliteFileRef,
  folders: Iterable<FolderCandidate>,
): string | null {
  const byPath = new Map<string, string>();
  for (const f of folders) {
    if (!FOLDER_BUBBLE_TYPES.has(f.bubbleType)) continue;
    // 먼저 등록된 것을 이긴 것으로 둔다 — 같은 경로에 두 버블이 있으면 어느 쪽을 골라도
    // 같은 자리이고, 덮어쓰면 순회 순서에 따라 답이 흔들린다.
    if (f.path && !byPath.has(f.path)) byPath.set(f.path, f.id);
    if (f.absolutePath && !byPath.has(f.absolutePath)) byPath.set(f.absolutePath, f.id);
  }
  if (byPath.size === 0) return null;

  for (const candidates of [ancestorPaths(file.path), ancestorPaths(file.absolutePath)]) {
    for (const candidate of candidates) {
      const id = byPath.get(candidate);
      if (id !== undefined) return id;
    }
  }
  return null;
}

/**
 * 스토어의 두 슬라이스(`topFolders` + `children`)를 후보 한 줄로 편다.
 *
 * 최상위를 먼저 흘리는 이유는 위 `byPath` 의 "먼저 등록된 것이 이긴다" 규칙과 맞물린다 —
 * 같은 폴더가 양쪽에 있으면 최상위 쪽 id 를 쓰는 편이 `enterFolderDeep` 의 스택 구성과 맞다.
 */
export function* folderCandidates(
  topFolders: readonly BubbleData[],
  children: Readonly<Record<string, BubbleData[]>>,
): Generator<FolderCandidate> {
  for (const f of topFolders) yield f;
  for (const items of Object.values(children)) {
    for (const f of items) yield f;
  }
}
