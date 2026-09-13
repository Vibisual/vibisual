/**
 * streamDensity.ts — §5.5 #17-12 표시 밀도 변환(순수 로직).
 *
 * 배경: 스트림이 thinking·도구·본문을 전부 같은 급 상자로 쌓아 "읽을 게 너무 많다"는 문제.
 * 2026 추세(점진적 공개 — 기본은 한 줄 요약, 펼치면 상세)에 맞춰 **표시 직전에** 아이템 배열을 접는다.
 *
 * 표시 계층 전용 — 파싱(streamItems)·스크롤·카드 합류는 건드리지 않는다. 순수 함수라 단위 테스트로 검증한다
 * (streamDensity.test.ts). 밀도는 클라 전용 UI 상태(`graphStore.ideStreamDensity`).
 */
import {
  STREAM_COMPACT_TEXT_CLAMP_LINES, STREAM_COMPACT_TEXT_CLAMP_CHARS,
  STREAM_COMPACT_TEXT_TAIL_LINES, STREAM_COMPACT_TEXT_TAIL_CHARS,
  STREAM_COMPACT_TEXT_MIN_HIDDEN_CHARS,
  type StreamDensity,
} from '@vibisual/shared';
import { sameStreamItem, isSystemSubtypeChip, type StreamGroup, type StreamItemFull, type StreamPlan } from './streamItems.js';
import { foldTaskChips } from './taskChips.js';

/**
 * 도구 실행 묶음 — 기본은 "명령 실행됨 ×N" 한 줄 + 최근 도구 한 줄, 펼치면 원래 항목들이 그대로 나온다.
 *
 * §5.5 #17-13 — 종전엔 **같은 도구 이름**끼리만 묶어서, 이름이 바뀌거나(`Bash`→`Read`) 사이에 빈 줄·
 * system 칩이 끼면 런이 끊겨 상자가 사다리처럼 쌓였다. 이제 이름을 가리지 않고 묶고, 사이 잡음은
 * 런 안으로 흡수한다(버리지 않는다 — 펼치면 그대로 보인다).
 *
 * §5.5 #17-16 — 묶음은 **첫 도구부터** 만들어지고(문턱 없음), **진행 중 도구도 이 안에** 들어간다.
 * 종전엔 홑 도구·활성 도구가 묶음 밖 독립 상자로 떴다가 조건이 맞는 순간 묶음으로 빨려 들어가
 * 리스트 높이가 매번 출렁였다(사용자: "사라졌다 나온다 / 스크롤이 들쭉날쭉"). 지금 뭘 하는지는
 * 렌더러가 접힌 상태에서도 그리는 **최근 도구 한 줄**이 담당한다.
 */
export interface StreamToolGroup {
  kind: 'toolgroup';
  id: string;
  /** 묶인 도구 호출 수(라벨의 ×N). */
  toolCount: number;
  /** 등장한 도구 이름(중복 제거, 등장 순서). 헤더 칩으로 몇 개만 보여준다. */
  toolNames: string[];
  /** 펼치면 그대로 렌더할 원래 항목들(도구 + 사이 잡음, 원 순서). */
  children: StreamItemFull[];
  /** 런의 마지막 도구가 진행 중인가 — 접혀 있어도 그 한 줄은 스피너와 함께 항상 보인다. */
  active: boolean;
  timestamp: number;
  /**
   * §4 (스트림 3종 ①) — 이 묶음이 **중첩 서브에이전트(Task)** 가 부른 도구들이면 그 Task 호출의 id.
   * 런은 주인이 같은 도구끼리만 묶이므로 묶음 하나의 주인은 항상 하나다.
   */
  nestedUnderToolUseId?: string;
}

/** 렌더러가 실제로 그리는 아이템 = 파싱 아이템 + 묶음. */
export type StreamDisplayItem = StreamItemFull | StreamToolGroup;

/** 접힌 본문 — 접혀도 **보이는** 머리·꼬리와 그 사이에 감춘 줄 수(버튼 라벨용). */
export interface ClampedText {
  /** 앞부분 — 무엇을 하려는가. */
  head: string;
  /** 끝부분 — 무엇이 됐는가·무엇이 막혔나. 접힌 상태에서도 보인다(§5.5 #17-46 ①). */
  tail: string;
  /** 머리와 꼬리 **사이**에 접힌 줄 수(버튼의 N). 종전 의미(머리 뒤 전부)와 다르다. */
  hiddenLines: number;
}

