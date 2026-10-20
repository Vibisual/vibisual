import {
  SESSION_MEMO,
  normalizeMemoLinkText,
  normalizeMemoLinkUrl,
  sanitizeMemoLinkTarget,
  type SessionMemoLink,
  type SessionMemoLinkTarget,
  type WorkspaceEntry,
} from '@vibisual/shared';

/**
 * memoLinks.ts — §5.5 #17-36 ⑫ 메모 링크의 **순수 계산**(React·DOM 없음).
 *
 * 링크는 본문 오프셋(`start`·`end`, UTF-16 — textarea 의 `selectionStart/End` 와 같은 단위)으로 산다.
 * 그래서 이 파일이 지키는 문장은 셋이다.
 *  ① **글을 고치면 링크가 그 편집만큼 따라 움직인다** — 입력 직전 선택 범위로 편집 하나를 찾고, 그 정보가
 *    없으면 공통 앞부분·뒷부분을 견준다(`diffTextEdit`). 링크마다 옮긴다(`shiftLinkRange`). 안에서 치면 늘고, 경계에서 치면
 *    늘지 않으며(이어 친 글이 링크가 되지 않게), 링크 글자를 다 지우면 링크도 사라진다.
 *  ② **링크끼리는 겹치지 않는다** — 새 범위에 걸면 겹친 옛 링크는 걷힌다(`withMemoLink`).
 *  ③ **가리키는 곳은 서버와 같은 자로 다듬는다** — 걸 때 이미 shared 정화(`sanitizeMemoLinkTarget`)를
 *    지나게 해, 서버가 돌려준 정화본과 글자가 같다(낙관 표시의 왕복 비교가 흔들리지 않는다).
 *
 * 화면(`SessionMemoCard`·`SessionMemoLayer`)은 이 함수들만 부르고 자기 산수를 하지 않는다 —
 * "어디까지가 링크인가"는 눈으로 확인하기 어려워 시험(`memoLinks.test.ts`)이 지킨다.
 */

/** 본문 안의 한 토막(시작 포함·끝 제외). */
export interface TextRange {
  start: number;
  end: number;
}

/** 편집 한 번의 모양 — `at` 에서 `removed` 글자가 빠지고 `inserted` 글자가 들어왔다. */
export interface TextEdit {
  at: number;
  removed: number;
  inserted: number;
}

/** 입력 직전 textarea 의 선택 범위. 입력 종류는 빈 선택에서 지운 방향을 구분한다. */
export interface TextEditHint extends TextRange {
  inputType?: string;
}

/** 새 링크 id — 시각(36진) + 난수. 메모 id 와 같은 모양이라 정화(`[\w-]`)를 그대로 지난다. */
export function newMemoLinkId(now: number = Date.now(), rand: () => number = Math.random): string {
  return `ml-${now.toString(36)}-${Math.floor(rand() * 1e6).toString(36)}`;
}

/**
 * 고른 범위를 링크로 걸 수 있게 다듬는다 — 앞뒤 공백을 떼고(더블클릭이 딸려 온 뒤 공백까지 밑줄이
 * 그어지면 어색하다) 본문 안으로 접는다. 남는 글자가 없으면 null.
 */
export function trimLinkRange(text: string, start: number, end: number): TextRange | null {
  let s = Math.max(0, Math.min(text.length, Math.min(start, end)));
  let e = Math.max(0, Math.min(text.length, Math.max(start, end)));
  while (s < e && /\s/.test(text.charAt(s))) s += 1;
  while (e > s && /\s/.test(text.charAt(e - 1))) e -= 1;
  return e > s ? { start: s, end: e } : null;
}

