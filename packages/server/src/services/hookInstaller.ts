import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveBinary } from './binLocator.js';

const MARKER = '_vibisualManaged';

/**
 * §3.6 — **등록 대상 훅 이벤트(33종).**
 *
 * 정본은 설치본이 함께 배포하는 설정 스키마(`claude-code-settings.schema.json`)의 `hooks`
 * propertyNames 다. 2.1.251 기준 33종이고 우리는 그중 15종만 걸고 있었다 — 나머지 18종은
 * "안 쓰기로 정한 것"이 아니라 **CLI 가 늘어나는 동안 우리가 따라가지 못한 것**이다.
 *
 * ⚠ §3.6 "알 수 없는 이벤트" — 분기에 안 걸린 이벤트는 전부 `markActive` 로 떨어진다.
 *   그래서 **종료류 이벤트를 그냥 등록만 하면 그 세션이 영영 active 로 남는다**(`StopFailure` 가
 *   그 사례였다). 새 이벤트를 넣을 때는 서버 분기(`index.ts` 의 `/api/hook-event`)를 함께 본다.
 */
export const HOOK_EVENTS = [
  // ── 세션 생명주기 ──
  'SessionStart',
  // 세션이 끝났다. **종료류라 서버 분기가 반드시 있어야 한다** — 없으면 `markActive` 로 떨어져
  //   방금 끝난 세션이 영영 도는 것처럼 보인다(`StopFailure` 가 이미 겪은 함정).
  'SessionEnd',
  'Setup',
  // ── 프롬프트 ──
  'UserPromptSubmit',
  // 사용자가 친 명령이 프롬프트로 펼쳐지는 순간(슬래시 명령 확장 등).
  'UserPromptExpansion',
  // ── 도구 ──
  'PreToolUse',
  'PostToolUse',
  // 도구 실패. tool_name 을 달고 오므로 사후(Post)로 명시하지 않으면 사전 이벤트로 오인된다.
  'PostToolUseFailure',
  // 병렬 도구 한 묶음이 전부 끝난 시점. 한 턴에 여러 도구가 동시에 나가는 요즘 모델에서
  //   "이 묶음이 끝났다"는 신호는 개별 PostToolUse 로는 만들 수 없다.
  'PostToolBatch',
  // ── 권한 ──
  // 승인 대기·거부 표시(실제 판정은 §5.3 #12-1 동기 PreToolUse 게이트가 계속 담당).
  'PermissionRequest',
  'PermissionDenied',
  // ── 알림·표시 ──
  'Notification',
  // assistant 텍스트가 화면에 뿌려지는 동안. **빈도가 높다** — 그래서 HTTP 훅 전송이 기본이고,
  //   command 폴백에서도 `async` 로 붙여 턴을 붙잡지 않는다.
  'MessageDisplay',
  // ── 서브에이전트 ──
  // 스폰 순간. 대차대조는 PreToolUse(Task|Agent) 가 이미 맡으므로 신호로만 쓴다.
  'SubagentStart',
  // 서브에이전트 종료. 설치해 두어야 서버가 부모 Stop 과 서브 Stop 을 구분해 부모 버블 조기 완료를 막는다.
  'SubagentStop',
  // 에이전트 팀 동료가 곧 유휴로 들어간다. **활동 신호가 아니다** — markActive 로 떨어뜨리면
  //   멈추려는 세션을 도는 것으로 되돌린다.
  'TeammateIdle',
  // ── 작업(Task) 장부 ──
  //   `TaskCreate`/`TaskUpdate` 도구가 발화시킨다. 도구가 목록(`AVAILABLE_AGENT_TOOLS`)에 없으면
  //   등록해도 한 건도 오지 않으므로 §4 규약 (3) 과 한 쌍이다.
  'TaskCreated',
  'TaskCompleted',
  // ── 턴 종료 ──
  'Stop',
  // API 오류로 턴이 끝난 경우. 등록하지 않으면 그 세션이 영영 active 로 남는다.
  'StopFailure',
  // ── 압축 ──
  'PreCompact',
  // 압축 완료 — PreCompact 가 켠 표시를 내린다.
  'PostCompact',
  // ── 모델 전환 ──
  'PreModelSwitch',
  'PostModelSwitch',
  // ── MCP 되묻기 ──
  //   MCP 서버가 도구 실행 도중 사용자 입력을 요구하는 순간과 그 답. §5.3 #12-2 질문 카드와
  //   같은 갈래라 표시 창구를 공유한다.
  'Elicitation',
  'ElicitationResult',
  // ── 설정·작업공간 ──
  'ConfigChange',
  // 워크트리 생성·제거. `isolation: 'worktree'` 로 뜬 세션이 실제로 어디에 앉았는지 알 수 있는
  //   유일한 훅 신호다(종전에는 스폰 인자로 추측했다).
  'WorktreeCreate',
  'WorktreeRemove',
  // 어떤 CLAUDE.md·rules 가 실제로 로드됐는지(§3.6-1 집행 계측).
  'InstructionsLoaded',
  // 작업 디렉터리가 바뀌었다 / 작업 디렉터리가 추가됐다 / 감시 중인 파일이 디스크에서 바뀌었다.
  //   앞의 둘은 그래프 귀속(어느 프로젝트 탭인가)에 직접 걸리고, 셋째는 IDE 탐색기 갱신 신호다.
  'CwdChanged',
  'DirectoryAdded',
  'FileChanged',
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

/**
 * §3.6 — **handler.mjs(자식 프로세스)가 반드시 필요한 이벤트.**
 *
 * 나머지는 "받은 JSON 을 우리 서버로 그대로 넘기는 것"뿐이라 CLI 가 직접 POST 하면 된다(HTTP 훅).
 * 아래 넷만은 Node 쪽에서 할 일이 있다.
 *
 *  - `PreToolUse`       — 승인 게이트(§5.3 #12-1)·질문 카드(#12-2). **동기로 결정 JSON 을 돌려준다.**
 *  - `UserPromptSubmit` — 켠 플러그인의 집행 블록을 `additionalContext` 로 얹는다(§5.11).
 *  - `Stop`             — 대기열에서 다음 명령을 꺼내 `claude --resume` 으로 띄운다.
 *  - `PostToolUse`      — 편집 직후 기억 카드 경고 주입(§5.10). **`Edit`/`Write` 에만 필요하다.**
 */
export const HANDLER_EVENTS: ReadonlySet<string> = new Set<HookEvent>([
  'PreToolUse', 'UserPromptSubmit', 'Stop', 'PostToolUse',
]);

/**
 * §3.6 / §5.10 — `PostToolUse` 에서 handler.mjs 가 **실제로 할 일이 있는 도구.**
 *
 * 기억 카드 경고 주입은 처음부터 `Edit`/`Write` 두 도구에만 붙는 기능이었는데, 훅에는 필터가
 * 없어서 **모든 도구 호출마다 Node 프로세스가 한 번씩 떴다.** `if`(권한 규칙 문법) 필터가 그
 * 헛스폰을 없앤다 — 나머지 도구의 `PostToolUse` 는 HTTP 훅이 서버로 바로 넘긴다.
 */
export const BRAIN_NOTE_TOOLS: readonly string[] = ['Edit', 'Write'];

/**
 * §5.3 #12-1 — 승인 게이트는 사용자 결정을 최대 60초 기다린다. 훅 타임아웃은 그보다 조금 길어야
 * 하고(짧으면 사용자가 누르기 전에 CLI 가 먼저 포기한다), CLI 기본값 600초보다는 훨씬 짧아야 한다
 * (Vibisual 이 멎으면 사용자의 CLI 가 10분간 얼어붙는다).
 */
const SYNC_GATE_TIMEOUT_SEC = 70;

/** 프롬프트 집행 주입 — handler 가 스스로 1초로 끊으므로 그 위에 얇게 얹는다. */
const PROMPT_HOOK_TIMEOUT_SEC = 5;

/** 턴 종료 — 대기열 pop + `--resume` 스폰까지 포함해도 넉넉한 값. */
const STOP_HOOK_TIMEOUT_SEC = 20;

/** 순수 전달(추적)용 상한. 루프백이라 이보다 오래 걸리면 이미 잘못된 것이다. */
const TRACK_TIMEOUT_SEC = 10;

/**
 * §3.6 — 이벤트별 상한 예외.
 *
 * `SessionEnd` 의 기본 예산은 **1.5초**이고, 설정에 적은 per-hook timeout 중 가장 큰 값이 곧
 * 세션 종료 예산이 된다. 여기에 추적용 10초를 그대로 쓰면 **우리 서버가 멎었을 때 사용자의 세션
 * 종료·`/clear`·`/resume` 이 10초씩 멈춘다.** 우리가 하는 일은 루프백 POST 한 번뿐이라 2초면 넉넉하다.
 */
const EVENT_TIMEOUT_SEC: Partial<Record<HookEvent, number>> = {
  SessionEnd: 2,
};
/**
 * §3.6 — HTTP 훅(`type: 'http'`)을 쓸 수 있다고 **실측으로 확인한** 최저 CLI 판올림.
 *
 * 2.1.251 확장 번들의 `claude-code-settings.schema.json` 에서 `type: 'http'` 변형을 직접 확인한
 * 값이다. 공식 문서에 도입 판올림이 적혀 있지 않아 "확인한 값"을 바닥으로 잡았고, 이보다 낮은
 * 판본에서는 **command 훅으로 떨어진다**(기능이 사라지는 게 아니라 종전 경로 그대로다).
 * 더 낮은 판본에서 확인되면 그때 이 값을 내려라 — 추측으로 내리지 마라. 모르는 `type` 을 만난
 * 옛 CLI 가 훅을 통째로 버리면 이벤트가 0건이 되고, 그건 앱이 죽은 것처럼 보인다.
 */
export const HTTP_HOOK_MIN_CLI_VERSION = '2.1.251';

/** 훅 전송 경로. `http` = CLI 가 우리 서버로 직접 POST, `command` = handler.mjs 자식 프로세스. */
export type HookTransport = 'http' | 'command';

interface HookCommandEntry {
  type: 'command';
  command: string;
  /** exec 형식 인자. 있으면 셸을 타지 않는다 — 공백·따옴표 든 경로가 안전해진다. */
  args?: string[];
  /** 도구 패턴 필터(권한 규칙 문법). 안 맞으면 훅 자체가 안 뜬다. */
  if?: string;
  timeout?: number;
  async?: boolean;
  statusMessage?: string;
}

interface HookHttpEntry {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
  allowedEnvVars?: string[];
  if?: string;
  timeout?: number;
}

type HookEntry = HookCommandEntry | HookHttpEntry;

interface HookMatcherBlock {
  hooks: HookEntry[];
  [MARKER]?: boolean;
  matcher?: string;
}

interface ClaudeSettings {
  hooks?: Partial<Record<HookEvent, HookMatcherBlock[]>>;
  allowedHttpHookUrls?: unknown;
  [k: string]: unknown;
}

export interface HookInstallResult {
  installed: boolean;
  alreadyPresent: boolean;
  backupPath?: string;
  settingsPath: string;
  /** 표식 없는 옛 Vibisual 블록을 몇 장 걷어냈는지(§3.6 중복 누적 차단). */
  prunedLegacy: number;
  /** 보존 상한을 넘어 지운 백업 파일 수(§3.6 "부팅마다 새 백업 ❌"). */
  prunedBackups: number;
  /** 실제로 깔린 전송 경로. 요청과 다를 수 있다(버전·허용목록 때문에 command 로 떨어짐). */
  transport: HookTransport;
  /** `http` 를 원했는데 `command` 로 떨어진 사유(진단용). 떨어지지 않았으면 undefined. */
  transportFallbackReason?: string;
  error?: Error;
}

export interface HookInstallOptions {
  /**
   * 원하는 전송 경로. 기본 `'command'` — **부팅 최초 설치는 CLI 판올림을 아직 모른다.**
   * 판올림을 확인한 뒤 같은 인자로 다시 부르면(§3.6 idempotent) HTTP 로 승격된다.
   */
  transport?: HookTransport;
  /** 설치본 판올림(`2.1.251` 꼴). 모르면 undefined — HTTP 승격을 하지 않는다. */
  cliVersion?: string | null;
}

/** §3.6 — `settings.json.bak-vibisual-*` 보존 개수. 넘치면 오래된 것부터 지운다. */
const MAX_BACKUPS = 5;

/** semver 비교: a >= b 면 true. 형식이 아니면 false(모르면 승격하지 않는다). */
export function versionAtLeast(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  const parse = (v: string): number[] => (v.split(/[-+]/)[0] ?? '').split('.').map((n) => parseInt(n, 10));
  const x = parse(a);
  const y = parse(b);
  if (x.some((n) => Number.isNaN(n)) || x.length < 2) return false;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const xi = x[i] ?? 0;
    const yi = y[i] ?? 0;
    if (xi > yi) return true;
    if (xi < yi) return false;
  }
  return true;
}

