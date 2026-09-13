// SCENARIO.md §5.26 / §7.23 — **세션 한 줄이 무엇에 대한 것이었나**를 사람 말로 뽑는다.
//
// 보험 팝업의 부활 갈피는 종전에 `39f5680d` 처럼 세션 id 앞 8자만 적었다(사용자 보고: "하나도
// 알아볼 수 없다"). 그 문자열에는 뜻이 0 이라, 되살릴지 말지를 고르는 화면에서 **고를 근거가
// 아예 없었다.** 시각과 크기만으로는 385개 세션 중 어느 것이 내가 찾는 대화인지 알 수 없다.
//
// 여기서 하는 일은 **첫 사용자 프롬프트 한 덩어리 → 한 줄 제목**이다. 순수 문자열 처리라
// 플랫폼 축이 없고(§멀티플랫폼 6축 0건), 파일 읽기는 부르는 쪽이 한다 — 그래야 세 OS 어디서든
// 도는 단위 시험으로 규칙을 고정할 수 있다.
//
// **지어내지 않는다**(§5.26 (A)). 뽑을 것이 없으면 `null` 을 돌려주고, 화면은 그때 종전처럼
// id 앞자리를 적는다. 그럴싸한 제목을 만들어 붙이면 그건 없는 사실을 적는 것이다.

/** 스폰 프리앰블이 끝나고 **진짜 지시**가 시작되는 자리. 서브에이전트 프롬프트가 이 꼴이다. */
const TASK_ANCHOR = /^Task:[ \t]*/im;

/**
 * 목표 창 블록의 목표 한 줄. 덧말(`이어서 해`)로 이어진 턴은 프롬프트 맨 앞이 이 블록이라,
 * 여기서 뽑아야 "무엇을 하던 세션인가"가 나온다.
 */
const GOAL_ANCHOR = /^\*\*목표\*\*:[ \t]*(.+)$/m;

/** 슬래시 명령으로 연 세션 — `/release` 처럼 명령 이름 자체가 가장 좋은 제목이다. */
const COMMAND_NAME = /<command-name>([^<]+)<\/command-name>/i;

/**
 * 붙임말·훅 주입처럼 **사용자가 쓴 것이 아닌** 덩어리. 제목 후보에서 뺀다.
 *
 * ⚠ 여는 표만 지우면 **속 내용이 그대로 남아** 그게 제목이 된다(`<system-reminder>배경 정보`
 * → "배경 정보"). 사용자가 쓰지 않은 문장이 세션 제목이 되는 자리라, 짝이 맞는 블록은
 * **통째로** 들어낸다. 닫는 표가 없는 조각은 그 다음 줄에서 끊는다.
 */
const WRAPPER_BLOCK = /<(system-reminder|command-message|command-args|local-command-[a-z-]+|user-prompt-submit-hook)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** 짝이 안 맞는 잔여 표 — 위 블록으로 못 지운 것들. 표만 지우고 속은 살린다. */
const WRAPPER_TAG = /<\/?(system-reminder|command-message|command-args|local-command-[a-z-]+|user-prompt-submit-hook)\b[^>]*>/gi;

/** 마크다운 장식 — 제목 줄에서는 글자만 남긴다(별표가 그대로 뜨면 제목이 코드처럼 보인다). */
function stripMarkdown(s: string): string {
  return s
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\s)[*_]([^*_]+)[*_]/g, '$1$2')
    .replace(/^#{1,6}[ \t]+/gm, '');
}

/**
 * 한 줄 제목으로 쓸 수 없는 줄인가.
 *
 * 프리앰블·구분선·머리표만 있는 줄을 제목으로 잡으면 385개 세션이 전부 같은 제목이 된다
 * (실제로 카드 규약 블록이 모든 서브에이전트 프롬프트 앞에 붙어 있어서 그렇게 된다).
 */