/** `clampStreamText` 가 얼마나 남기고 어떻게 그릴지 — 상수는 `@vibisual/shared` 가 정본이라 부르는 쪽이 넘긴다. */
export interface ClampSpec {
  /** 머리로 남길 줄 수. */
  headLines: number;
  /** 머리로 남길 글자 수. */
  headChars: number;
  /** 꼬리로 남길 줄 수. */
  tailLines: number;
  /** 꼬리로 남길 글자 수. */
  tailChars: number;
  /** 이보다 적게 감추면 접지 않는다(§5.5 #17-46 ② — 버튼 한 줄과 상쇄되는 자리). */
  minHiddenChars: number;
  /**
   * 마크다운으로 그릴 본문인가 — 꼬리가 코드블록 **안에서** 시작하면 여는 펜스를 덧대 준다(#17-46 ④).
   * 평문으로 그리는 메인 탭은 끄고 부른다. 렌더러 종류를 함수 안에서 넘겨짚지 않으려고 인자로 받는다.
   */
  markdown?: boolean;
}

/**
 * §5.5 #17-46 — 간결 본문 클램프 한 벌. **두 탭이 같은 값을 쓰도록 여기서 한 번만 짓는다**
 * (부르는 쪽마다 상수를 조립하면 한쪽만 바뀌어 탭에 따라 다르게 접힌다).
 * 평문으로 그리는 메인 탭용이 기본이고, 마크다운으로 그리는 Sub 탭은 `COMPACT_TEXT_CLAMP_MD` 를 쓴다.
 */
export const COMPACT_TEXT_CLAMP: ClampSpec = {
  headLines: STREAM_COMPACT_TEXT_CLAMP_LINES,
  headChars: STREAM_COMPACT_TEXT_CLAMP_CHARS,
  tailLines: STREAM_COMPACT_TEXT_TAIL_LINES,
  tailChars: STREAM_COMPACT_TEXT_TAIL_CHARS,
  minHiddenChars: STREAM_COMPACT_TEXT_MIN_HIDDEN_CHARS,
};

/** 위와 같되 꼬리의 코드펜스를 맞춰 준다(§5.5 #17-46 ④ — 마크다운으로 그리는 Sub 탭 전용). */
export const COMPACT_TEXT_CLAMP_MD: ClampSpec = { ...COMPACT_TEXT_CLAMP, markdown: true };

/** 앞을 남기고 뒤를 버린다 — 공백 경계로 물러서되, 너무 앞이면(띄어쓰기가 드문 문장) 글자 수에서 자른다. */
function keepHead(s: string, max: number): string {
  const space = s.lastIndexOf(' ', max);
  return s.slice(0, space > max * 0.6 ? space : max);
}

/** 뒤를 남기고 앞을 버린다 — `keepHead` 의 거울상(공백 경계가 너무 뒤면 글자 수에서 자른다). */
function keepTail(s: string, max: number): string {
  const from = s.length - max;
  const space = s.indexOf(' ', from);
  return s.slice(space >= 0 && space < from + max * 0.4 ? space + 1 : from);
}

/**
 * 이 글이 **닫히지 않은 코드펜스 안에서 끝나는가** — 그렇다면 여는 펜스 문자열(``` 또는 ~~~), 아니면 `null`.
 * 잘라 낸 꼬리를 따로 파싱할 때 이 값을 앞에 덧대야 "꼬리의 닫는 펜스가 여는 펜스로 읽혀 남은 글이
 * 통째로 코드로 그려지는" 뒤집힘을 막는다(§5.5 #17-46 ④).
 */
function unclosedFence(s: string): string | null {
  let open: string | null = null;
  for (const line of s.split('\n')) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (!m) continue;
    const mark = m[1]![0]!;
    if (open === null) open = mark;
    else if (open === mark) open = null;
  }
  return open === null ? null : open.repeat(3);
}