/**
 * §3.6 — `allowedHttpHookUrls` 허용목록이 우리 URL 을 통과시키는가.
 *
 * 조직이 이 키를 걸어 두면 목록에 없는 HTTP 훅은 **조용히 안 돌고**, 우리는 이벤트가 0건인
 * 이유를 알 길이 없다. 그래서 설치 시점에 읽어 보고 안 맞으면 command 로 떨어진다.
 * 키가 아예 없으면(=undefined) 전부 허용이므로 통과.
 */
export function httpHookUrlAllowed(allowList: unknown, url: string): boolean {
  if (allowList === undefined || allowList === null) return true;
  if (!Array.isArray(allowList)) return true; // 형식이 이상하면 CLI 가 판단하게 둔다
  return allowList.some((pattern) => {
    if (typeof pattern !== 'string') return false;
    // `*` 만 와일드카드다. 정규식 메타는 전부 이스케이프한 뒤 `*` 만 되살린다.
    const rx = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    return rx.test(url);
  });
}

/**
 * §3.6 v2.9 / (판올림 번호 발급 대기) — handler.mjs 실행 엔트리.
 *
 * **exec 형식(`args`)으로 나간다.** 종전에는 `node "경로" --server "..." --token "..."` 한 줄을
 * 셸에 먹였는데, 그러면 경로에 공백·따옴표·`$`·백틱이 있을 때 셸 파서를 거치게 되고 OS 마다
 * 다른 규칙(POSIX 는 bash, Windows 는 Git Bash 없으면 PowerShell)을 탄다. `args` 를 주면 CLI 가
 * 실행본을 직접 spawn 하므로 셸 파서가 아예 등장하지 않는다 — 멀티플랫폼 규칙(경로를 문자열로
 * 조립하지 않는다)과 정확히 같은 이유다.
 *
 * `node` 는 **절대경로로 못 박는다** — Finder 로 띄운 mac 앱은 Homebrew 경로가 없는 최소 PATH 를
 * 받아 `node` 를 못 찾는다(`resolveBinary`). 못 찾으면 이름 그대로 두어 CLI 의 PATH 탐색에 맡긴다.
 */
