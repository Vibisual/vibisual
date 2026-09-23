import {
  CHAT_LOG_DEFAULT_LINES, CHAT_LOG_MAX_LINES, CHAT_TEXT_COMMAND_PREFIX,
} from '@vibisual/shared';
import type { ChatChannelKind } from '@vibisual/shared';
import { fmt } from './strings';
import type { ChatStrings } from './strings';

// §4 메신저 원격제어 브리지 — 들어온 한 줄을 무엇으로 볼 것인가 (판올림 번호 발급 대기)
//
// 순수 함수만 둔다(네트워크·상태 없음) — 폰에서 온 문자열을 해석하는 규칙은 단위 테스트로
// 고정할 수 있어야 하고, 드라이버가 둘이라 해석이 두 벌이 되면 그때부터 어긋나기 시작한다.

/** 우리가 가로채는 명령. 이 목록에 없는 `/…` 는 **에이전트에게 그대로 넘긴다**. */
export type ChatCommand =
  | { type: 'help' }
  | { type: 'projects' }
  | { type: 'agents' }
  | { type: 'sessions' }
  | { type: 'status' }
  | { type: 'stop' }
  | { type: 'log'; lines: number }
  | { type: 'unpair' }
  | { type: 'pair'; token: string }
  | { type: 'prompt'; text: string };

/** 우리 것으로 가로채는 이름들. 여기 없는 슬래시 명령은 CLI 의 것일 수 있으므로 손대지 않는다. */
const OWNED = new Set(['help', 'projects', 'agents', 'sessions', 'status', 'stop', 'log', 'unpair', 'start', 'pair']);

/**
 * 폰에서 온 한 줄을 해석한다.
 *
 * 설계 판단 하나: **모르는 슬래시 명령은 우리 것이 아니다.** `/compact`·`/스킬` 처럼 CLI 가
 * 가진 명령을 폰에서 그대로 쓰고 싶은 것이 자연스럽고, 우리가 전부 삼키면 그 길이 막힌다.
 * 그래서 가로채는 이름을 `OWNED` 로 못박고 나머지는 프롬프트로 흘려보낸다.
 */
export function parseChatCommand(raw: string): ChatCommand | null {
  const text = raw.replace(/\r/g, '').trim();
  if (!text) return null;

  // `!vibisual <명령>` 은 `/<명령>` 과 **같다**(§4 ⑨-(f)).
  //
  // 종전에는 이 접두어가 `pair` 한 가지에만 붙어 있었다. 그런데 디스코드 클라이언트는
  // 입력창의 `/` 를 슬래시 명령 피커로 가로채고 우리는 application command 를 등록하지
  // 않으므로, **거기서는 `/projects` 를 칠 방법이 없었다** — 3단계 선택은 채널 공통 코드인데
  // 디스코드에서만 그 흐름에 못 들어가던 이유다. 이미 치고 있던 한 줄의 범위를 넓혀 연다.
  const rest = stripTextPrefix(text);
  if (rest !== null) {
    if (!rest) return { type: 'help' };
    // 접두어 뒤에 다시 `/` 가 오면 슬래시 규칙 그대로 — CLI 명령(`/compact` 등)의 탈출구다.
    if (rest.startsWith('/')) return parseSlash(rest);
    // 우리 것이 아닌 이름을 접두어와 함께 보냈다면 **우리에게 말을 건 것**이다. 프롬프트로
    // 흘리면 `!vibisual` 이라는 글자까지 에이전트에게 간다 — 그 자리는 안내가 맞다.
    return named(rest) ?? { type: 'help' };
  }

  if (!text.startsWith('/')) return { type: 'prompt', text };
  return parseSlash(text);
}

/**
 * `!vibisual` 접두어를 떼고 **뒤에 남은 것**을 돌려준다. 접두어가 아니면 `null`.
 *
 * 접두어 바로 뒤가 공백이거나 줄 끝일 때만 접두어로 본다 — 그러지 않으면 `!vibisualize` 같은
 * 평문 한 단어가 명령으로 읽힌다.
 */
