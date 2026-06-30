// §4 v2.89 — CMD(인터랙티브 터미널) 카드 스니퍼.
//
// 인터랙티브 터미널 claude 는 **터미널 stdout 에 `::VIBISUAL-CARD::{…}` 한 줄을 인쇄**해 카드를 띄운다.
// 이 모듈은 PTY 출력 스트림을 가로채, 그 마커 줄을 감지하면 **터미널에서 그 줄을 숨기고(빈 문자열로 대체)**
// 파싱한 카드 페이로드를 `onCard` 콜백으로 올린다. 카드는 xterm 그리드 밖 DOM 패널(IDETerminalCardRail)이
// 기존 React 카드 컴포넌트로 렌더한다 — 터미널 그리드를 한 줄도 건드리지 않으므로 폰트 확대·창 리사이즈로
// claude REPL TUI 가 화면을 다시 그려도 카드가 깨지거나 복제되지 않는다(v2.83 인라인 ANSI 박스 방식의 근본 결함 해소).
// 마커가 없는 일반 출력은 한 바이트도 변형 없이 통과시킨다.
//
// 안전: claude REPL TUI 는 개행 없는 `\r`·커서 시퀀스를 고빈도로 쏟아낸다 → **마커가 의심될 때만** 꼬리를
// 잠깐 버퍼링하고, 그 외엔 즉시 통과시켜 TUI 렌더가 깨지지 않게 한다. reattach replay 청크는 화면 리셋 직후
// 같은 줄 단위 처리로 흘려 — 마커를 숨기고 카드를 재구성(onReset 으로 패널을 먼저 비운다).

import { VIBISUAL_CARD_SENTINEL } from '@vibisual/shared';

export type TerminalCardKind = 'report' | 'questions' | 'review' | 'list';

/** 한 질문(질문 + 제안 프롬프트들). */
export interface TerminalCardQuestionItem {
  question: string;
  header?: string;
  prompts: string[];
}

/**
 * 마커에서 파싱·정규화한 카드 1건. 표시에 필요한 필드만 담는다(id/createdAt 은 스니퍼가 발급).
 * IDETerminalCardRail 이 kind 로 분기해 기존 AgentReportCard/AgentQuestionCard/AgentReviewCard/AgentListCard 에 매핑.
 */
export type TerminalCard =
  | { id: string; createdAt: number; kind: 'report'; did: string[]; userActions: string[]; nextSteps: string[]; note?: string }
  | { id: string; createdAt: number; kind: 'questions'; items: TerminalCardQuestionItem[]; note?: string }
  | { id: string; createdAt: number; kind: 'review'; instruction?: string; changes: string[]; checkpoints: string[]; note?: string }
  | { id: string; createdAt: number; kind: 'list'; title?: string; items: string[]; note?: string };

export interface TerminalCardSnifferCallbacks {
  /** 마커 줄을 감지·파싱했을 때 1건씩 호출(표시용 카드). */
  onCard: (card: TerminalCard) => void;
  /** reattach replay(화면 리셋) 감지 시 호출 — 패널을 비우고 buffer 의 마커로 카드를 재구성하게 한다. */
  onReset?: () => void;
}

/** pending 버퍼 상한 — 마커가 끝내 안 닫히면 그냥 흘려보내 메모리 폭주를 막는다. */
const MAX_PENDING = 64 * 1024;
/** 같은 JSON 을 이 시간(ms) 안에 다시 보면 중복(명령 에코 + 출력)으로 보고 카드를 1번만 올린다. */
const DEDUPE_MS = 5000;

const ESC = String.fromCharCode(27);
const REPLAY_RESET = `${ESC}[2J${ESC}[3J${ESC}[H`;

