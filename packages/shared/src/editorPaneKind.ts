/**
 * editorPaneKind.ts — §5.5 #17-27 ⑱ 우측 판이 **무엇으로** 그리는가, 그리고 판 쪽에서 파일을 찾는 규약.
 *
 * 우측 판(`IDEEditorPane`)은 파일 하나를 넷 중 하나로 그린다 — 코드(⑤) · 웹 페이지(⑮) · 그림(⑭) ·
 * PDF(§5.13 (R)). 탭 줄의 [우측 판] 목록과 빈 탭의 파일 고르기는 "이 갈래로 그릴 수 있는 파일"을
 * 골라야 하므로 그 판정이 필요하다. 판정을 화면과 서버가 **각자** 들면 같은 파일이 목록에는 웹
 * 페이지로 서고 열면 코드로 뜨는 어긋남이 생긴다 — 그래서 여기 **한 벌**만 둔다.
 *
 * 판정은 새로 짓지 않고 §5.13 (R-1) `resolveWorkspaceOpen`(클릭 지점 전부의 갈림길) 위에 선다.
 * 그 함수가 "편집창으로 간다"고 한 것만 판에 오고, 그중 무엇으로 그릴지는 판이 실제로 쓰는 규칙
 * 그대로다(HTML = 페이지 · 그 밖 텍스트 = 코드 · `.svg` 는 텍스트라 코드).
 */

import {
  resolveWorkspaceOpen,
  workspaceFileExt,
  type WorkspaceOpenAppClaim,
} from './constants.js';
import type { EditorPaneFileKind } from './types.js';
import { isWorkspaceHtmlPath } from './workspaceSite.js';

/** 목록에 서는 차례 — [우측 판] 목록 · 빈 탭 라벨 · 시험이 같은 표를 본다. */
export const EDITOR_PANE_FILE_KINDS: readonly EditorPaneFileKind[] = ['code', 'html', 'image', 'pdf'];

/** 바깥(질의 문자열 · 창 사이 짐)에서 온 값이 우리 갈래인가. */
export function isEditorPaneFileKind(value: unknown): value is EditorPaneFileKind {
  return typeof value === 'string' && (EDITOR_PANE_FILE_KINDS as readonly string[]).includes(value);
}

/**
 * 이 파일을 우측 판이 **무엇으로** 그리는가. 판에 오지 않는 파일(앱 · 변환 · 연결 프로그램 · 실행 ·
 * 폴더)이면 `null`.
 *
 * @param apps 앱이 받겠다고 선언한 확장자(§5.13 (R-1) — 코어는 대응표를 들지 않는다). 화면은 등록표를,
 *             서버는 화면이 실어 보낸 것을 넘긴다.
 */
export function editorPaneKindOf(
  relPath: string,
  apps?: readonly WorkspaceOpenAppClaim[],
): EditorPaneFileKind | null {
  const plan = resolveWorkspaceOpen({ relPath, kind: 'file', ...(apps ? { apps } : {}) });
  if (plan.action === 'pdf') return 'pdf';
  if (plan.action === 'image') return 'image';
  if (plan.action !== 'editor') return null;
  return isWorkspaceHtmlPath(relPath) ? 'html' : 'code';
}

/**
 * 코드 갈래 **목록에서만** 빼는 확장자 — 컴파일 산출물이라 열면 이진 안내 한 줄뿐인 것들.
 *
 * 판정(`editorPaneKindOf`)에서 빼지 않는 이유: 탐색기에서 `.dll` 을 누르면 지금도 편집창으로 간다
 * (§5.13 (R-1) — 모르는 것을 바깥으로 던지지 않는다). 그 길은 그대로 두고, "열 파일을 고르는" 목록이
 * 빌드 산출물로 덮이지 않게만 한다(최근 고친 순이라 빌드 한 번에 목록 머리가 통째로 그것들이 된다).
 */
export const EDITOR_PANE_CODE_SKIP_EXTENSIONS: readonly string[] = [
  '.exe', '.dll', '.so', '.dylib', '.o', '.a', '.lib', '.exp', '.ilk', '.pch', '.gch', '.idb', '.res', '.suo',
  '.class', '.pyc', '.pyo', '.pyd', '.wasm', '.node', '.bin', '.dat', '.pak', '.sym',
];

/** 이 파일을 그 갈래의 **고르기 목록**에 세울 것인가 — 판정 + 코드 갈래의 산출물 빼기. */
export function isEditorPaneListable(
  relPath: string,
  kind: EditorPaneFileKind,
  apps?: readonly WorkspaceOpenAppClaim[],
): boolean {
  if (editorPaneKindOf(relPath, apps) !== kind) return false;
  return kind !== 'code' || !EDITOR_PANE_CODE_SKIP_EXTENSIONS.includes(workspaceFileExt(relPath));
}

