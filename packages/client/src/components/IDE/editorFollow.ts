import type { SubAgentStreamEvent } from '@vibisual/shared';
import { parseEditToolInput } from './diffTool.js';

/**
 * editorFollow.ts — §5.5 #17-27 ⑪ [추종] 토글의 순수 로직.
 *
 * 토글이 켜져 있는 동안 편집창은 **에이전트가 방금 고친 파일**을 따라간다. 그 판단에 필요한 계산만
 * 여기 모은다 — 어떤 편집을 따라갈지 고르고(ⓐ), 열 수 있는 파일인지 가리고(ⓑ), 다시 읽은 본문에서
 * **바뀐 줄이 몇 번째인지** 찾는다(ⓒ). 셋 다 화면·fetch 없이 값만 다루므로 단위 테스트로 못 박는다
 * (`editorFollow.test.ts`) — 스크롤이 엉뚱한 줄로 가는 사고는 화면에서 눈으로 잡기 어렵다.
 *
 * fs 감시는 여기에도 없다(#17-27 ⑦ 유지) — 입력은 언제나 **이미 우리에게 오고 있는 편집 신고**
 * (`graphStore.fileEdits`)다.
 */

/** 강조 줄의 상한 — 파일 생성(Write)처럼 통째로 바뀐 편집이 화면 전체를 물들이지 않게 한다. */
export const FOLLOW_FLASH_MAX_LINES = 200;

/** 바뀐 줄 범위(1-based, 양끝 포함). */
export interface EditedLineRange {
  start: number;
  end: number;
}

/** 추종 판정에 필요한 엣지의 최소 모양(React Flow 엣지든 서버 엣지든 이 둘만 본다). */
export interface FollowEdgeLike {
  source: string;
  target: string;
}

/**
 * 이 에이전트가 만진 파일 노드 id 들 — 엣지로 이어졌는가가 곧 관계다(서버가 이미 내린 판단).
 * 편집한 파일 구역(#17-19 ④)과 **같은 규칙**이어야 목록에 뜬 파일과 따라가는 파일이 어긋나지 않는다.
 */
export function agentTouchedFileIds(edges: readonly FollowEdgeLike[], agentId: string): Set<string> {
  const ids = new Set<string>();
  for (const edge of edges) {
    if (edge.source === agentId) ids.add(edge.target);
    if (edge.target === agentId) ids.add(edge.source);
  }
  return ids;
}

/**
 * §5.5 #17-27 ⑪ (g) — 세션키. 추종은 **세션의 것**이라 켜짐도 신호도 이 키로 갈린다.
 * 세션 탭이 없는 전체 보기(`null`)도 자기 칸을 가진다 — 그 화면 역시 따라갈 대상이 있기 때문이다.
 */
export function followSessionKey(agentId: string, sessionId: string | null): string {
  return `${agentId}::${sessionId ?? 'main'}`;
}

/** 한 번에 되짚어 볼 스트림 이벤트 수 — 긴 세션에서 매 갱신마다 전량을 다시 훑지 않기 위한 창. */
export const FOLLOW_SCAN_LIMIT = 400;

/** 완료가 확인된 편집 한 건 — 다시 읽고 따라갈 대상. */
export interface CompletedEdit {
  filePath: string;
  /** 그 편집으로 파일에 들어간 글자(여러 조각이면 마지막 조각 — 커서가 가야 할 곳). */
  newString: string;
  /** **결과가 온 시각** = 신호의 신원. 호출 시각이 아니다(그땐 파일이 아직 안 바뀌었을 수 있다). */
  at: number;
  toolName: string;
}

/** 결과를 기다리는 도구 호출 한 자리 — 편집이 아니면 `edit` 이 `null`(자리는 남는다, FIFO 폴백용). */
interface PendingCall {
  /** 그 호출의 `tool_use_id`(옛 버퍼엔 없을 수 있다). */
  id?: string;
  edit: Omit<CompletedEdit, 'at'> | null;
}