/** 선택 범위 바깥의 글자가 실제로 그대로일 때만 힌트를 쓴다. 낡은 선택은 편집을 덮어쓰지 못한다. */
function hintedTextEdit(before: string, after: string, hint: TextEditHint): TextEdit | null {
  const { start, end, inputType = '' } = hint;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > before.length) return null;
  // IME 는 선택 밖의 조합 글자도 바꾸며, 실행 취소는 현재 선택과 무관한 편집을 되돌린다.
  if (inputType.includes('Composition') || inputType.startsWith('history')) return null;
  let at = start;
  let removed = end - start;
  if (removed === 0 && after.length < before.length) {
    removed = before.length - after.length;
    if (/^delete.*Backward$/.test(inputType)) at -= removed;
    else if (!/^delete.*Forward$/.test(inputType)) return null;
  }
  const inserted = after.length - before.length + removed;
  if (at < 0 || at + removed > before.length || inserted < 0) return null;
  if (before.slice(0, at) !== after.slice(0, at) || before.slice(at + removed) !== after.slice(at + inserted)) return null;
  return { at, removed, inserted };
}

/**
 * 편집 전후 본문에서 **바뀐 한 토막**을 찾는다(같으면 null).
 *
 * 선택 범위가 있으면 먼저 쓴다 — `foo foo` 의 첫 `foo ` 삭제는 문자열 비교만으로 마지막 삭제와
 * 구분할 수 없으며, 잘못 고르면 지운 링크가 남은 낱말로 옮겨 붙는다. 힌트가 없거나 실제 변경과
 * 맞지 않으면 공통 앞부분·뒷부분을 견준다(외부 갱신·IME 조합 등 기존 호출부도 그대로 받는다).
 */
export function diffTextEdit(before: string, after: string, hint?: TextEditHint): TextEdit | null {
  if (before === after) return null;
  const hinted = hint && hintedTextEdit(before, after, hint);
  if (hinted) return hinted;
  const max = Math.min(before.length, after.length);
  let p = 0;
  while (p < max && before.charCodeAt(p) === after.charCodeAt(p)) p += 1;
  let sb = before.length;
  let sa = after.length;
  while (sb > p && sa > p && before.charCodeAt(sb - 1) === after.charCodeAt(sa - 1)) {
    sb -= 1;
    sa -= 1;
  }
  return { at: p, removed: sb - p, inserted: sa - p };
}

/**
 * 범위 하나를 편집 하나만큼 옮긴다. 범위가 사라져야 하면 null.
 *
 *  - 편집이 범위 **앞**이면 통째로 민다 / **뒤**면 그대로.
 *  - 범위의 **경계에 끼운** 글자(순수 삽입)는 범위에 들지 않는다 — 시작 경계면 범위가 밀리고, 끝 경계면
 *    그대로다. 링크 끝에 이어 친 낱말까지 링크가 되면 사용자는 링크를 다시 잘라야 한다.
 *  - 범위 **안**에서 고치면 그만큼 늘고 준다.
 *  - 범위를 **통째로 덮는** 편집(지우기·갈아 치우기)이면 사라진다 — 링크가 붙어 있던 글자가 없어졌다.
 *  - 한쪽 끝에 걸치면 남는 쪽만 남는다.
 */
export function shiftLinkRange(range: TextRange, edit: TextEdit): TextRange | null {
  const { at, removed, inserted } = edit;
  const oldEnd = at + removed;
  const delta = inserted - removed;
  const { start, end } = range;

  if (removed === 0) {
    if (at <= start) return { start: start + delta, end: end + delta };
    if (at >= end) return range;
    return { start, end: end + delta };
  }
  if (oldEnd <= start) return { start: start + delta, end: end + delta };
  if (at >= end) return range;
  // 여기부터는 편집이 범위와 겹친다.
  if (at <= start && oldEnd >= end) return null;
  if (at >= start && oldEnd <= end) {
    const nextEnd = end + delta;
    return nextEnd > start ? { start, end: nextEnd } : null;
  }
  if (at < start) {
    // 앞쪽을 덮었다 — 뒤에 남은 글자[oldEnd, end)가 새 자리[at+inserted, end+delta)로 간다.
    const nextStart = at + inserted;
    const nextEnd = end + delta;
    return nextEnd > nextStart ? { start: nextStart, end: nextEnd } : null;
  }
  // 뒤쪽을 덮었다 — 앞에 남은 글자[start, at)만 남는다.
  return at > start ? { start, end: at } : null;
}