// ─── 판 쪽에서 파일을 찾는 창구 (`GET /api/workspace-find`) ─────────────────────

/** 조회 창구 경로 — 화면의 URL 조립과 서버 라우트가 같은 값을 본다. */
export const WORKSPACE_FIND_PATH = '/api/workspace-find';

/**
 * 찾기가 **들어가지 않는** 폴더(이름 한 칸 그대로 견준다).
 *
 * 탐색기·도구 쪽 목록(`ProjectGraph.IGNORED_DIRS` · 로컬 도구 `SKIP_DIRS`)과 **일부러 다르다** —
 * 그쪽은 `dist`·`build`·`out` 을 건너뛰는데, 웹 페이지·PDF 결과물이 놓이는 곳이 바로 거기다.
 * 여기는 버전 관리 · 의존성 · 우리 저장소 · 엔진/언어 캐시처럼 **사람이 열어 볼 결과물이 없는** 곳만 든다.
 */
export const WORKSPACE_FIND_SKIP_DIRS: readonly string[] = [
  '.git', '.hg', '.svn', 'node_modules', '.pnpm-store', '.vibisual',
  '__pycache__', '.venv', 'venv', '.gradle', '.turbo',
  // 언리얼 — 수십만 개의 중간 산출물이 쌓이는 자리(결과물·보고서는 `Saved/` 에 남는다).
  'Intermediate', 'DerivedDataCache',
];

/** 한 번 찾을 때 훑는 항목(파일 + 폴더) 상한 — 넘으면 멈추고 `truncated` 로 알린다. */
export const WORKSPACE_FIND_SCAN_MAX = 40_000;

/** 한 번 찾을 때 쓰는 시간 상한(ms) — 느린 디스크·네트워크 드라이브에서도 판이 기다리지 않게. */
export const WORKSPACE_FIND_TIME_BUDGET_MS = 1_500;

/**
 * 돌려주는 파일 수 상한. 화면은 이 안에서 이름으로 좁히므로(글자마다 다시 걷지 않는다) 넉넉히 둔다.
 * 고른 것이 이보다 많으면 **최근 고친 것부터** 남긴다.
 */
export const WORKSPACE_FIND_RESULT_MAX = 1_000;

/** 동시에 읽는 폴더 수 — 너비 우선으로 한 겹씩 내려가되, 폴더 하나씩 기다리지는 않는다. */
export const WORKSPACE_FIND_DIR_CONCURRENCY = 8;

/** 질의 한 칸에 싣는 앱 선언 확장자 상한 — 바깥에서 온 값이라 끝을 정해 둔다. */
const CLAIMED_EXT_MAX = 400;

/** 확장자 한 칸의 모양(소문자 · 마침표 포함 · 짧게). */
const CLAIMED_EXT_RE = /^\.[a-z0-9_+-]{1,16}$/;

/**
 * 앱 선언을 질의 한 칸으로 접는다(`.mp4,.webm,…`). 어느 앱인지는 실어 보내지 않는다 — 판정이 묻는 것은
 * "누군가 받겠다고 했나" 하나뿐이다(받은 확장자는 판에 오지 않는다).
 */
export function serializeClaimedExtensions(apps: readonly WorkspaceOpenAppClaim[]): string {
  const seen = new Set<string>();
  for (const app of apps) {
    for (const ext of app.opens) {
      const e = ext.toLowerCase();
      if (CLAIMED_EXT_RE.test(e)) seen.add(e);
    }
  }
  return [...seen].sort().join(',');
}

/** 질의 한 칸 → 판정이 받는 앱 선언 모양. 모양이 틀린 조각은 버린다(통째로 거절하지 않는다). */
export function parseClaimedExtensions(raw: unknown): WorkspaceOpenAppClaim[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  const opens: string[] = [];
  for (const piece of raw.split(',')) {
    const e = piece.trim().toLowerCase();
    if (!CLAIMED_EXT_RE.test(e) || opens.includes(e)) continue;
    opens.push(e);
    if (opens.length >= CLAIMED_EXT_MAX) break;
  }
  return opens.length > 0 ? [{ appId: 'claimed', opens }] : [];
}

/** 화면이 부르는 조회 주소 — 서버 라우트와 같은 파일에서 조립한다(한쪽만 고치면 조용히 400 이 된다). */
export function workspaceFindUrl(
  root: string,
  kind: EditorPaneFileKind,
  apps: readonly WorkspaceOpenAppClaim[],
): string {
  const params = new URLSearchParams({ root, kind });
  const claimed = serializeClaimedExtensions(apps);
  if (claimed) params.set('claimed', claimed);
  return `${WORKSPACE_FIND_PATH}?${params.toString()}`;
}