// ANSI(CSI/OSC/단일 이스케이프) + 잔여 제어문자 제거 — ESC 변수와 \\u 이스케이프로만 구성(소스에 제어문자 리터럴 ❌).
const STRIP_RE = new RegExp(
  `${ESC}\\[[0-9;?]*[ -/]*[@-~]` +
    `|${ESC}\\][^\\u0007]*(?:\\u0007|${ESC}\\\\)` +
    `|${ESC}[@-Z\\\\-_]` +
    `|[\\u0000-\\u0008\\u000b-\\u001f\\u007f]`,
  'g',
);
const SANITIZE_RE = new RegExp('[\\u0000-\\u001f\\u007f]+', 'g');

function stripAnsi(s: string): string {
  return s.replace(STRIP_RE, '');
}
/** 카드 텍스트로 넣기 전 정리 — 제어문자/개행을 공백으로 접어 한 줄로. */
function clip(s: unknown): string {
  return String(s ?? '').replace(SANITIZE_RE, ' ').trim();
}
/** clip 결과가 비면 undefined(선택 필드용). */
function clipOpt(s: unknown): string | undefined {
  const v = clip(s);
  return v.length > 0 ? v : undefined;
}

function isCardKind(v: unknown): v is TerminalCardKind {
  return v === 'report' || v === 'questions' || v === 'review' || v === 'list';
}

function asStrings(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => clip(x))
    : [];
}

let cardSeq = 0;
function nextCardId(): string {
  cardSeq += 1;
  return `tcard-${Date.now().toString(36)}-${cardSeq}`;
}

/** 파싱한 마커 obj → 표시용 TerminalCard(정규화). kind 별 필드만 추린다. */
function buildCard(kind: TerminalCardKind, obj: Record<string, unknown>): TerminalCard {
  const base = { id: nextCardId(), createdAt: Date.now() };
  if (kind === 'report') {
    return { ...base, kind, did: asStrings(obj['did']), userActions: asStrings(obj['userActions']), nextSteps: asStrings(obj['nextSteps']), note: clipOpt(obj['note']) };
  }
  if (kind === 'questions') {
    const items: TerminalCardQuestionItem[] = [];
    for (const raw of (Array.isArray(obj['items']) ? (obj['items'] as unknown[]) : [])) {
      if (!raw || typeof raw !== 'object') continue;
      const it = raw as Record<string, unknown>;
      const question = clip(it['question']);
      if (!question) continue;
      items.push({ question, header: clipOpt(it['header']), prompts: asStrings(it['prompts']) });
    }
    return { ...base, kind, items, note: clipOpt(obj['note']) };
  }
  if (kind === 'review') {
    return { ...base, kind, instruction: clipOpt(obj['instruction']), changes: asStrings(obj['changes']), checkpoints: asStrings(obj['checkpoints']), note: clipOpt(obj['note']) };
  }
  return { ...base, kind, title: clipOpt(obj['title']), items: asStrings(obj['items']), note: clipOpt(obj['note']) };
}

/** 꼬리(미완성 줄)가 마커이거나 그 분할 접두일 수 있으면 true → 개행이 올 때까지 보류. */
function mightBeMarker(tail: string): boolean {
  const clean = stripAnsi(tail);
  if (clean.includes(VIBISUAL_CARD_SENTINEL)) return true;
  // 끝부분이 마커의 접두(2글자 이상)면 보류 — 분할 경계에서 마커가 쪼개진 경우.
  const max = Math.min(clean.length, VIBISUAL_CARD_SENTINEL.length - 1);
  for (let k = max; k >= 2; k--) {
    if (VIBISUAL_CARD_SENTINEL.startsWith(clean.slice(clean.length - k))) return true;
  }
  return false;
}

/**
 * 터미널 출력 스트림 스니퍼 — 마커 줄을 숨기고 카드 이벤트를 방출, 나머지는 그대로 통과.
 * IDETerminalView 의 effect 안에서 mount 마다 1개 생성하고, onData 청크를 `feed()` 에 넣어
 * **반환된 문자열을 xterm 에 write** 한다(마커 줄은 빠진 출력). 카드는 콜백(onCard)으로 받아 DOM 패널이 렌더.
 */
