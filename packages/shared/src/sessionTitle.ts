// §5.26 / §7.23 — 첫 사용자 프롬프트 한 덩어리 → 한 줄 제목. 세션 id 앞자리(`39f5680d`)로는 부활 갈피에서 고를 근거가 없다.
// 순수 문자열 처리(파일 읽기는 부르는 쪽). **지어내지 않는다**(§5.26 (A)) — 못 뽑으면 `null`, 화면은 id 앞자리를 적는다.

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
 * 사용자가 쓰지 않은 덩어리(붙임말·훅 주입) — 제목 후보에서 뺀다. ⚠ 여는 표만 지우면 속이 제목이 된다 — 짝 맞는 블록은 통째로,
 * 닫는 표가 없으면 다음 줄에서 끊는다.
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

/** 제목이 될 수 없는 줄(프리앰블·구분선·머리표) — 잡으면 카드 규약 블록 탓에 모든 서브에이전트 세션이 같은 제목이 된다. */
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
 * 첫 사용자 프롬프트 → 한 줄 제목(못 뽑으면 `null`). 구체적인 것부터: 1. `Task:` 뒤(없으면 규약 블록이 모든 세션의 제목이 된다)
 * 2. `**목표**:`(덧말 턴의 유일한 뜻) 3. `<command-name>`(`/release`) 4. 첫 쓸모 있는 줄.
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

/** 잡음 아닌 첫 줄. ⚠ 인스펙터 `[Component]`/`[Path]` 줄은 건너뛴다 — 시킨 일은 그 아래 문장이고, 셀렉터 경로는 해시처럼 못 읽는다. */
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
