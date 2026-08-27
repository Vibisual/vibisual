import { CHAT_DISCORD_PAIR_COMMAND, CHAT_LOG_DEFAULT_LINES, CHAT_LOG_MAX_LINES } from '@vibisual/shared';

// §4 메신저 원격제어 브리지 — 들어온 한 줄을 무엇으로 볼 것인가 (판올림 번호 발급 대기)
//
// 순수 함수만 둔다(네트워크·상태 없음) — 폰에서 온 문자열을 해석하는 규칙은 단위 테스트로
// 고정할 수 있어야 하고, 드라이버가 둘이라 해석이 두 벌이 되면 그때부터 어긋나기 시작한다.

/** 우리가 가로채는 명령. 이 목록에 없는 `/…` 는 **에이전트에게 그대로 넘긴다**. */
export type ChatCommand =
  | { type: 'help' }
  | { type: 'agents' }
  | { type: 'status' }
  | { type: 'stop' }
  | { type: 'log'; lines: number }
  | { type: 'unpair' }
  | { type: 'pair'; token: string }
  | { type: 'prompt'; text: string };

/** 우리 것으로 가로채는 이름들. 여기 없는 슬래시 명령은 CLI 의 것일 수 있으므로 손대지 않는다. */
const OWNED = new Set(['help', 'agents', 'status', 'stop', 'log', 'unpair', 'start']);

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

  // 디스코드 페어링 — DM 딥링크가 없어 평문 한 줄이 같은 일을 한다.
  if (text.toLowerCase().startsWith(CHAT_DISCORD_PAIR_COMMAND)) {
    const token = text.slice(CHAT_DISCORD_PAIR_COMMAND.length).trim();
    return token ? { type: 'pair', token } : { type: 'help' };
  }

  if (!text.startsWith('/')) return { type: 'prompt', text };

  const [head = '', ...rest] = text.split(/\s+/);
  // 그룹 대화의 텔레그램은 `/status@MyBot` 으로 온다 — 봇 이름 꼬리를 떼고 본다.
  const name = head.slice(1).split('@')[0]?.toLowerCase() ?? '';
  if (!OWNED.has(name)) return { type: 'prompt', text };

  const arg = rest.join(' ').trim();
  switch (name) {
    case 'start':
      // 텔레그램 딥링크가 `/start <token>` 으로 도착한다. 토큰이 없으면 안내만.
      return arg ? { type: 'pair', token: arg } : { type: 'help' };
    case 'agents':
      return { type: 'agents' };
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

/** 페어링 전 발신자에게도, 페어링 뒤 `/help` 에도 쓰는 안내문. */
export function helpLines(paired: boolean): string[] {
  if (!paired) {
    return [
      '이 대화는 아직 연결되지 않았습니다.',
      'Vibisual 의 File → Remote Control 에서 QR 을 발급해 스캔해 주세요.',
    ];
  }
  return [
    '/agents — 에이전트를 골라 이 대화의 상대로 지정',
    '/status — 지금 하는 일과 진행률',
    '/log [n] — 원문 마지막 n 줄 (기본 ' + String(CHAT_LOG_DEFAULT_LINES) + ', 최대 ' + String(CHAT_LOG_MAX_LINES) + ')',
    '/stop — 지금 턴 중지',
    '/unpair — 이 대화 연결 끊기',
    '그 밖의 글은 고른 에이전트에게 명령으로 전달됩니다.',
  ];
}
