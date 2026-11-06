/**
 * §5.25 (O) — 세션이 대화에 내건 파일: 엔진의 그림 보기(`imagePath` 줄)와 AI 본문의 로컬 링크·그림.
 * 링크는 한 줄을 넘지 않아 줄 단위로 읽는다. 코드 블록·인라인 코드 속 링크는 예시라 세지 않는다.
 * 서버 버블·IDE 그림 카드·IDE 세션 지도가 같은 답을 내도록 판정은 여기 한 벌이다.
 */
import { isPreviewBundleFile } from './kindBundle.js';
import { pathKey, type PlatformName } from './pathCase.js';

/** 마크다운 링크·그림. 꺾쇠 목적지는 공백을, 맨 목적지는 짝 맞는 괄호를 허용한다. */
const LINK_RE = /!?\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|((?:[^\s()]|\([^()]*\))+))(?:\s+"[^"\n]*")?\s*\)/g;

/** 로컬 절대 목적지 — `file:///`·드라이브 경로·POSIX 뿌리. `//` 로 시작하면 네트워크 주소다. */
const ABSOLUTE_DEST_RE = /^(?:file:\/\/\/|[A-Za-z]:[\\/]|\/(?!\/))/i;

/** 상대 경로가 아닌 목적지 — 주소(`scheme:`)·문서 안 앵커·홈·변수. */
const NOT_RELATIVE_RE = /^(?:[A-Za-z][A-Za-z0-9+.-]*:|#|~|\$)/;

/** 줄 머리의 코드 펜스(앞 공백 3칸까지, 백틱·물결 3개 이상). */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

const INLINE_CODE_RE = /`[^`\n]*`/g;

/** 동시에 들고 있는 세션 수 — 세션이 사라져도 `forget` 이 안 불릴 수 있어 오래된 것부터 놓는다. */
export const PRESENTED_SESSIONS_MAX = 256;

/** 한 턴에 기억하는 파일 수. 넘으면 오래된 것부터 잊는다(다시 세도 그래프가 같은 턴의 것을 거른다). */
export const PRESENTED_SEEN_MAX = 512;

/** 줄바꿈 없이 이어지는 조각의 상한 — 링크 목적지는 이보다 훨씬 짧다. */
export const PRESENTED_LINE_MAX = 8_192;

/** 본문 링크 하나의 목적지. `relative` 면 그 세션 폴더 기준으로 풀어야 한다. */
export interface LinkTarget {
  readonly path: string;
  readonly relative: boolean;
}

/** 수확기가 읽는 스트림 이벤트의 칸. */
export interface PresentedEventLike {
  readonly subAgentId: string;
  readonly eventType: string;
  readonly content: string;
  readonly imagePath?: string | undefined;
  readonly turnId?: string | undefined;
  readonly nestedUnderToolUseId?: string | undefined;
}

/**
 * `file:///` 주소 → 경로. 윈도우만 `/C:/…` 의 앞 슬래시를 뗀다(posix 는 그 슬래시가 뿌리다). 퍼센트 인코딩은 푼다.
 * 주소가 아니면 그대로 돌려준다 — 표기가 바뀌어도 조용히 빈 값이 되지 않게.
 */
export function fileUrlToPath(raw: string, platform: PlatformName): string {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v) return '';
  if (!/^file:\/\//i.test(v)) return v;
  let body = v.slice('file://'.length);
  try {
    body = decodeURIComponent(body);
  } catch {
    // 잘못 인코딩된 값은 그대로 둔다(여는 쪽이 없다고 답하는 편이 낫다).
  }
  if (platform === 'win32' && /^\/[A-Za-z]:/.test(body)) body = body.slice(1);
  return body;
}

/** 상대 목적지 → 경로 조각. 문서 안 앵커는 떼고, 링크 문법이 요구하는 퍼센트 인코딩은 푼다. */
function relativeDest(raw: string): string {
  let p = raw.split('#', 1)[0] ?? '';
  if (/%[0-9A-Fa-f]{2}/.test(p)) {
    try {
      p = decodeURIComponent(p);
    } catch {
      // 풀 수 없는 인코딩은 원문 그대로 — 그 이름의 파일이 있으면 그대로 맞는다.
    }
  }
  return p.trim();
}