function stripTextPrefix(text: string): string | null {
  const head = CHAT_TEXT_COMMAND_PREFIX.toLowerCase();
  if (!text.toLowerCase().startsWith(head)) return null;
  const after = text.slice(head.length);
  if (after && !/^\s/.test(after)) return null;
  return after.trim();
}

/** `/<명령> [인자]` 한 줄. **우리 것이 아닌 슬래시 명령은 CLI 의 것일 수 있어 그대로 넘긴다.** */
function parseSlash(text: string): ChatCommand {
  return named(text.slice(1)) ?? { type: 'prompt', text };
}

/** `<명령> [인자]` — 우리가 가로채는 이름이면 그 명령, 아니면 `null`. */
function named(body: string): ChatCommand | null {
  const [head = '', ...rest] = body.split(/\s+/);
  // 그룹 대화의 텔레그램은 `/status@MyBot` 으로 온다 — 봇 이름 꼬리를 떼고 본다.
  const name = head.split('@')[0]?.toLowerCase() ?? '';
  if (!OWNED.has(name)) return null;

  const arg = rest.join(' ').trim();
  switch (name) {
    case 'start':
    case 'pair':
      // 텔레그램 딥링크가 `/start <token>`, 디스코드는 `!vibisual pair <token>` 으로 온다.
      return arg ? { type: 'pair', token: arg } : { type: 'help' };
    case 'projects':
      return { type: 'projects' };
    case 'agents':
      return { type: 'agents' };
    case 'sessions':
      return { type: 'sessions' };
    case 'status':
      return { type: 'status' };
    case 'stop':
      return { type: 'stop' };
    case 'unpair':
      return { type: 'unpair' };
    case 'log':
      return { type: 'log', lines: clampLogLines(arg) };
    default:
      return { type: 'help' };
  }
}

/** `/log n` 의 n — 숫자가 아니면 기본값, 상한을 넘으면 상한. 제3자로 나가는 양의 하드 캡이다. */
export function clampLogLines(arg: string): number {
  const n = Number.parseInt(arg, 10);
  if (!Number.isFinite(n) || n <= 0) return CHAT_LOG_DEFAULT_LINES;
  return Math.min(n, CHAT_LOG_MAX_LINES);
}

/**
 * 페어링 전 발신자에게도, 페어링 뒤 `/help` 에도 쓰는 안내문.
 *
 * 슬래시 명령 이름(`/agents` 등)은 **번역하지 않는다** — 그 글자를 그대로 쳐야 동작하기
 * 때문이다. 번역되는 것은 그 옆의 설명뿐이다.
 *
 * **채널을 보는 것은 이 표기 하나뿐이다.** 디스코드에서는 `/` 를 클라이언트가 가로채 그
 * 글자를 칠 수 없으므로, 안내가 `/projects` 라고 말하면 **화면이 안 되는 것을 알려 주는**
 * 셈이 된다. 해석은 두 채널이 같고(`parseChatCommand`), 적어 주는 모양만 바꾼다.
 */
export function helpLines(paired: boolean, s: ChatStrings, kind: ChatChannelKind = 'telegram'): string[] {
  if (!paired) return [s.helpNotPaired1, s.helpNotPaired2];
  return [
    s.helpProjects,
    s.helpAgents,
    s.helpSessions,
    s.helpStatus,
    fmt(s.helpLog, { default: CHAT_LOG_DEFAULT_LINES, max: CHAT_LOG_MAX_LINES }),
    s.helpStop,
    s.helpUnpair,
    s.helpPlain,
  ].map((line) => commandForm(line, kind));
}

/** 안내 한 줄의 앞머리 `/명령` 을 그 채널에서 **실제로 칠 수 있는** 모양으로 바꾼다. */
export function commandForm(line: string, kind: ChatChannelKind): string {
  if (kind !== 'discord' || !line.startsWith('/')) return line;
  return `${CHAT_TEXT_COMMAND_PREFIX} ${line.slice(1)}`;
}