/**
 * §5.5 #17-46 — 간결에서 AI 본문의 **머리와 꼬리만 남기고 가운데를 접는다.** 접을 게 없으면 `null`
 * (그대로 그린다).
 *
 * 종전(#17-21 ②)은 앞부분만 남기고 나머지를 통째로 숨겼다. 그런데 한 문단에서 사용자가 가장 읽어야
 * 하는 줄은 앞이 아니라 **끝**이다 — 무엇을 찾았는지·무엇이 막혔는지·다음에 무엇을 물어야 하는지가
 * 마지막 한두 줄에 있다. 그래서 버리는 자리를 가운데로 옮겼다.
 *
 * 머리·꼬리 모두 줄 수와 글자 수를 **둘 다** 본다: 마크다운 문단은 줄바꿈 없이 한 줄로 길게 오는 일이
 * 잦아 줄 수만 보면 클램프가 헛돌고, 글자 수만 보면 짧은 줄이 많은 목록이 안 잘린다.
 * 자르는 위치는 줄 경계 → 공백 경계 순으로 물러서 마크다운 문법을 최대한 덜 깬다.
 */
export function clampStreamText(content: string, spec: ClampSpec): ClampedText | null {
  const lines = content.split('\n');
  // ① 머리 — 줄 경계로 먼저 자르고, 그래도 길면 글자 수로 한 번 더.
  let head = lines.length > spec.headLines ? lines.slice(0, spec.headLines).join('\n') : content;
  if (head.length > spec.headChars) head = keepHead(head, spec.headChars);
  if (head.length >= content.length) return null;

  // ② 꼬리 — 머리 뒤에 남은 글에서 **뒤에서부터** 같은 방식으로 떼어 낸다.
  const rest = content.slice(head.length);
  const restLines = rest.split('\n');
  let tail = restLines.length > spec.tailLines
    ? restLines.slice(restLines.length - spec.tailLines).join('\n')
    : rest;
  if (tail.length > spec.tailChars) tail = keepTail(tail, spec.tailChars);

  // ③ 가운데가 없거나 버튼 한 줄과 상쇄될 만큼 적으면 접지 않는다(§5.5 #17-46 ②).
  const middle = rest.slice(0, rest.length - tail.length);
  const trimmed = middle.trim();
  if (trimmed === '') return null;
  const hiddenLines = Math.max(1, middle.split('\n').filter((l) => l.trim() !== '').length);
  if (hiddenLines < 2 && trimmed.length < spec.minHiddenChars) return null;

  // ④ 꼬리가 코드블록 안에서 시작하면 여는 펜스를 덧대 넘긴다(마크다운으로 그릴 때만).
  const fence = spec.markdown ? unclosedFence(head + middle) : null;
  return { head, tail: fence ? `${fence}\n${tail.replace(/^\n+/, '')}` : tail, hiddenLines };
}

/** 여는 본문 판정에 필요한 최소 형태 — Sub 탭(`StreamDisplayItem`)·메인 탭(`TerminalEntry`) 공용. */
export interface TurnRole {
  id: string;
  role: 'command' | 'text' | 'other';
}

/**
 * §5.5 #17-12 ①-2 — **턴의 여는 본문**(내 말풍선 바로 다음의 첫 AI 본문) id 들.
 *
 * 이 한 장이 `AGENT_INTENT_FIRST_RULES` 가 시키는 의도 선언이다. ①-1 이 그 선언을 요구 개수만큼
 * 길어지게 만들었는데, 간결 밀도의 4줄 클램프는 **바로 그 길어진 목록을 접는다** — 요구 7개 중 4개만
 * 보이는 화면은 모델이 30% 만 되짚던 종전과 사용자에게 똑같이 읽힌다(무엇을 빠뜨렸는지 모르니 멈출지
 * 판단이 안 선다). 그래서 마지막 본문(= 지금 하는 말)과 **같은 급으로 자르지 않는다**: 하나는 그 턴의
 * 결론이고 하나는 그 턴의 전제라, 간결이 지우면 안 되는 두 자리다.
 *
 * 순수 함수 — DOM 없이 단위 검증한다(클라 테스트에는 jsdom 이 없다).
 */
export function turnOpeningTextIds(seq: readonly TurnRole[]): Set<string> {
  const out = new Set<string>();
  // 첫 명령 이전(복원된 앞 대화 등)에는 여는 본문이 없다 — 짝지을 말풍선이 없으면 종전대로 접힌다.
  let awaiting = false;
  for (const it of seq) {
    if (it.role === 'command') { awaiting = true; continue; }
    if (it.role === 'text' && awaiting) { out.add(it.id); awaiting = false; }
  }
  return out;
}