/** 코드가 걷힌 글에서 링크 목적지를 뽑는다. */
function linkTargetsIn(prose: string, platform: PlatformName, out: LinkTarget[]): void {
  if (!prose.includes('](')) return;
  for (const m of prose.matchAll(LINK_RE)) {
    const raw = (m[1] ?? m[2] ?? '').trim();
    if (!raw) continue;
    if (ABSOLUTE_DEST_RE.test(raw)) {
      const path = fileUrlToPath(raw, platform);
      if (path && !path.includes('\0')) out.push({ path, relative: false });
      continue;
    }
    if (raw.startsWith('//') || NOT_RELATIVE_RE.test(raw)) continue;
    const path = relativeDest(raw);
    if (path && !path.includes('\0')) out.push({ path, relative: true });
  }
}

/** 줄 단위 스캐너 — 열린 코드 펜스와 아직 줄바꿈을 못 만난 조각. */
interface LinkScan {
  fence: string | null;
  partial: string;
}

function closesFence(marker: string, line: string): boolean {
  const ch = marker[0] === '`' ? '`' : '~';
  return new RegExp(`^ {0,3}${ch}{${String(marker.length)},}[ \\t]*$`).test(line);
}

function feedLine(scan: LinkScan, rawLine: string, platform: PlatformName, out: LinkTarget[]): void {
  const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
  if (scan.fence !== null) {
    if (closesFence(scan.fence, line)) scan.fence = null;
    return;
  }
  const open = FENCE_RE.exec(line);
  if (open) {
    scan.fence = open[1] ?? '```';
    return;
  }
  linkTargetsIn(line.replace(INLINE_CODE_RE, ''), platform, out);
}

/**
 * 아직 줄바꿈이 안 온 조각을 미리 읽는다 — 마지막 줄의 링크를 다음 줄바꿈까지 기다리지 않게.
 * 닫히지 않은 인라인 코드가 남아 있으면 그 앞까지만 본다(뒤에 닫는 백틱이 올 수 있다).
 */
function peekPartial(scan: LinkScan, platform: PlatformName, out: LinkTarget[]): void {
  if (scan.fence !== null || !scan.partial.includes('](') || FENCE_RE.test(scan.partial)) return;
  const stripped = scan.partial.replace(INLINE_CODE_RE, '');
  const open = stripped.indexOf('`');
  linkTargetsIn(open >= 0 ? stripped.slice(0, open) : stripped, platform, out);
}

function pushText(scan: LinkScan, text: string, platform: PlatformName, out: LinkTarget[], peek: boolean): void {
  let rest = text;
  for (;;) {
    const nl = rest.indexOf('\n');
    if (nl < 0) break;
    feedLine(scan, scan.partial + rest.slice(0, nl), platform, out);
    scan.partial = '';
    rest = rest.slice(nl + 1);
  }
  scan.partial += rest;
  if (scan.partial.length > PRESENTED_LINE_MAX) scan.partial = scan.partial.slice(-PRESENTED_LINE_MAX / 2);
  // 링크는 `)` 로만 끝난다 — 그 글자가 온 조각에서만 미리 읽어 글자 조각마다 다시 훑지 않는다.
  if (peek && rest.includes(')')) peekPartial(scan, platform, out);
}

function endScan(scan: LinkScan, platform: PlatformName, out: LinkTarget[]): void {
  if (scan.partial) feedLine(scan, scan.partial, platform, out);
  scan.partial = '';
  scan.fence = null;
}

function targetKey(target: LinkTarget, platform: PlatformName): string {
  return `${target.relative ? 'r' : 'a'}\u0000${pathKey(target.path, platform)}`;
}

