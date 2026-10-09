/**
 * paneOpenerModel.ts — §5.5 #17-27 ⑱ 빈 탭(파일 고르기)과 [우측 판] 목록의 **순수 계산**.
 *
 * 화면(JSX)과 통신을 뺀 것만 모은다 — 이름으로 좁히기 · 머리에 적을 확장자 · 목록의 실행 줄 · "방금 연
 * 빈 탭만 초점" 요청. 눈으로 확인하기 어려운 순서·경계를 단위 시험으로 못 박는다(`paneOpenerModel.test.ts`).
 */
import {
  WORKSPACE_HTML_EXTENSIONS,
  WORKSPACE_IMAGE_EXTENSIONS,
  WORKSPACE_PDF_EXTENSIONS,
  editorPaneKindOf,
} from '@vibisual/shared';
import type { EditorPaneFileKind, WorkspaceEntry, WorkspaceFindResult, WorkspaceOpenAppClaim } from '@vibisual/shared';
import type { RunSession } from '../../stores/runSessions.js';

/**
 * 한 번에 그리는 줄 상한. 나머지는 "N개 더 — 이름으로 좁히라" 한 줄로 접는다 — 고르기는 곁눈 자리라
 * 가상화를 들이지 않는다(탐색기 `WORKSPACE_DIR_ENTRY_MAX` 와 같은 판단).
 */
export const OPENER_RENDER_MAX = 200;

/**
 * 이름으로 좁힌다 — 공백으로 가른 낱말이 **전부** 상대 경로에 들어 있어야 남는다. 대소문자는 접는다:
 * 이것은 찾기 표시용 비교이지 경로를 **식별**하는 비교가 아니다(멀티플랫폼 1축은 키·동일성 비교 규칙이다).
 *
 * 차례: 낱말이 전부 **파일 이름**에 든 것이 앞, 폴더 이름에만 걸린 것이 뒤. 각 묶음 안은 받은 차례
 * 그대로다(= 서버가 세운 최근 고친 순).
 */
export function filterOpenerEntries(entries: readonly WorkspaceEntry[], query: string): WorkspaceEntry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [...entries];
  const byName: WorkspaceEntry[] = [];
  const byPath: WorkspaceEntry[] = [];
  for (const entry of entries) {
    const rel = entry.relPath.toLowerCase();
    if (!words.every((w) => rel.includes(w))) continue;
    const name = entry.name.toLowerCase();
    (words.every((w) => name.includes(w)) ? byName : byPath).push(entry);
  }
  return [...byName, ...byPath];
}

/**
 * 빈 탭 머리에 적는 확장자 — 그 갈래로 **실제로 그려지는** 것만(판정 한 벌 `editorPaneKindOf` 로 거른다:
 * 그래서 `.svg` 는 그림 목록에 서지 않는다). 코드 갈래는 빈 배열 — 모르는 확장자가 전부 코드라 끝이 없다.
 */
export function openerExtensionsOf(
  kind: EditorPaneFileKind,
  apps?: readonly WorkspaceOpenAppClaim[],
): string[] {
  const pool = kind === 'html' ? WORKSPACE_HTML_EXTENSIONS
    : kind === 'image' ? WORKSPACE_IMAGE_EXTENSIONS
      : kind === 'pdf' ? WORKSPACE_PDF_EXTENSIONS
        : [];
  return pool.filter((ext) => editorPaneKindOf(`file${ext}`, apps) === kind);
}

/** 이 버블이 띄운 실행 — 최근 시작한 것부터(목록의 실행 출력 줄). 판은 그 버블의 실행만 비춘다. */
export function agentRunsNewestFirst(
  sessions: Readonly<Record<string, RunSession>>,
  agentId: string | null,
): RunSession[] {
  if (!agentId) return [];
  return Object.values(sessions)
    .filter((run) => run.agentId === agentId)
    .sort((a, b) => b.startedAt - a.startedAt);
}