function buildHandlerEntry(
  port: number,
  handlerPath: string,
  token: string,
  opts: { if?: string; sync: boolean; timeout: number; statusMessage?: string; extraArgs?: readonly string[] },
): HookCommandEntry {
  const nodeBin = resolveBinary('node') ?? 'node';
  const entry: HookCommandEntry = {
    type: 'command',
    command: nodeBin,
    args: [
      handlerPath,
      '--server', `http://127.0.0.1:${port}`,
      '--token', token,
      ...(opts.extraArgs ?? []),
    ],
    timeout: opts.timeout,
  };
  if (opts.if) entry.if = opts.if;
  // 동기가 아닌 훅은 배경으로 돌린다 — 안 그러면 순수 전달용 훅이 매번 턴을 붙잡는다.
  if (!opts.sync) entry.async = true;
  if (opts.statusMessage) entry.statusMessage = opts.statusMessage;
  return entry;
}

/**
 * §3.6 (판올림 번호 발급 대기) — **CLI 가 우리 서버로 직접 POST 하는 엔트리.**
 *
 * 순수 전달 이벤트에서 `handler.mjs` 는 "stdin 을 읽어 그대로 POST 하는 것" 말고 하는 일이 없는데,
 * 그 한 줄을 위해 **이벤트마다 Node 프로세스가 하나씩 떴다.** 이벤트를 15종에서 33종으로 늘리면
 * 그 비용이 그대로 곱해지고, 그중 `MessageDisplay`·`FileChanged` 는 빈도가 높다. HTTP 훅은 그
 * 프로세스를 통째로 없앤다.
 *
 * **env 는 헤더로 건너간다** — handler.mjs 는 `VIBISUAL_OWNER_AGENT_ID` 를 읽어 본문에 실었지만
 * (CMD 버블 귀속·§4 v2.64), HTTP 훅은 본문을 손댈 수 없다. 대신 헤더 값에 `$VAR` 를 쓸 수 있으므로
 * 같은 값을 헤더로 보내고 서버가 본문 필드로 되돌린다. `allowedEnvVars` 에 올린 것만 치환되며,
 * 안 잡힌 변수는 빈 문자열이 되므로 서버는 빈 값을 "없음"으로 읽는다.
 */