/**
 * §5.5 #17-45 — 이 본문이 **연속 발화 런**에서 선 자리.
 * `solo` 앞뒤가 끊긴 홑 문단 · `head` 런의 첫 문단 · `mid` 가운데 · `tail` 런의 마지막 문단.
 */
export type SpeechRunPos = 'solo' | 'head' | 'mid' | 'tail';

/** 런 판정에 필요한 최소 형태 — Sub 탭(`StreamDisplayItem`)·메인 탭(`TerminalEntry`) 공용(`TurnRole` 과 같은 갈래). */
export interface SpeechRole {
  id: string;
  /** AI 본문인가 — 아니면 여기서 런이 끊긴다(내 말풍선·카드·오류·계획·그림·도구 묶음·라이브 1줄). */
  text: boolean;
  /**
   * 이 말의 **주인**. Sub 탭은 중첩 서브에이전트(`nestedUnderToolUseId`), 메인 탭은 세션(`sessionLabel`).
   * 주인이 다르면 다른 사람의 말이라 붙여 놓으면 안 된다 — 거기서 런을 끊는다.
   */
  owner?: string | undefined;
}

/** 밀도가 `compact` 가 아닐 때 넘기는 빈 맵 — 참조가 고정돼야 `useMemo`·`memo` 가 헛돌지 않는다. */
export const NO_SPEECH_RUNS: ReadonlyMap<string, SpeechRunPos> = new Map<string, SpeechRunPos>();

/**
 * §5.5 #17-45 — 연달아 온 AI 본문을 **한 발화**로 묶어 각 문단의 자리를 매긴다.
 *
 * 간결에서는 도구 묶음이 배열에서 빠지므로(#17-21 ①) 남는 것은 대부분 AI 본문이 줄줄이 이어진 모양인데,
 * 그 문단마다 같은 말머리 글리프가 하나씩 붙어 왼쪽에 똑같은 상자가 사다리처럼 쌓였다(사용자 스크린샷).
 * 같은 사람이 이어서 하는 말에 문단마다 이름표를 다시 붙이는 셈이라 정보량이 0이고 소음만 남는다.
 * 그래서 **말머리는 런의 첫 문단에만** 달고 나머지는 같은 칼럼에 이어 붙인다.
 *
 * 가상 리스트라 CSS 형제 선택자(`+`)로는 판정할 수 없다 — 화면에 없는 앞 항목은 DOM 에도 없다.
 * 그래서 `turnOpeningTextIds` 와 같이 **항목 배열**로만 판정하는 순수 함수로 둔다(단위 검증 가능).
 */
export function speechRunPositions(seq: readonly SpeechRole[]): Map<string, SpeechRunPos> {
  const out = new Map<string, SpeechRunPos>();
  let i = 0;
  while (i < seq.length) {
    const cur = seq[i]!;
    if (!cur.text) { i++; continue; }
    let j = i + 1;
    while (j < seq.length && seq[j]!.text && seq[j]!.owner === cur.owner) j++;
    for (let k = i; k < j; k++) {
      out.set(seq[k]!.id, j - i === 1 ? 'solo' : k === i ? 'head' : k === j - 1 ? 'tail' : 'mid');
    }
    i = j;
  }
  return out;
}

/** Virtuoso key·앞쪽 절단 shift 카운트용 안정 id. */
export function displayItemId(item: StreamDisplayItem): string {
  return item.id;
}

/** identity 안정화 비교(묶음까지 포함) — 렌더 결과에 영향 주는 필드가 모두 같으면 이전 참조를 재사용한다. */
export function sameDisplayItem(a: StreamDisplayItem, b: StreamDisplayItem): boolean {
  if (a.kind === 'toolgroup' || b.kind === 'toolgroup') {
    if (a.kind !== 'toolgroup' || b.kind !== 'toolgroup') return false;
    if (a.toolCount !== b.toolCount || a.active !== b.active || a.children.length !== b.children.length) return false;
    for (let k = 0; k < b.children.length; k++) {
      if (!sameStreamItem(a.children[k]!, b.children[k]!)) return false;
    }
    return true;
  }
  return sameStreamItem(a, b);
}

/**
 * 묶을 수 있는 도구인가 — §5.5 #17-16 로 **진행 중인 도구도 묶는다**(옛 규칙: 활성 도구 제외).
 * "지금 뭘 하는지 가려지면 안 된다"는 원칙은 렌더러가 접힌 묶음에도 그리는 **최근 도구 한 줄**이 지킨다.
 * 활성 도구를 밖에 두면 그 도구가 끝나는 순간 독립 상자가 묶음으로 흡수되며 화면이 출렁였다.
 */