/**
 * 본문이 `before` → `after` 로 바뀌었을 때 링크 목록을 따라 옮긴다.
 * 하나도 안 바뀌면 **같은 배열**을 돌려준다(저장 왕복 비교가 흔들리지 않게).
 */
export function shiftMemoLinks(
  links: readonly SessionMemoLink[],
  before: string,
  after: string,
  hint?: TextEditHint,
): readonly SessionMemoLink[] {
  const edit = diffTextEdit(before, after, hint);
  if (!edit) return links;
  let changed = false;
  const out: SessionMemoLink[] = [];
  for (const link of links) {
    const next = shiftLinkRange(link, edit);
    if (!next || next.end > after.length || next.start < 0) {
      changed = true;
      continue;
    }
    if (next.start === link.start && next.end === link.end) {
      out.push(link);
      continue;
    }
    changed = true;
    out.push({ ...link, start: next.start, end: next.end });
  }
  return changed ? out : links;
}

/**
 * 범위 하나를 본문 편집만큼 옮긴다(고르기 모드가 들고 있는 "걸릴 범위"용 — 링크와 같은 규칙).
 * 그 글자가 지워졌으면 null.
 */
export function shiftTextRange(range: TextRange, before: string, after: string, hint?: TextEditHint): TextRange | null {
  const edit = diffTextEdit(before, after, hint);
  if (!edit) return range;
  const next = shiftLinkRange(range, edit);
  return next && next.end <= after.length ? next : null;
}

/**
 * 링크 상자를 띄울 링크 — 캐럿이 그 안(양 끝 포함)이거나, 고른 범위가 **그 링크 안에 다 들어갈** 때.
 * 링크 밖까지 걸쳐 고른 것은 "이 링크를 본다"가 아니라 글을 다루는 중이다(상자가 뜨면 방해다).
 */
export function linkHoldingRange(
  links: readonly SessionMemoLink[] | undefined,
  start: number,
  end: number,
): SessionMemoLink | undefined {
  if (!links || links.length === 0) return undefined;
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return links.find((l) => l.start <= lo && hi <= l.end);
}

/**
 * 캐럿·고른 범위가 **닿은** 링크. 캐럿(빈 범위)이면 그 자리를 품은 링크(양 끝 포함 — 링크 바로 뒤에
 * 캐럿을 둬도 그 링크다), 범위면 겹치는 첫 링크.
 */
export function linkAtRange(
  links: readonly SessionMemoLink[] | undefined,
  start: number,
  end: number,
): SessionMemoLink | undefined {
  if (!links || links.length === 0) return undefined;
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  if (lo === hi) return links.find((l) => l.start <= lo && lo <= l.end);
  return links.find((l) => l.start < hi && lo < l.end);
}

/**
 * 우클릭 메뉴가 "이 링크"로 다룰 링크 — 캐럿이 그 안이거나, 고른 범위가 그 링크와 **똑같을** 때만.
 * 링크보다 넓게 골랐으면 사용자는 새로 걸려는 것이다(겹친 옛 링크는 걷힌다).
 */
export function linkForMenu(
  links: readonly SessionMemoLink[] | undefined,
  text: string,
  start: number,
  end: number,
): SessionMemoLink | undefined {
  if (start === end) return linkAtRange(links, start, end);
  const range = trimLinkRange(text, start, end);
  if (!range) return undefined;
  return links?.find((l) => l.start === range.start && l.end === range.end);
}

/** 이 범위에 새로 걸면 걷히는 옛 링크가 있나. */
export function rangeOverlapsLinks(links: readonly SessionMemoLink[] | undefined, range: TextRange): boolean {
  return (links ?? []).some((l) => l.start < range.end && range.start < l.end);
}

