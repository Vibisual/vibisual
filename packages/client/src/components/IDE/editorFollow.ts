import type { SubAgentStreamEvent } from '@vibisual/shared';
import { parseEditToolInput } from './diffTool.js';

/** §5.5 #17-27 ⑪ [추종] — 따라갈 편집 고르기 · 열 수 있는지 · 바뀐 줄 찾기(순수, 엉뚱한 줄은 눈으로 못 잡는다). fs 감시 ❌(#17-27 ⑦) — 입력은 `graphStore.fileEdits`. */

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

/** 만진 파일 노드 id — 엣지가 곧 관계(서버 판단). 편집한 파일 구역(#17-19 ④)과 같은 규칙이어야 목록과 추종이 어긋나지 않는다. */
export function agentTouchedFileIds(edges: readonly FollowEdgeLike[], agentId: string): Set<string> {
  const ids = new Set<string>();
  for (const edge of edges) {
    if (edge.source === agentId) ids.add(edge.target);
    if (edge.target === agentId) ids.add(edge.source);
  }
  return ids;
}

/** §5.5 #17-27 ⑪ (g) — 추종은 세션의 것이라 켜짐·신호가 이 키로 갈린다. 세션 탭 없는 전체 보기(`null`)도 자기 칸을 갖는다. */
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
 * §5.5 #17-27 ⑪ (g) — 세션 스트림에서 따라갈 편집 하나. `tool_result` 가 온 것만 완료로 친다(`tool_use` 시점엔 파일이 아직 안 바뀌었다).
 * 짝짓기는 `tool_use_id` 가 먼저 — FIFO 면 결과가 끝내 안 오는 호출 하나에 뒤가 다 밀린다(실측: 한 세션 31 : 30 · 어긋남 2건). 짝 없는 결과는 큐를 안 건드리고 버린다.
 * id 없는 옛 버퍼만 FIFO. 마지막 한 건만 돌려준다(건수는 스캔 창 밖으로 밀리며 흔들린다).
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

/** 루트 기준 상대 경로만 — 루트 밖은 `GET /api/workspace-file` 이 403(#17-27 ⑥)이라 빈 오류 탭만 쌓인다. 자동 열기 전용 가드. */
export function isFollowableRelPath(relPath: string): boolean {
  if (!relPath) return false;
  const p = relPath.replace(/\\/g, '/');
  if (p.startsWith('/')) return false;        // POSIX 절대경로 · UNC
  if (/^[a-zA-Z]:/.test(p)) return false;     // 윈도우 드라이브 문자
  if (p.split('/').includes('..')) return false;
  return true;
}

/**
 * §5.5 #17-27 ⑪ (h) — 따라가지 않은 이유(띠·칩이 말한다 — 조용하면 고장과 구분이 안 된다).
 * `outside-root` 열면 빈 오류 탭 · `editor-closed` 폰 폭에서 대화를 갑자기 덮지 않는다 · `dirty` 친 글자를 덮지 않는다 · `no-line` 엉뚱한 줄로 끌고 가지 않는다.
 */
export type FollowSkipReason = 'outside-root' | 'editor-closed' | 'dirty' | 'no-line';

/** 사유 → i18n 키. 상태바 칩과 추종 띠가 같은 표를 읽는다(두 자리가 다른 말을 하지 않게). 문구는 `{{name}}` 하나만 받는다. */
export const FOLLOW_SKIP_KEYS: Record<FollowSkipReason, string> = {
  'outside-root': 'ide.follow.skipOutsideRoot',
  'editor-closed': 'ide.follow.skipEditorClosed',
  dirty: 'ide.follow.skipDirty',
  'no-line': 'ide.follow.skipNoLine',
};

/** 한 마디 판 — 2초 알림엔 문장이 안 들어가 파일 이름 옆 꼬리표로(`{{name}}` 없음). 긴 문장은 편집창 띠가. */
export const FOLLOW_SKIP_SHORT_KEYS: Record<FollowSkipReason, string> = {
  'outside-root': 'ide.follow.skipShortOutsideRoot',
  'editor-closed': 'ide.follow.skipShortEditorClosed',
  dirty: 'ide.follow.skipShortDirty',
  'no-line': 'ide.follow.skipShortNoLine',
};

/** 여는 쪽(`useEditorFollow`)의 두 판정 — "아무 일도 안 함"이 되지 않게. `dirty`·`no-line` 은 본문을 읽어야 알아 편집창이 낸다. */
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

/** 방금 들어간 글자의 줄 범위: `newString` 통째 → 내용 있는 첫 줄 → 없으면 `null`(열기만, 스크롤·강조 ❌). 강조 폭은 `maxSpan` 으로 자른다(Write 전체 교체 대비). */
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