/**
 * §5.5 #17-27 ⑪ (g) — 그 **세션의 스트림**에서 따라갈 편집 하나 고르기.
 *
 * 입력은 diff 카드가 쓰는 바로 그 이벤트다(Edit 계열 네 도구는 서버가 input 을 자르지 않고 통째로 보낸다).
 * 도구 호출(`tool_use`)만 보고 따라가면 **파일이 아직 안 바뀐 시점**일 수 있으므로, 호출을 줄 세워 두고
 * **결과(`tool_result`)가 온 것만** 완료로 친다.
 *
 * 짝짓기는 **`tool_use_id` 가 먼저**다(`SubAgentStreamEvent.toolUseId` 규약). 호출 순서(FIFO)로만 맞추면
 * **결과가 끝내 오지 않는 호출**(중지·거부·창 밖에서 시작된 호출)이 하나만 있어도 그 뒤 전부가 한 칸씩
 * 밀려, 방금 고친 파일 대신 **직전 파일**을 따라가거나 아무 일도 일어나지 않았다(실측: 한 세션에서
 * `tool_use` 31 : `tool_result` 30 · 어긋남 2건 — 그 지점 이후로는 영구히 어긋난다).
 * 짝을 못 찾은 결과는 **큐를 건드리지 않고 그 자리에서 버린다** — 남의 결과에 엉뚱한 파일이 붙지 않는다.
 * id 가 없는 옛 버퍼 이벤트만 종전대로 FIFO 로 맞춘다(서버 재시작 전 버퍼 호환).
 *
 * 돌려주는 것은 **마지막 한 건**뿐이다. 한때 "기준선 이후 몇 건" 도 함께 셌지만, 그 수는 스캔 창
 * (`scanLimit`) 밖으로 밀릴 때마다 저절로 줄어 화면에서 흔들렸다 — 정확할 수 없는 수는 아예 세지 않는다.
 */
export function latestCompletedEdit(
  events: readonly SubAgentStreamEvent[],
  sinceTs: number,
  scanLimit: number = FOLLOW_SCAN_LIMIT,
): CompletedEdit | null {
  const start = Math.max(0, events.length - Math.max(1, scanLimit));
  const pending: PendingCall[] = [];
  let latest: CompletedEdit | null = null;

  for (let i = start; i < events.length; i += 1) {
    const evt = events[i]!;
    if (evt.eventType === 'tool_use') {
      const parsed = evt.toolName ? parseEditToolInput(evt.toolName, evt.content) : null;
      const lastHunk = parsed?.hunks[parsed.hunks.length - 1];
      pending.push({
        id: evt.toolUseId,
        edit: parsed && lastHunk
          ? { filePath: parsed.filePath, newString: lastHunk.newText, toolName: parsed.toolName }
          : null,
      });
      continue;
    }
    if (evt.eventType !== 'tool_result') continue;

    let done: PendingCall | undefined;
    if (evt.toolUseId) {
      const at = pending.findIndex((p) => p.id === evt.toolUseId);
      // 짝이 없으면 창 밖에서 시작된 호출의 결과다 — 큐를 밀지 않고 버린다.
      if (at < 0) continue;
      done = pending.splice(at, 1)[0];
    } else {
      done = pending.shift();
    }
    if (!done?.edit) continue;
    // 기준선보다 옛 편집은 따라가지 않는다(토글을 켠 순간 과거로 거슬러 올라가지 ❌ — #17-27 ⑪ (e)).
    if (evt.timestamp <= sinceTs) continue;
    latest = { ...done.edit, at: evt.timestamp };
  }
  return latest;
}

/** 지금 스트림의 가장 최근 시각 — 토글을 켠 시점의 기준선. */
export function newestEventTimestamp(events: readonly SubAgentStreamEvent[]): number {
  let newest = 0;
  for (const evt of events) {
    if (evt.timestamp > newest) newest = evt.timestamp;
  }
  return newest;
}

/**
 * 편집창이 열 수 있는 경로인가 — **루트 기준 상대 경로**여야 한다.
 *
 * `toRelativeFromRoot` 는 루트 밖 파일을 **절대 경로 그대로** 돌려주고, `GET /api/workspace-file` 은
 * 그런 경로를 403 으로 막는다(#17-27 ⑥). 열지 못할 파일을 탭으로 만들면 빈 오류 탭만 쌓이므로
 * 추종 대상에서 미리 뺀다(사용자가 직접 누르는 길은 종전 그대로 — 이 가드는 자동 열기에만 쓴다).
 */
export function isFollowableRelPath(relPath: string): boolean {
  if (!relPath) return false;
  const p = relPath.replace(/\\/g, '/');
  if (p.startsWith('/')) return false;        // POSIX 절대경로 · UNC
  if (/^[a-zA-Z]:/.test(p)) return false;     // 윈도우 드라이브 문자
  if (p.split('/').includes('..')) return false;
  return true;
}

/**
 * §5.5 #17-27 ⑪ (h) — **따라가지 않은 이유**. 조용히 넘어가면 사용자에게 "고장" 과 "따라갈 것이 없음" 이
 * 같은 그림이 된다(추종 띠·상태바 칩이 이 값을 그대로 말한다).
 *
 * - `outside-root`  루트 밖 파일 — `GET /api/workspace-file` 이 막으므로 열면 빈 오류 탭만 남는다.
 * - `editor-closed` 폰 폭에서 편집창이 아직 닫혀 있음 — 대화를 갑자기 덮지 않는다.
 * - `dirty`         고치던 초안이 있어 자동 다시 읽기를 건너뜀 — 사용자가 친 글자를 절대 덮지 않는다.
 * - `no-line`       바뀐 줄을 본문에서 못 찾아 **열기만** 함 — 엉뚱한 줄로 끌고 가지 않는다.
 */