function buildHttpEntry(port: number, token: string, opts: { if?: string; timeout: number }): HookHttpEntry {
  const entry: HookHttpEntry = {
    type: 'http',
    url: hookEventUrl(port),
    timeout: opts.timeout,
    headers: {
      'x-vibisual-hook-token': token,
      'x-vibisual-owner-agent-id': '$VIBISUAL_OWNER_AGENT_ID',
      'x-vibisual-owner-term-id': '$VIBISUAL_OWNER_TERM_ID',
      'x-vibisual-usage-probe': '$VIBISUAL_USAGE_PROBE',
    },
    allowedEnvVars: ['VIBISUAL_OWNER_AGENT_ID', 'VIBISUAL_OWNER_TERM_ID', 'VIBISUAL_USAGE_PROBE'],
  };
  if (opts.if) entry.if = opts.if;
  return entry;
}

/** HTTP 훅이 POST 할 주소. 허용목록 판정도 같은 문자열로 한다. */
export function hookEventUrl(port: number): string {
  return `http://127.0.0.1:${port}/api/hook-event`;
}

/**
 * §3.6 — 한 이벤트에 깔 우리 블록들. 대부분 한 장이고, `PostToolUse` 만 HTTP 경로에서 두 장이다
 * (기억 카드 주입은 `Edit`/`Write` 전용 동기 훅, 추적은 전체 도구 HTTP 훅).
 */
