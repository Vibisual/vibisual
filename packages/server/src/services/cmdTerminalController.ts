import { CMD_READ_MAX_LINES, CMD_SEND_MAX_CHARS, CMD_WAIT_MAX_MS, CMD_WAIT_POLL_MS } from '@vibisual/shared';

/**
 * §4 (CMD 터미널 업그레이드 ⑥) — 임베디드 PTY 를 **서버 REST 에서 만질 수 있게 하는 주입 지점**.
 *
 * PTY 는 desktop main 의 `terminalManager` 가 소유한다. server 코어는 desktop 을 import 하지
 * 않으므로(§3.4 의존성 방향), `setBroadcastSink`/`setHookListenerToken` 과 **같은 방식**으로
 * main 이 구현체를 주입하고 server 는 이 인터페이스만 안다. 주입이 없으면(웹·테스트) 모든
 * 경로가 조용히 실패한다 — 새 프로세스도 새 소켓도 만들지 않는다.
 */
export interface CmdTerminalController {
  /** 살아 있는 termId 목록. */
  list(): string[];
  /** 그 termId 의 PTY 가 살아 있는지. */
  exists(termId: string): boolean;
  /**
   * PTY stdin 에 **그대로** 쓴다. 호출자가 개행을 붙이지 않는 한 실행되지 않는다 —
   * `/api/cmd/send` 는 개행을 절대 붙이지 않는다(사람이 Enter = §4 v2.63 ToS 합법선).
   */
  write(termId: string, data: string): boolean;
  /** scrollback 버퍼 원문(ANSI 포함). 없으면 null. */
  readBuffer(termId: string): string | null;
  /**
   * §7.10 — 그 폴더(하위 포함) 안에서 도는 PTY 를 **전부 강제 종료**하고 그 개수를 돌려준다.
   *
   * 워크트리 삭제가 쓴다. 여기서 다시 확인을 묻지 않는 것은 사용자가 이미 삭제 팝업에서
   * 확인했기 때문이고, 남겨 두면 그 프로세스가 파일을 잡고 있어 폴더가 반만 지워진다.
   * 주입이 없는 환경(웹·테스트)에서는 이 다리 자체가 없으므로 호출부가 0 으로 취급한다.
   */
  killUnder(rootPath: string): number;
  /**
   * §7.10 — 죽이지 않고 **세기만** 한다(삭제 팝업의 예고용). 죽이는 쪽과 같은 판정을 쓴다 —
   * 예고한 숫자와 실제로 죽는 것이 어긋나면 그 예고는 없느니만 못하다.
   */
  listUnder(rootPath: string): string[];
}

let controller: CmdTerminalController | null = null;

/** desktop main 이 부팅 시 1회 주입. */
export function setCmdTerminalController(next: CmdTerminalController | null): void {
  controller = next;
}

export function getCmdTerminalController(): CmdTerminalController | null {
  return controller;
}

const ESC = String.fromCharCode(27);
// ANSI(CSI/OSC/단일 이스케이프) + 잔여 제어문자 제거 — 소스에 제어문자 리터럴을 넣지 않는다.
const STRIP_RE = new RegExp(
  `${ESC}\\[[0-9;?]*[ -/]*[@-~]` +
    `|${ESC}\\][^\\u0007]*(?:\\u0007|${ESC}\\\\)` +
    `|${ESC}[@-Z\\\\-_]` +
    `|[\\u0000-\\u0008\\u000b-\\u001f\\u007f]`,
  'g',
);

/** scrollback 원문에서 ANSI/제어문자를 걷어 낸 평문. */
export function stripTerminalAnsi(raw: string): string {
  return raw.replace(STRIP_RE, '');
}

/**
 * §4 (⑥) — 그 터미널의 최근 출력 N줄(평문). PTY 가 없으면 null.
 * `lines` 는 `CMD_READ_MAX_LINES` 로 상한을 건다(§3.2.3 — 쓸수록 커지는 것에 상한).
 */
export function readCmdTerminal(termId: string, lines: number): string | null {
  const raw = controller?.readBuffer(termId);
  if (raw == null) return null;
  const n = Math.max(1, Math.min(CMD_READ_MAX_LINES, Math.floor(lines) || 200));
  const all = stripTerminalAnsi(raw).split('\n');
  return all.slice(-n).join('\n');
}

/**
 * §4 (⑥) — 터미널에 prefill 한다. **개행을 붙이지 않는다** — 붙이면 사람 없이 명령이 실행돼
 * §4 v2.63 이 세운 "사람이 루프 안"(Anthropic ToS 합법선)이 무너진다. herdr 의
 * `agent prompt --wait` 를 의도적으로 따라가지 않는 지점이다.
 */
export function sendCmdTerminal(termId: string, text: string): { ok: boolean; error?: string } {
  if (!controller) return { ok: false, error: 'terminal controller not available' };
  if (!controller.exists(termId)) return { ok: false, error: `no such terminal: ${termId}` };
  const stripped = text.replace(/[\r\n]+/g, ' ').slice(0, CMD_SEND_MAX_CHARS);
  if (!stripped) return { ok: false, error: 'empty text' };
  return controller.write(termId, stripped) ? { ok: true } : { ok: false, error: 'write failed' };
}

/**
 * §4 (⑥) — 그 터미널 출력에 `match`(문자열) 또는 `regex` 가 나타날 때까지 대기.
 * 상한은 `CMD_WAIT_MAX_MS` — 무한 대기는 허용하지 않는다.
 */
export async function waitCmdTerminal(
  termId: string,
  opts: { match?: string; regex?: string; timeoutMs?: number },
): Promise<{ ok: boolean; matched: boolean; tail?: string; error?: string }> {
  if (!controller) return { ok: false, matched: false, error: 'terminal controller not available' };
  if (!controller.exists(termId)) return { ok: false, matched: false, error: `no such terminal: ${termId}` };

  let test: (s: string) => boolean;
  if (opts.regex) {
    try {
      const re = new RegExp(opts.regex);
      test = (s) => re.test(s);
    } catch {
      return { ok: false, matched: false, error: 'invalid regex' };
    }
  } else if (opts.match) {
    const needle = opts.match;
    test = (s) => s.includes(needle);
  } else {
    return { ok: false, matched: false, error: 'match or regex required' };
  }

  const deadline = Date.now() + Math.max(0, Math.min(CMD_WAIT_MAX_MS, opts.timeoutMs ?? CMD_WAIT_MAX_MS));
  for (;;) {
    const text = readCmdTerminal(termId, CMD_READ_MAX_LINES);
    if (text != null && test(text)) {
      return { ok: true, matched: true, tail: text.split('\n').slice(-20).join('\n') };
    }
    if (Date.now() >= deadline) {
      return { ok: true, matched: false, tail: text?.split('\n').slice(-20).join('\n') };
    }
    if (!controller.exists(termId)) return { ok: true, matched: false, error: 'terminal exited' };
    await new Promise((r) => setTimeout(r, CMD_WAIT_POLL_MS));
  }
}