/** 한 장에 링크를 더 걸 수 있나(§3.2.3 개수 상한). */
export function canAddMemoLink(links: readonly SessionMemoLink[] | undefined, range?: TextRange | null): boolean {
  // 겹친 옛 링크는 걷히므로 그만큼은 자리가 난다.
  const kept = range ? (links ?? []).filter((l) => l.end <= range.start || l.start >= range.end) : (links ?? []);
  return kept.length < SESSION_MEMO.LINK_MAX;
}

function byStart(a: SessionMemoLink, b: SessionMemoLink): number {
  return a.start - b.start || a.end - b.end;
}

/**
 * 범위에 새 링크를 건다. 겹친 옛 링크는 걷고, 결과는 시작 순이다. 상한이면 null(화면은 미리 흐린다).
 */
export function withMemoLink(
  links: readonly SessionMemoLink[] | undefined,
  range: TextRange,
  target: SessionMemoLinkTarget,
  id: string,
): SessionMemoLink[] | null {
  const kept = (links ?? []).filter((l) => l.end <= range.start || l.start >= range.end);
  if (kept.length >= SESSION_MEMO.LINK_MAX) return null;
  return [...kept, { id, start: range.start, end: range.end, target }].sort(byStart);
}

/** 그 링크가 **가리키는 곳만** 바꾼다(범위는 그대로 — 다시 고르기). 없는 링크면 null. */
export function retargetMemoLink(
  links: readonly SessionMemoLink[] | undefined,
  linkId: string,
  target: SessionMemoLinkTarget,
): SessionMemoLink[] | null {
  if (!links || !links.some((l) => l.id === linkId)) return null;
  return links.map((l) => (l.id === linkId ? { ...l, target } : l));
}

/** 링크 해제 — 글자는 그대로 두고 링크만 걷는다. */
export function removeMemoLink(links: readonly SessionMemoLink[] | undefined, linkId: string): SessionMemoLink[] {
  return (links ?? []).filter((l) => l.id !== linkId);
}

// ─── 가리키는 곳 만들기 — 서버 정화와 같은 자로 ───

/**
 * 세션 글 위치. 항목 id 와 그 자리의 글 중 하나는 있어야 한다(없으면 null — 갈 곳이 없다).
 * 글은 드래그로 고른 글자면 `LINK_TEXT_MAX`, 항목 첫머리면 호출부가 `streamHeadText` 로 줄여 넘긴다.
 */
export function streamLinkTarget(
  sessionId: string | null,
  anchorId: string | undefined,
  text: string,
): SessionMemoLinkTarget | null {
  return sanitizeMemoLinkTarget({ kind: 'stream', sessionId, ...(anchorId ? { anchorId } : {}), text });
}

/** 다른 세션(탭) 하나. `label` 은 걸 때의 탭 이름 — 탭이 닫혀도 무엇을 가리켰는지 말하려고 둔다. */
export function sessionLinkTarget(sessionId: string | null, label: string): SessionMemoLinkTarget | null {
  return sanitizeMemoLinkTarget({ kind: 'session', sessionId, label });
}

/** 파일 하나 — 경로 글자 그대로(줄 표기 포함). 빈 값이면 null. */
export function fileLinkTarget(path: string): SessionMemoLinkTarget | null {
  return sanitizeMemoLinkTarget({ kind: 'file', path });
}

/** 웹 주소 — 사용자가 친 글자를 받아 들인다(`parseMemoLinkUrlInput`). 못 받으면 null. */
export function urlLinkTarget(input: string): SessionMemoLinkTarget | null {
  const url = parseMemoLinkUrlInput(input);
  return url ? sanitizeMemoLinkTarget({ kind: 'url', url }) : null;
}