function isNoiseLine(line: string): boolean {
  const s = line.trim();
  if (s.length === 0) return true;
  if (/^[-=_*#>|`~[\]().\s]+$/.test(s)) return true;      // 구분선·빈 장식
  if (/^\d+[.)]\s*$/.test(s)) return true;                 // 번호만
  if (/^(You are a sub-agent|Execute the following task)/i.test(s)) return true;
  if (/^#{1,6}\s/.test(line) && /카드|공통|규약|Common|Card/i.test(s)) return true;
  return false;
}

/** 제목 한 줄을 다듬는다 — 줄바꿈을 접고, 너무 길면 자른다. */
function tidy(raw: string, maxChars: number): string | null {
  let s = stripMarkdown(raw).replace(/\s+/g, ' ').trim();
  // 앞머리 기호(불릿·인용) 제거 — 뜻이 아니라 서식이다.
  s = s.replace(/^[-*>•·]+\s*/, '').trim();
  if (s.length === 0) return null;
  if (s.length <= maxChars) return s;
  // 낱말 중간에서 끊지 않는다 — 끊긴 낱말은 오히려 못 읽는다.
  const cut = s.slice(0, maxChars);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > maxChars * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

/** 제목 길이 상한. 팝업 한 줄에 들어가고, 넘치면 CSS 가 한 번 더 줄인다. */
export const SESSION_TITLE_MAX_CHARS = 80;

/**
 * 세션의 **첫 사용자 프롬프트 본문** → 한 줄 제목. 못 뽑으면 `null`.
 *
 * 우선순위는 **구체적인 것부터**다. 앞의 것이 잡히면 뒤는 보지 않는다.
 *   1. `Task:` 뒤 — 서브에이전트에게 실제로 시킨 일. 프리앰블 아래에 있어서 이걸 못 찾으면
 *      카드 규약 블록이 제목이 되고 모든 세션이 같은 제목을 갖는다.
 *   2. `**목표**:` — 목표 창 블록. 덧말로 이어진 턴은 이것이 유일한 뜻이다.
 *   3. `<command-name>` — 슬래시 명령으로 연 세션(`/release`).
 *   4. 그 외 첫 쓸모 있는 줄.
 */
export function sessionTitleFromPrompt(
  prompt: string | null | undefined,
  maxChars: number = SESSION_TITLE_MAX_CHARS,
): string | null {
  if (typeof prompt !== 'string') return null;
  const text = prompt.replace(WRAPPER_BLOCK, '\n').replace(WRAPPER_TAG, '\n');
  if (text.trim().length === 0) return null;

  // 1. Task: 뒤가 진짜 지시다.
  const taskAt = text.search(TASK_ANCHOR);
  if (taskAt >= 0) {
    const after = text.slice(taskAt).replace(TASK_ANCHOR, '');
    const line = firstMeaningfulLine(after);
    if (line) {
      const t = tidy(line, maxChars);
      if (t) return t;
    }
  }

  // 2. 목표 창 블록.
  const goal = GOAL_ANCHOR.exec(text);
  if (goal?.[1]) {
    const t = tidy(goal[1], maxChars);
    if (t) return t;
  }

  // 3. 슬래시 명령 이름.
  const cmd = COMMAND_NAME.exec(prompt);
  if (cmd?.[1]) {
    const t = tidy(cmd[1], maxChars);
    if (t) return t;
  }

  // 4. 그 외 첫 쓸모 있는 줄.
  const line = firstMeaningfulLine(text);
  return line ? tidy(line, maxChars) : null;
}

/**
 * 잡음이 아닌 첫 줄.
 *
 * ⚠ 인스펙터가 찍어 준 `[Component]` / `[Path]` 머리표 줄은 **건너뛴다** — 사용자가 화면
 * 어디를 가리켰는지는 담겨 있지만 "무엇을 시켰나"는 그 아래 문장에 있다. 셀렉터 경로가
 * 제목이 되면 종전의 해시 문자열과 똑같이 못 읽는 줄이 된다.
 */
function firstMeaningfulLine(text: string): string | null {
  const lines = text.split('\n');
  let fallback: string | null = null;
  for (const line of lines) {
    if (isNoiseLine(line)) continue;
    const s = line.trim();
    if (/^\[(Component|Text|Attrs|Path|Value|State)\]/i.test(s)) {
      // 인스펙터 머리표 — 뒤에 진짜 문장이 없을 때만 쓴다.
      fallback ??= s;
      continue;
    }
    return s;
  }
  return fallback;
}
