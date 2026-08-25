import {
  CMD_BLOCKED_IDLE_MS,
  CMD_BLOCK_PATTERNS,
  CMD_BLOCK_REASON_MAX,
  CMD_BLOCK_TAIL_LINES,
  CMD_IDLE_MS,
  type CmdTerminalState,
} from '@vibisual/shared';

// §4 (CMD 터미널 업그레이드 ①) — CMD 터미널 **상태 감지기**.
//
// herdr 이 파는 가치("막힌 놈을 찾아 헤매지 않는다")의 근거는 pane 별 working/idle/blocked 다.
// 우리 CMD 세션의 상태 근거는 지금까지 Claude Code 훅(`markCmdSubActivity`) 하나뿐이라,
// 훅이 없는 CLI(codex·gemini·aider…)를 띄우면 상태가 영영 idle 로 굳었고 claude 라도
// "권한 프롬프트 앞에서 멈춰 있음"을 표현할 축이 없었다.
//
// 이 모듈은 **새 스트림을 만들지 않는다** — `TerminalCardSniffer` 와 **같은 PTY 바이트**를 받아
// (1) 마지막 출력 시각과 (2) 화면 꼬리만 들고 있다가, 주기 tick 에서 상태를 판정한다.
//   - 바이트가 흐르는 중            → `working`
//   - 무출력 `CMD_BLOCKED_IDLE_MS` + 꼬리가 `CMD_BLOCK_PATTERNS` 매치 → `blocked`
//   - 무출력 `CMD_IDLE_MS`          → `idle`
//
// **판정이 아니라 신호다** — 서버가 이 값을 받아 `SubAgent.blocked` 플래그와 `status` 로 번역한다
// (§3.1 서버 = SSOT). 그래서 여기엔 상태 전이 규칙(`status='idle'` 같은)이 한 줄도 없다.

const ESC = String.fromCharCode(27);
// ANSI(CSI/OSC/단일 이스케이프) + 잔여 제어문자 제거 — 소스에 제어문자 리터럴을 넣지 않는다
// (§ 소스 이스케이프 유실 방지: ESC 는 변수, 나머지는 \\u 이스케이프로만 구성).
const STRIP_RE = new RegExp(
  `${ESC}\\[[0-9;?]*[ -/]*[@-~]` +
    `|${ESC}\\][^\\u0007]*(?:\\u0007|${ESC}\\\\)` +
    `|${ESC}[@-Z\\\\-_]` +
    `|[\\u0000-\\u0008\\u000b-\\u001f\\u007f]`,
  'g',
);

/** 꼬리 판정용으로 들고 있는 최대 바이트. 화면 몇 줄이면 충분하다. */
const TAIL_MAX = 4096;

export function stripAnsiForState(s: string): string {
  return s.replace(STRIP_RE, '');
}

/**
 * 화면 꼬리에서 "사용자 입력을 기다리는가"를 판정한다.
 *
 * 검사 대상은 **마지막 `CMD_BLOCK_TAIL_LINES` 줄(빈 줄 제외)** 뿐이다 — 본문 산문에서 물음표를
 * 주워 오탐하지 않게 하는 제약이며, 호출 시점 자체가 "무출력이 이어진 뒤"라 지나가는 출력은
 * 애초에 걸리지 않는다.
 */
export function classifyCmdTerminalTail(rawTail: string): { blocked: boolean; reason?: string } {
  const lines = stripAnsiForState(rawTail)
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { blocked: false };

  const tail = lines.slice(-CMD_BLOCK_TAIL_LINES);
  const joined = tail.join('\n');
  for (const re of CMD_BLOCK_PATTERNS) {
    // `lastIndex` 오염 방지 — 표의 정규식은 전역 플래그가 없지만 방어적으로 초기화한다.
    if (re.global) re.lastIndex = 0;
    if (re.test(joined)) {
      const last = tail[tail.length - 1] ?? '';
      return { blocked: true, reason: last.trim().slice(0, CMD_BLOCK_REASON_MAX) };
    }
  }
  return { blocked: false };
}

/**
 * 한 터미널(= 한 pane)의 상태를 따라가는 추적기.
 *
 * `feed` 는 PTY 바이트를 **읽기만** 한다(변형 ❌ — 카드 스니퍼와 달리 화면에 손대지 않는다).
 * `poll` 은 지금 시각으로 상태를 계산해, **바뀌었을 때만** 그 상태를 돌려준다(신호 스팸 방지).
 */
export class TerminalStateTracker {
  private tail = '';
  private lastDataAt = 0;
  private reported: CmdTerminalState | null = null;
  private reportedReason: string | undefined;

  constructor(now: number = Date.now()) {
    this.lastDataAt = now;
  }

  /** PTY 바이트 도착 — 꼬리 갱신 + 마지막 출력 시각 갱신. */
  feed(data: string, now: number = Date.now()): void {
    if (!data) return;
    this.lastDataAt = now;
    this.tail = (this.tail + data).slice(-TAIL_MAX);
  }

  /** 재부착 replay 등으로 화면이 리셋됐을 때 — 꼬리를 버린다(옛 화면으로 오판 방지). */
  reset(now: number = Date.now()): void {
    this.tail = '';
    this.lastDataAt = now;
    this.reported = null;
    this.reportedReason = undefined;
  }

  /** 지금 계산한 상태(전이가 없으면 null). `force` 면 같은 상태라도 한 번 돌려준다(첫 신고용). */
  poll(now: number = Date.now(), force = false): { state: CmdTerminalState; reason?: string } | null {
    const quiet = now - this.lastDataAt;
    let state: CmdTerminalState;
    let reason: string | undefined;

    if (quiet < CMD_BLOCKED_IDLE_MS) {
      state = 'working';
    } else {
      const verdict = classifyCmdTerminalTail(this.tail);
      if (verdict.blocked) {
        state = 'blocked';
        reason = verdict.reason;
      } else if (quiet >= CMD_IDLE_MS) {
        state = 'idle';
      } else {
        // 조용해지긴 했으나 프롬프트도 아니고 idle 이라 하기엔 이르다 — 직전 결론을 유지한다
        // (여기서 상태를 흔들면 탭 도트가 초 단위로 깜빡인다).
        state = this.reported ?? 'working';
        reason = this.reportedReason;
      }
    }

    if (!force && state === this.reported && reason === this.reportedReason) return null;
    this.reported = state;
    this.reportedReason = reason;
    return reason ? { state, reason } : { state };
  }

  /** 마지막으로 신고한 상태(표시용). */
  get current(): CmdTerminalState | null {
    return this.reported;
  }
}