function groupable(item: StreamDisplayItem): item is StreamGroup {
  return item.kind === 'tool';
}

/**
 * 런을 끊지 않고 흡수할 "잡음" 항목인가 — system 칩(`[task_started]` 등)과 **빈 텍스트**.
 * 실제 대화(내용 있는 text·result·계획·카드)는 잡음이 아니므로 여기서 런이 끊긴다.
 */
function runFiller(item: StreamDisplayItem): boolean {
  if (item.kind === 'system') return true;
  return item.kind === 'text' && item.content.trim() === '';
}

/**
 * 같은 턴의 옛 계획을 접는다(마지막 계획만 펼쳐 보인다).
 * 턴 경계 = 사용자 명령(`command`) 아이템 — 그 뒤로는 새 턴이라 계획도 새로 센다.
 */
function markSupersededPlans(items: StreamItemFull[]): StreamItemFull[] {
  // 뒤에서부터 훑으며 "이 턴에서 이미 더 새로운 계획을 봤는가"를 들고 간다.
  let seenNewerPlan = false;
  const out = items.slice();
  for (let k = items.length - 1; k >= 0; k--) {
    const it = items[k]!;
    if (it.kind === 'command') { seenNewerPlan = false; continue; }
    if (it.kind !== 'plan') continue;
    const plan = it as StreamPlan;
    if (seenNewerPlan) {
      if (!plan.superseded) out[k] = { ...plan, superseded: true };
    } else {
      seenNewerPlan = true;
      if (plan.superseded) out[k] = { ...plan, superseded: false };
    }
  }
  return out;
}

/**
 * 밀도에 맞춰 표시 아이템을 만든다.
 * - `raw`  : 아무것도 접지 않는다(원문 그대로).
 * - `standard` : SDK 상태 칩 숨김 + 옛 계획 접기 + 연속 동종 도구 묶기.
 * - `compact`  : 위 전부 + **도구 묶음을 배열에서 아예 뺀다**(§5.5 #17-21 ① / #17-24 ①)
 *                **AI 본문은 하나도 걸러내지 않는다**(§5.5 #17-43) — 간결은 "명령창을 숨기는" 축이지
 *                "말을 골라 주는" 축이 아니다.
 *
 * §5.5 #17-15 — 사고(thinking)는 밀도 축에서 빠졌다. 파싱 단계가 아이템 자체를 만들지 않으므로
 * 여기서 거를 것도 없다(진행 중 표시는 `thinking-live` 1줄이 전담).
 *
 * 반환 배열의 항목 참조는 변환이 필요 없는 한 입력 그대로다(불필요한 재렌더 방지).
 */