export function buildVibisualBlocks(
  event: HookEvent,
  port: number,
  handlerPath: string,
  token: string,
  transport: HookTransport,
): HookMatcherBlock[] {
  const wrap = (entries: HookEntry[]): HookMatcherBlock[] => [{ [MARKER]: true, hooks: entries }];

  // ── handler.mjs 가 동기 결정을 돌려주는 셋 — 전송 경로와 무관하게 항상 자식 프로세스다. ──
  if (event === 'PreToolUse') {
    return wrap([buildHandlerEntry(port, handlerPath, token, {
      sync: true,
      timeout: SYNC_GATE_TIMEOUT_SEC,
      statusMessage: 'Vibisual — waiting for your approval',
    })]);
  }
  if (event === 'UserPromptSubmit') {
    return wrap([buildHandlerEntry(port, handlerPath, token, {
      sync: true,
      timeout: PROMPT_HOOK_TIMEOUT_SEC,
    })]);
  }
  if (event === 'Stop') {
    return wrap([buildHandlerEntry(port, handlerPath, token, {
      sync: true,
      timeout: STOP_HOOK_TIMEOUT_SEC,
    })]);
  }

  if (event === 'PostToolUse') {
    if (transport === 'command') {
      // 폴백에서는 종전 그대로 한 장 — 이 엔트리가 기억 카드 주입과 추적을 겸한다.
      return wrap([buildHandlerEntry(port, handlerPath, token, { sync: true, timeout: TRACK_TIMEOUT_SEC })]);
    }
    // HTTP 경로: 기억 카드 주입은 `Edit`/`Write` 에만(= 그 외 도구에서는 프로세스가 아예 안 뜬다),
    //   추적은 전체 도구를 HTTP 로. 두 일을 나눠야 `if` 를 걸 수 있다.
    const brain = BRAIN_NOTE_TOOLS.map((tool) => buildHandlerEntry(port, handlerPath, token, {
      if: tool,
      sync: true,
      timeout: TRACK_TIMEOUT_SEC,
      // 추적은 아래 HTTP 엔트리가 맡는다 — 여기서 또 보내면 같은 이벤트가 두 번 처리된다.
      extraArgs: ['--brain-notes-only'],
    }));
    return wrap([...brain, buildHttpEntry(port, token, { timeout: TRACK_TIMEOUT_SEC })]);
  }

  // ── 나머지 전부 = 순수 전달 ──
  const timeout = EVENT_TIMEOUT_SEC[event] ?? TRACK_TIMEOUT_SEC;
  if (transport === 'http') {
    return wrap([buildHttpEntry(port, token, { timeout })]);
  }
  return wrap([buildHandlerEntry(port, handlerPath, token, { sync: false, timeout })]);}