/** 글 한 덩어리의 링크 목적지(등장 순서 · 같은 목적지는 한 번). 종류는 거르지 않는다. */
export function localLinkTargets(prose: string, platform: PlatformName): LinkTarget[] {
  const scan: LinkScan = { fence: null, partial: '' };
  const all: LinkTarget[] = [];
  pushText(scan, prose, platform, all, false);
  endScan(scan, platform, all);
  const seen = new Set<string>();
  return all.filter((t) => {
    const key = `${t.relative ? 'r' : 'a'}\u0000${t.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 글 한 덩어리가 내건 파일 — 우리 앱이 여는 미리보기 종류만(§5.1 #2-1 (B)), 같은 파일은 한 번. */
export function presentedFilesIn(prose: string, platform: PlatformName): LinkTarget[] {
  const seen = new Set<string>();
  return localLinkTargets(prose, platform).filter((t) => {
    if (!isPreviewBundleFile(t.path)) return false;
    const key = targetKey(t, platform);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface PresentedState {
  turn: string;
  seen: Set<string>;
  run: { owner: string; scan: LinkScan } | null;
}

/**
 * 스트림을 차례로 받아 세션이 내건 파일을 턴마다 한 번씩 돌려준다. 말풍선 경계는 IDE 와 같다 —
 * 사고·도구·결과·그림 줄과 주인(부모·중첩 서브에이전트)·턴이 바뀌면 끊고, 상태 칩(`system`)은 끊지 않는다.
 */
export class PresentedFileTracker {
  private readonly states = new Map<string, PresentedState>();

  constructor(private readonly platform: PlatformName) {}

  /** @param turnKey 같은 파일을 한 번만 셀 범위 — 기본은 이벤트의 턴 도장. */
  take(event: PresentedEventLike, turnKey: string = event.turnId ?? ''): LinkTarget[] {
    // 상태 칩은 말풍선을 끊지 않고, 백단 작업 끝 칩은 지난 턴 도장을 달고 온다 — 턴 판단에 넣지 않는다.
    if (event.eventType === 'system') return [];
    const st = this.stateOf(event.subAgentId);
    if (st.turn !== turnKey) {
      st.turn = turnKey;
      st.seen.clear();
      st.run = null;
    }
    const found: LinkTarget[] = [];
    if (event.eventType !== 'text' || event.imagePath) {
      this.endRun(st, found);
      if (event.eventType === 'text' && event.imagePath) found.push({ path: event.imagePath, relative: false });
      return this.firstSeen(st, found);
    }
    const owner = event.nestedUnderToolUseId ?? '';
    if (st.run && st.run.owner !== owner) this.endRun(st, found);
    if (!st.run) st.run = { owner, scan: { fence: null, partial: '' } };
    pushText(st.run.scan, event.content, this.platform, found, true);
    return this.firstSeen(st, found);
  }

  /** 세션이 사라졌다 — 들고 있던 것을 놓는다. */
  forget(subAgentId: string): void {
    this.states.delete(subAgentId);
  }

  private endRun(st: PresentedState, out: LinkTarget[]): void {
    if (!st.run) return;
    endScan(st.run.scan, this.platform, out);
    st.run = null;
  }

  private firstSeen(st: PresentedState, found: readonly LinkTarget[]): LinkTarget[] {
    const fresh: LinkTarget[] = [];
    for (const t of found) {
      if (!isPreviewBundleFile(t.path)) continue;
      const key = targetKey(t, this.platform);
      if (st.seen.has(key)) continue;
      st.seen.add(key);
      if (st.seen.size > PRESENTED_SEEN_MAX) {
        const oldest = st.seen.values().next();
        if (!oldest.done) st.seen.delete(oldest.value);
      }
      fresh.push(t);
    }
    return fresh;
  }

  private stateOf(subAgentId: string): PresentedState {
    const found = this.states.get(subAgentId);
    if (found) {
      this.states.delete(subAgentId);
      this.states.set(subAgentId, found);
      return found;
    }
    const fresh: PresentedState = { turn: '', seen: new Set(), run: null };
    this.states.set(subAgentId, fresh);
    while (this.states.size > PRESENTED_SESSIONS_MAX) {
      const oldest = this.states.keys().next();
      if (oldest.done || oldest.value === subAgentId) break;
      this.states.delete(oldest.value);
    }
    return fresh;
  }
}