export function applyStreamDensity(items: StreamItemFull[], density: StreamDensity): StreamDisplayItem[] {
  // §5.5 #17-13 ⑤-3 — 작업 칩(시작·끝)은 밀도를 가르기 **전에** 한 줄로 접는다. 밀도 안쪽에 두면
  //   같은 스트림이 탭·밀도마다 다르게 접힌다(간결/표준에서는 어차피 ⑤ 가 걷어내므로 결과는 같다).
  const folded = foldTaskChips(
    items,
    (it) => (it.kind === 'system' ? it.content : null),
    (it, content) => (it.kind === 'system' ? { ...it, content } : it),
  );
  if (density === 'raw') return folded;

  // §5.5 #17-13 ⑤ — SDK 상태 칩(`[task_started]` 등)은 간결/표준에서 아예 그리지 않는다.
  //   내용 없는 레일 점이 한 줄씩 먹으며 화면을 갈랐다(사용자 스크린샷). 내용 있는 system 본문은 남긴다.
  const visible = folded.filter((it) => !(it.kind === 'system' && isSystemSubtypeChip(it.content)));

  const marked = markSupersededPlans(visible);
  const out: StreamDisplayItem[] = [];
  let i = 0;
  while (i < marked.length) {
    const item = marked[i]!;
    if (groupable(item)) {
      // 도구 이름을 가리지 않고, 사이에 낀 잡음(빈 줄·system 칩)도 넘어가며 런을 끝까지 잇는다.
      let j = i + 1;
      let lastToolEnd = i + 1; // 꼬리 잡음은 런에 넣지 않는다(다음 대화의 머리이므로).
      let toolCount = 1;
      // §4 (스트림 3종 ①) — 런의 **주인**. 중첩 서브에이전트가 부른 도구와 부모가 부른 도구를 한 묶음에
      //   넣으면 "누가 한 일인지"가 묶음 헤더 하나로 뭉개진다 — 주인이 다르면 거기서 런을 끊는다.
      const runNest = item.nestedUnderToolUseId;
      while (j < marked.length) {
        const next = marked[j]!;
        if (groupable(next)) {
          if (next.nestedUnderToolUseId !== runNest) break;
          toolCount++; j++; lastToolEnd = j; continue;
        }
        if (runFiller(next)) { j++; continue; }
        break;
      }
      // §5.5 #17-16 — 문턱 없음: 도구 1개짜리 런도 묶음으로 감싼다. 그래야 두 번째 도구가 와도
      //   "홑 상자가 사라지고 묶음이 생기는" 교체가 일어나지 않고, 같은 묶음의 ×N 만 올라간다.
      const children = marked.slice(i, lastToolEnd);
      const toolNames: string[] = [];
      let active = false;
      for (const c of children) {
        if (c.kind !== 'tool') continue;
        if (!toolNames.includes(c.toolName)) toolNames.push(c.toolName);
        active = c.isActive; // 활성은 런의 마지막 도구에만 붙는다(뒤 도구가 오면 자동으로 덮인다).
      }
      out.push({
        kind: 'toolgroup',
        // 묶음 id = 첫 도구 id 고정. 스트리밍 중 묶음이 자라도 id 가 그대로라 사용자가 펼쳐 둔 상태가 유지된다
        //   (개수를 id 에 넣으면 도구가 하나 늘 때마다 remount 돼 펼침이 풀린다).
        id: `toolgroup-${item.id}`,
        ...(runNest ? { nestedUnderToolUseId: runNest } : {}),
        toolCount,
        toolNames,
        children,
        active,
        timestamp: item.timestamp,
      });
      i = lastToolEnd;
      continue;
    }
    out.push(item);
    i++;
  }

  // §5.5 #17-21 ① / #17-24 ① — 간결은 **도구 묶음을 진행 중이든 완료든 화면에서 뺀다**
  //   (무엇을 했는지 볼 사람은 `표준` 으로 올린다). 높이 0 자리표시자로 남기지 않고 **배열에서 제거**해야
  //   가상 리스트 측정이 흐려지지 않는다.
  //   단, 런에 흡수됐던 **내용 있는 system 본문**(오류·권한 결정 메시지)은 묶음 밖으로 꺼내 남긴다 —
  //   그건 사용자가 읽어야 하는 내용이라 묶음과 함께 사라지면 안 된다.
  if (density === 'compact') {
    const compacted: StreamDisplayItem[] = [];
    for (const it of out) {
      if (it.kind !== 'toolgroup') { compacted.push(it); continue; }
      for (const child of it.children) {
        if (child.kind === 'system' && !isSystemSubtypeChip(child.content)) compacted.push(child);
      }
      // §5.5 #17-24 ① — 진행 중 묶음도 남기지 않는다. 도구가 시작할 때 생겼다가 끝나는 순간 빠지는
      //   그 한 줄이 간결 화면이 끊임없이 깜빡이던 원인이었다. "지금 뭘 하는지"는 작동하는 내내 떠 있는
      //   라이브 1줄(`thinking-live`)이 대신 알린다 — 실행 내용을 문자 그대로 볼 사람은 `표준` 으로 올린다.
    }
    // §5.5 #17-43 — 본문은 **하나도 걸러내지 않는다.** 종전 규칙(#17-26 ①)은 턴마다 처음·마지막 본문만
    //   남겼는데, 그 상한에 걸려 사이의 발견·경고·결정이 함께 잘려 나갔다(사용자: "본문 중에 나한테
    //   뭔가 알리는 내용은 보여야 한다"). 어휘로 나레이션을 골라내는 대안은 로케일마다 헛돌고 오탐이
    //   나므로 쓰지 않는다 — 간결이 숨기는 것은 **명령창(도구 묶음)뿐**이고 말은 전부 남는다.
    return compacted;
  }
  return out;
}