function blocksEqual(a: HookMatcherBlock[], b: HookMatcherBlock[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isOurBlock(block: HookMatcherBlock): boolean {
  return !!block && typeof block === 'object' && block[MARKER] === true;
}

/**
 * §3.6 — 표식(`_vibisualManaged`)이 없던 시절에 깔린 **우리 옛 블록**인지 판정.
 *
 * 인스톨러는 표식 붙은 것만 갱신하므로, 표식이 없던 판본이 깔아 둔 블록은 이벤트마다 그대로
 * 남아 설치·판올림마다 한 장씩 쌓인다(실측: 이벤트당 8장 = 툴 1회 호출에 handler.mjs 프로세스 8개).
 * 우리 서명(`handler.mjs` + loopback `--server`)이 **둘 다** 보이는 블록만 걷어내므로 남의 훅은
 * 건드리지 않는다. exec 형식(`args`)으로 바뀐 뒤에는 서명이 `command` 한 줄이 아니라 `args` 배열에
 * 흩어지므로 둘을 합쳐서 본다.
 */
function isLegacyVibisualBlock(block: HookMatcherBlock): boolean {
  if (!block || typeof block !== 'object') return false;
  if (block[MARKER] === true) return false;
  if (!Array.isArray(block.hooks)) return false;
  return block.hooks.some((h) => {
    if (!h || typeof h !== 'object' || h.type !== 'command') return false;
    const parts = [h.command, ...(Array.isArray(h.args) ? h.args : [])].filter((s) => typeof s === 'string');
    const joined = parts.join(' ');
    return joined.includes('handler.mjs') && joined.includes('http://127.0.0.1:');
  });
}

/** §3.6 — 백업을 최신 `MAX_BACKUPS` 개만 남기고 정리. 실패해도 설치는 계속한다. */
function pruneBackups(settingsDir: string, settingsPath: string): number {
  try {
    const prefix = `${path.basename(settingsPath)}.bak-vibisual-`;
    const entries = fs
      .readdirSync(settingsDir)
      .filter((f) => f.startsWith(prefix))
      .map((f) => {
        const full = path.join(settingsDir, f);
        return { full, mtime: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    let removed = 0;
    for (const stale of entries.slice(MAX_BACKUPS)) {
      try {
        fs.unlinkSync(stale.full);
        removed += 1;
      } catch {
        // 개별 삭제 실패는 무시 — 백업 정리는 설치 성공을 막지 않는다.
      }
    }
    return removed;
  } catch {
    return 0;
  }
}

/**
 * §3.6 — 요청한 전송 경로를 실제로 쓸 수 있는지 판정. 못 쓰면 사유와 함께 `command` 로 떨어진다.
 *
 * **떨어지는 것이 기능 손실은 아니다** — command 경로가 종전 동작 그대로다. 반대로 못 도는
 * HTTP 훅을 깔면 이벤트가 0건이 되고, 그건 화면에서 앱이 죽은 것처럼 보인다.
 */
export function resolveTransport(
  requested: HookTransport,
  ctx: { cliVersion?: string | null; allowedHttpHookUrls?: unknown; url: string },
): { transport: HookTransport; reason?: string } {
  if (requested === 'command') return { transport: 'command' };
  if (!versionAtLeast(ctx.cliVersion, HTTP_HOOK_MIN_CLI_VERSION)) {
    return { transport: 'command', reason: `cli ${ctx.cliVersion ?? 'unknown'} < ${HTTP_HOOK_MIN_CLI_VERSION}` };
  }
  if (!httpHookUrlAllowed(ctx.allowedHttpHookUrls, ctx.url)) {
    return { transport: 'command', reason: 'allowedHttpHookUrls blocks the loopback url' };
  }
  return { transport: 'http' };
}

export function ensureClaudeHooksInstalled(
  port: number,
  handlerPath: string,
  token: string,
  options: HookInstallOptions = {},
): HookInstallResult {
  const home = os.homedir();
  const settingsDir = path.join(home, '.claude');
  const settingsPath = path.join(settingsDir, 'settings.json');

  const result: HookInstallResult = {
    installed: false,
    alreadyPresent: false,
    settingsPath,
    prunedLegacy: 0,
    prunedBackups: 0,
    transport: 'command',
  };

  try {
    if (!fs.existsSync(settingsDir)) {
      fs.mkdirSync(settingsDir, { recursive: true });
    }

    let raw: string | null = null;
    let settings: ClaudeSettings = {};

    if (fs.existsSync(settingsPath)) {
      raw = fs.readFileSync(settingsPath, 'utf-8');
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          settings = parsed as ClaudeSettings;
        }
      } catch (parseErr) {
        result.error = new Error(
          `~/.claude/settings.json JSON 파싱 실패 — 인스톨러가 파일에 손대지 않음. 사용자가 직접 점검 필요: ${(parseErr as Error).message}`,
        );
        return result;
      }
    }

    if (!settings.hooks || typeof settings.hooks !== 'object') {
      settings.hooks = {};
    }

    const decided = resolveTransport(options.transport ?? 'command', {
      cliVersion: options.cliVersion ?? null,
      allowedHttpHookUrls: settings['allowedHttpHookUrls'],
      url: hookEventUrl(port),
    });
    result.transport = decided.transport;
    if (decided.reason) result.transportFallbackReason = decided.reason;

    let modified = false;

    for (const event of HOOK_EVENTS) {
      const existing = settings.hooks[event];
      const blocks: HookMatcherBlock[] = Array.isArray(existing) ? existing : [];
      const expected = buildVibisualBlocks(event, port, handlerPath, token, decided.transport);

      // 표식 없는 우리 옛 블록 먼저 걷어낸다 — 안 그러면 판올림마다 한 장씩 쌓인다.
      const withoutLegacy = blocks.filter((b) => !isLegacyVibisualBlock(b));
      const prunedLegacy = blocks.length - withoutLegacy.length;
      if (prunedLegacy > 0) result.prunedLegacy += prunedLegacy;

      // 우리 블록은 통째로 교체한다(한 이벤트에 여러 장일 수 있어 in-place 인덱스 갱신이 안 된다).
      //   자리는 첫 우리 블록이 있던 곳 — 사용자 훅의 앞뒤 순서를 흔들지 않는다.
      const insertAt = withoutLegacy.findIndex(isOurBlock);
      const userBlocks = withoutLegacy.filter((b) => !isOurBlock(b));
      const at = insertAt === -1 ? userBlocks.length : Math.min(insertAt, userBlocks.length);
      const next = [...userBlocks.slice(0, at), ...expected, ...userBlocks.slice(at)];

      if (!Array.isArray(existing) || !blocksEqual(existing, next)) modified = true;
      settings.hooks[event] = next;
    }

    if (!modified) {
      // 손댈 게 없어도 쌓인 백업은 정리한다(§3.6 — 무한 누적 방지).
      result.prunedBackups = pruneBackups(settingsDir, settingsPath);
      result.alreadyPresent = true;
      return result;
    }

    if (raw !== null) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${settingsPath}.bak-vibisual-${ts}`;
      fs.writeFileSync(backupPath, raw, 'utf-8');
      result.backupPath = backupPath;
      result.prunedBackups = pruneBackups(settingsDir, settingsPath);
    }

    const tmpPath = `${settingsPath}.tmp-vibisual-${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmpPath, settingsPath);

    result.installed = true;
    return result;
  } catch (err) {
    result.error = err as Error;
    return result;
  }
}