export type FollowSkipReason = 'outside-root' | 'editor-closed' | 'dirty' | 'no-line';

/**
 * 사유 → i18n 키. 상태바 칩과 편집창 추종 띠가 **같은 표**를 읽어야 두 자리가 다른 말을 하지 않는다.
 * 모든 문구는 `{{name}}`(파일 이름) 하나만 받는다.
 */
export const FOLLOW_SKIP_KEYS: Record<FollowSkipReason, string> = {
  'outside-root': 'ide.follow.skipOutsideRoot',
  'editor-closed': 'ide.follow.skipEditorClosed',
  dirty: 'ide.follow.skipDirty',
  'no-line': 'ide.follow.skipNoLine',
};

/**
 * 같은 사유의 **한 마디 판**. 떴다 사라지는 알림은 읽는 시간이 2초뿐이라 문장을 넣을 자리가 없다 —
 * 파일 이름 옆에 붙는 꼬리표 하나로 줄인다(`{{name}}` 을 받지 않는다). 긴 문장은 편집창 띠가 맡는다.
 */
export const FOLLOW_SKIP_SHORT_KEYS: Record<FollowSkipReason, string> = {
  'outside-root': 'ide.follow.skipShortOutsideRoot',
  'editor-closed': 'ide.follow.skipShortEditorClosed',
  dirty: 'ide.follow.skipShortDirty',
  'no-line': 'ide.follow.skipShortNoLine',
};

/**
 * 여는 쪽(`useEditorFollow`)이 내리는 두 가지 판정을 한 값으로 — 어느 쪽도 "그냥 아무 일도 안 함" 이
 * 되지 않게 한다. 나머지 둘(`dirty`·`no-line`)은 본문을 읽어 봐야 알므로 편집창이 낸다.
 */
export function followOpenSkipReason(
  relPath: string,
  narrow: boolean,
  editorOpen: boolean,
): FollowSkipReason | null {
  if (!isFollowableRelPath(relPath)) return 'outside-root';
  if (narrow && !editorOpen) return 'editor-closed';
  return null;
}

/** 줄바꿈을 한 가지로 — 디스크는 CRLF, 편집 신고는 LF 인 경우가 흔해 그대로 비교하면 못 찾는다. */
function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

/** 앞뒤 빈 줄을 뺀 **내용 있는 첫 줄** — 통째 검색이 빗나갔을 때의 두 번째 시도. */
function firstMeaningfulLine(text: string): string | null {
  for (const line of text.split('\n')) {
    if (line.trim().length > 0) return line;
  }
  return null;
}

/** 문자열의 어느 위치가 몇 번째 줄인가(1-based). */
function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

/**
 * 다시 읽은 본문에서 **방금 들어간 글자**가 놓인 줄 범위를 찾는다.
 *
 * 1) 새 본문 통째로 찾아본다(Edit 도구의 `newString` 은 파일에 그대로 들어가므로 대개 여기서 맞는다).
 * 2) 못 찾으면 **내용 있는 첫 줄**로 다시 찾는다(그 사이 다른 편집이 뒤쪽을 또 고친 경우).
 * 3) 그래도 못 찾으면 `null` — 열기만 하고 **스크롤·강조는 하지 않는다**(엉뚱한 줄로 끌고 가지 않는다).
 *
 * 파일 생성(Write)처럼 본문 전체가 새 글자인 경우가 있으므로 강조 폭은 `maxSpan` 으로 자른다
 * (스크롤 목적지는 언제나 범위의 첫 줄이라 잘라도 "어디부터 바뀌었나"는 그대로 보인다).
 */
export function findEditedLineRange(
  text: string,
  newString: string,
  maxSpan: number = FOLLOW_FLASH_MAX_LINES,
): EditedLineRange | null {
  const haystack = normalizeEol(text);
  const needle = normalizeEol(newString);
  if (!haystack || !needle.trim()) return null;

  let index = haystack.indexOf(needle);
  let matched = needle;
  if (index < 0) {
    const head = firstMeaningfulLine(needle);
    if (!head) return null;
    index = haystack.indexOf(head);
    matched = head;
    if (index < 0) return null;
  }

  const start = lineAt(haystack, index);
  const span = matched.replace(/\n+$/, '').split('\n').length;
  const end = start + Math.max(0, Math.min(span, Math.max(1, maxSpan)) - 1);
  return { start, end };
}