// ─── 방금 받은 목록 — 먼저 보여 주고 뒤에서 새로 받는다 ───────────────────────
//
// 빈 탭은 다른 탭과 오갈 때마다 다시 선다(본문 자리를 파일 탭과 나눠 쓰므로). 그때마다 빈 화면에서 다시
// 걸으면 큰 저장소에서는 목록이 매번 사라졌다 나타난다. 그렇다고 받아 둔 것만 보여 주면 **에이전트가 방금
// 만든 파일**(이 고르기의 가장 흔한 쓰임새)이 목록에 없다. 그래서 받아 둔 것을 즉시 그리고, 같은 조회를
// 뒤에서 다시 해 갈아 끼운다 — 둘 중 하나를 고르지 않는다. 열쇠는 조회 주소 그대로다(루트·갈래·앱 선언).

/** 기억해 두는 조회 수 — 창·갈래가 늘어도 이 이상 쌓지 않는다(오래 안 쓴 것부터 버린다). */
export const OPENER_FIND_CACHE_MAX = 8;

const findCache = new Map<string, WorkspaceFindResult>();

/** 그 조회로 마지막에 받은 목록(없으면 null). 꺼내면 가장 최근에 쓴 것이 된다. */
export function cachedFindResult(url: string): WorkspaceFindResult | null {
  const hit = findCache.get(url);
  if (!hit) return null;
  findCache.delete(url);
  findCache.set(url, hit);
  return hit;
}

/** 받은 목록을 기억한다. 상한을 넘으면 가장 오래 안 쓴 조회부터 버린다. */
export function rememberFindResult(url: string, result: WorkspaceFindResult): void {
  findCache.delete(url);
  findCache.set(url, result);
  while (findCache.size > OPENER_FIND_CACHE_MAX) {
    const oldest = findCache.keys().next().value;
    if (oldest === undefined) break;
    findCache.delete(oldest);
  }
}

// ─── "방금 연 빈 탭만 초점을 가져간다" ─────────────────────────────────────────
//
// 빈 탭은 세션을 오갈 때도 다시 선다(⑯ 의 세션별 접기). 그때마다 검색 칸이 초점을 가져가면, 입력창에서
// 치던 글자가 세션 전환 단축키 한 번에 검색 칸으로 새어 들어간다. 그래서 초점은 **사용자가 방금 그 빈
// 탭을 연 경우에만** 간다 — 여는 손잡이가 요청을 남기고, 빈 탭이 그 요청을 한 번만 가져간다.
// 요청은 잠깐만 산다(받을 탭이 끝내 서지 않으면 나중에 엉뚱한 때 초점을 뺏지 않게).

/** 초점 요청이 사는 시간(ms). */
export const OPENER_FOCUS_WINDOW_MS = 2_000;

type OpenerFocusListener = () => void;

let pendingFocus: { token: string; at: number } | null = null;
const focusListeners = new Set<OpenerFocusListener>();

function focusToken(paneKey: string | null, openerKey: string): string {
  return `${paneKey ?? ''}|${openerKey}`;
}

/** 여는 손잡이가 부른다 — 그 창의 그 빈 탭이 검색 칸에 초점을 가져가게. 이미 떠 있는 빈 탭에도 알린다. */
export function requestOpenerFocus(paneKey: string | null, openerKey: string, now: number = Date.now()): void {
  pendingFocus = { token: focusToken(paneKey, openerKey), at: now };
  for (const listener of focusListeners) listener();
}

/** 빈 탭이 부른다 — 자기 몫의 요청이 살아 있으면 **한 번만** 참(가져가면 사라진다). */
export function takeOpenerFocus(paneKey: string | null, openerKey: string, now: number = Date.now()): boolean {
  const pending = pendingFocus;
  if (!pending || pending.token !== focusToken(paneKey, openerKey)) return false;
  pendingFocus = null;
  return now - pending.at <= OPENER_FOCUS_WINDOW_MS;
}

/** 이미 떠 있는 빈 탭이 요청을 듣는다. 돌려준 함수로 해제한다(`useEffect` 정리 함수에 그대로 쓴다). */
export function subscribeOpenerFocus(listener: OpenerFocusListener): () => void {
  focusListeners.add(listener);
  return () => { focusListeners.delete(listener); };
}