export class TerminalCardSniffer {
  private pending = '';
  private recent: { key: string; ts: number }[] = [];
  private readonly onCard: (card: TerminalCard) => void;
  private readonly onReset?: () => void;

  constructor(cb: TerminalCardSnifferCallbacks) {
    this.onCard = cb.onCard;
    this.onReset = cb.onReset;
  }

  /** onData 청크를 받아 **터미널에 쓸 문자열**을 돌려준다(마커 줄은 숨겨 제외, 그 외는 원문). */
  feed(data: string): string {
    let prefix = '';
    // reattach replay(과거 scrollback 재생): 화면 리셋 시퀀스는 그대로 두되, 그 뒤 buffer 는 줄 단위로
    // 처리해 마커를 숨기고 카드를 재구성한다. 패널은 먼저 onReset 으로 비운다(중복 누적 방지).
    if (data.includes(REPLAY_RESET)) {
      this.pending = '';
      this.recent = [];
      this.onReset?.();
      const idx = data.lastIndexOf(REPLAY_RESET) + REPLAY_RESET.length;
      prefix = data.slice(0, idx);
      data = data.slice(idx);
    }
    this.pending += data;
    let out = prefix;
    for (;;) {
      const m = /\r?\n/.exec(this.pending);
      if (!m) break;
      const line = this.pending.slice(0, m.index);
      const nl = this.pending.slice(m.index, m.index + m[0].length);
      this.pending = this.pending.slice(m.index + m[0].length);
      if (this.handleLine(line)) {
        // 마커 줄(또는 중복) — 터미널에서 숨긴다(원문도 박스도 X). 카드는 콜백으로 이미 올림.
      } else {
        out += line + nl; // 일반 줄 — 원문 그대로
      }
    }
    // 미완성 꼬리: 마커 가능성 없으면 즉시 통과(TUI 안전), 있으면 개행까지 보류.
    if (this.pending && !mightBeMarker(this.pending)) {
      out += this.pending;
      this.pending = '';
    } else if (this.pending.length > MAX_PENDING) {
      out += this.pending; // 끝내 안 닫힌 마커 — 폭주 방지로 흘려보냄.
      this.pending = '';
    }
    return out;
  }

  /** 한 줄 처리 → 마커 줄이면 카드 방출(중복이면 방출 생략) 후 true(숨김), 카드 아니면 false(통과). */
  private handleLine(rawLine: string): boolean {
    const clean = stripAnsi(rawLine);
    const idx = clean.indexOf(VIBISUAL_CARD_SENTINEL);
    if (idx === -1) return false;
    // 마커 뒤 첫 { ~ 마지막 } 만 파싱 — 셸별 따옴표 군더더기(cmd.exe echo 작은따옴표 등) 흡수.
    const after = clean.slice(idx + VIBISUAL_CARD_SENTINEL.length);
    const start = after.indexOf('{');
    const end = after.lastIndexOf('}');
    if (start === -1 || end <= start) return false; // 마커는 있으나 JSON 형태 아님 — 원문 통과.
    const jsonStr = after.slice(start, end + 1);

    let obj: unknown;
    try {
      obj = JSON.parse(jsonStr);
    } catch {
      return false; // 마커는 있으나 JSON 깨짐 — 원문 통과.
    }
    if (!obj || typeof obj !== 'object') return false;
    const kind = (obj as Record<string, unknown>)['kind'];
    if (!isCardKind(kind)) return false;

    // 마커 줄 자체는 숨긴다(아래에서 true 반환). 중복이면 카드 방출만 생략.
    const now = Date.now();
    this.recent = this.recent.filter((r) => now - r.ts < DEDUPE_MS);
    if (this.recent.some((r) => r.key === jsonStr)) return true; // 중복 — 숨기되 카드는 1번만.
    this.recent.push({ key: jsonStr, ts: now });

    this.onCard(buildCard(kind, obj as Record<string, unknown>));
    return true;
  }
}