/** 항목을 **눌러** 고른 자리의 글 — 항목 본문은 수천 자일 수 있어 첫머리만 들고 간다. */
export function streamHeadText(raw: string): string {
  return normalizeMemoLinkText(raw, SESSION_MEMO.LINK_HEAD_MAX);
}

// ─── 웹 주소 입력 ───

/** `localhost`·루프백 — 개발 서버라 http 로 연다(https 로 붙이면 거의 언제나 안 열린다). */
const LOCAL_HOST_RE = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d+)?(?:[/?#]|$)/i;
/** `scheme://` 로 시작하나 — 그러면 사용자가 적은 그대로 판정한다(http(s) 가 아니면 거절). */
const SCHEME_SLASHES_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
/** `//` 없이 쓰는 위험한 스킴 — 앞에 https:// 를 붙여 "주소처럼" 만들어 주면 안 된다. */
const BARE_SCHEME_RE = /^(?:javascript|data|vbscript|file|about|blob|mailto):/i;
/** 스킴 없이 적은 주소처럼 보이는가 — 점이 든 호스트(`example.com/x`). */
const HOST_LIKE_RE = /^[\w-]+(?:\.[\w-]+)+(?::\d+)?(?:[/?#]|$)/;

/**
 * 사용자가 웹 주소 칸에 친 글자 → 저장할 주소. 스킴이 없으면 붙여 준다(`example.com` → https,
 * `localhost:5173` → http). 받을 수 없으면 `''` — 정화(`normalizeMemoLinkUrl`)와 같은 자로 잰다.
 */
export function parseMemoLinkUrlInput(raw: string): string {
  const text = raw.trim();
  if (!text) return '';
  if (SCHEME_SLASHES_RE.test(text) || BARE_SCHEME_RE.test(text)) return normalizeMemoLinkUrl(text);
  return normalizeMemoLinkUrl(`${LOCAL_HOST_RE.test(text) ? 'http' : 'https'}://${text}`);
}

/**
 * 고른 글자가 주소처럼 생겼으면 그 글자(웹 주소 칸에 미리 채운다), 아니면 `''`.
 * 문장 한 토막(공백이 든 글)이나 낱말 하나(`README`)를 주소로 넘겨짚지 않는다.
 */
export function urlLikeSelection(text: string): string {
  const t = text.trim();
  if (!t || /\s/.test(t)) return '';
  const looks = /^https?:\/\//i.test(t) || HOST_LIKE_RE.test(t) || LOCAL_HOST_RE.test(t);
  return looks && parseMemoLinkUrlInput(t) ? t : '';
}

// ─── 화면에 보일 글 ───

/** 메뉴 한 줄에 들어갈 내 입력 길이(자) — 메뉴 폭이 글에 끌려 화면을 가로지르지 않게. */
export const PROMPT_LABEL_MAX = 48;

/** 목록에 세울 내 입력 한 줄 — 첫 줄을 공백 접어 상한까지(넘치면 `…`). */
export function promptLinkLabel(text: string, max: number = PROMPT_LABEL_MAX): string {
  const first = text.split('\n').map((line) => line.trim()).find((line) => line.length > 0) ?? '';
  const folded = first.replace(/\s+/g, ' ');
  return folded.length > max ? `${folded.slice(0, max - 1).trimEnd()}…` : folded;
}

/**
 * 링크 상자·메뉴에 보일 **가리키는 곳 한 줄**(종류 이름은 화면이 번역해 붙인다).
 * 다른 세션은 살아 있는 탭 이름이 이기고, 없으면 걸 때의 이름이다.
 */
export function memoLinkTargetText(target: SessionMemoLinkTarget, liveSessionLabel?: string | null): string {
  switch (target.kind) {
    case 'stream': return target.text || target.anchorId || '';
    case 'session': return liveSessionLabel ?? target.label ?? '';
    case 'file': return target.path;
    case 'url': return target.url;
  }
}

// ─── 파일 고르기 목록 ───

/**
 * 파일 고르기 창이 갈래 넷(코드·웹 페이지·그림·PDF)으로 받아 온 목록을 **한 목록**으로 — 경로가 같으면
 * 하나만, 최근 고친 것부터(시각이 같거나 없으면 경로 순 — 받는 순서가 흔들려도 같은 답이 나오게).
 * 갈래를 가르는 것은 ⑱ 의 빈 탭 사정이고, 링크는 무엇이든 가리킬 수 있다.
 */
export function mergeLinkFileEntries(lists: readonly (readonly WorkspaceEntry[])[]): WorkspaceEntry[] {
  const byPath = new Map<string, WorkspaceEntry>();
  for (const list of lists) {
    for (const entry of list) {
      if (entry.isDirectory || byPath.has(entry.relPath)) continue;
      byPath.set(entry.relPath, entry);
    }
  }
  return [...byPath.values()].sort((a, b) => (
    (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0) || (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0)
  ));
}

// ─── 링크 잉크 ───

/** 링크 글자를 칠하는 색 한 벌 — 밑줄·바탕·고른 링크 바탕·고르는 중(점선). */
export interface MemoLinkInk {
  line: string;
  fill: string;
  activeFill: string;
  pending: string;
}

/**
 * 종이 밝기에 맞춘 링크 잉크. 메모 종이는 사용자가 고른 **데이터 색**이라(②) 테마 토큰으로 못 정한다 —
 * 글자색을 정한 것과 같은 판정(`memoSurface` 의 밝은 판 여부)으로 고른다. 밝은 판에 옅은 파랑을 얹으면
 * 밑줄이 녹아 사라지고, 어두운 판에 짙은 파랑을 얹으면 같은 일이 반대로 일어난다.
 */
export function memoLinkInk(lightPaper: boolean): MemoLinkInk {
  return lightPaper
    ? { line: '#0369A1', fill: 'rgba(3, 105, 161, 0.12)', activeFill: 'rgba(3, 105, 161, 0.24)', pending: '#B45309' }
    : { line: '#7DD3FC', fill: 'rgba(125, 211, 252, 0.14)', activeFill: 'rgba(125, 211, 252, 0.28)', pending: '#FCD34D' };
}

// ─── 거울 층 토막 ───

/** 거울 층이 그릴 한 토막 — 링크면 그 id, 고르는 중인 범위면 `pending`. */
export interface MemoLinkSegment {
  text: string;
  linkId?: string;
  pending?: boolean;
}

/**
 * 본문을 거울 층이 그릴 토막으로 자른다. 고르는 중인 범위(`pending`)가 있으면 그와 겹치는 링크는
 * 그리지 않는다 — 곧 그 범위로 바뀔 것이고(다시 고르기면 바로 그 링크다), 두 표시가 겹치면 어디가
 * 걸리는 중인지 읽히지 않는다.
 */
export function memoLinkSegments(
  text: string,
  links: readonly SessionMemoLink[] | undefined,
  pending: TextRange | null,
): MemoLinkSegment[] {
  const marks: { start: number; end: number; linkId?: string; pending?: boolean }[] = [];
  const live = pending && pending.start < pending.end && pending.end <= text.length ? pending : null;
  for (const l of links ?? []) {
    if (l.start >= l.end || l.end > text.length) continue;
    if (live && l.start < live.end && live.start < l.end) continue;
    marks.push({ start: l.start, end: l.end, linkId: l.id });
  }
  if (live) marks.push({ start: live.start, end: live.end, pending: true });
  marks.sort((a, b) => a.start - b.start);
  const out: MemoLinkSegment[] = [];
  let at = 0;
  for (const m of marks) {
    if (m.start < at) continue;
    if (m.start > at) out.push({ text: text.slice(at, m.start) });
    out.push({
      text: text.slice(m.start, m.end),
      ...(m.linkId ? { linkId: m.linkId } : {}),
      ...(m.pending ? { pending: true } : {}),
    });
    at = m.end;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
