import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAppNodeRuntime } from './appNodeRuntime.js';
import { claudeHookInvocation } from './claudeHookRuntime.js';
// §3.6 — 설치처는 하나가 아니다. Cowork 세션 홈 목록의 정본은 이 모듈.
import { listCoworkConfigHomes } from './claudeConfigHomes.js';

const MARKER = '_vibisualManaged';

/**
 * §3.6 — 등록 대상 33종(정본: 설치본 `claude-code-settings.schema.json` 의 `hooks`, 2.1.251).
 * ⚠ 분기에 안 걸리면 `markActive` 라 종료류를 등록만 하면 세션이 영영 active — 서버 분기(`/api/hook-event`)와 함께 본다.
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
  // 워크트리 생성·제거 — `isolation: 'worktree'` 세션이 실제로 어디 앉았는지 알 수 있는 유일한 훅 신호다.
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
 * §3.6 — handler.mjs 가 꼭 필요한 넷(나머지는 HTTP 훅으로 CLI 가 직접 POST): `PreToolUse`(승인 게이트 §5.3 #12-1·질문 카드 #12-2 — 동기 결정 JSON) ·
 * `UserPromptSubmit`(집행 블록 §5.11) · `Stop`(다음 명령을 `claude --resume`) · `PostToolUse`(기억 카드 경고 §5.10, `Edit`/`Write`).
 */
export const HANDLER_EVENTS: ReadonlySet<string> = new Set<HookEvent>([
  'PreToolUse', 'UserPromptSubmit', 'Stop', 'PostToolUse',
]);

/** §5.3 #12-1 — 승인 게이트는 최대 60초 기다린다. 훅 타임아웃은 그보다 조금 길고(짧으면 CLI 가 먼저 포기) CLI 기본 600초보다 훨씬 짧게(서버가 멎으면 CLI 가 10분 언다). */
const SYNC_GATE_TIMEOUT_SEC = 70;

/** 프롬프트 집행 주입 — handler 가 스스로 1초로 끊으므로 그 위에 얇게 얹는다. */
const PROMPT_HOOK_TIMEOUT_SEC = 5;

/** 턴 종료 — 대기열 pop + `--resume` 스폰까지 포함해도 넉넉한 값. */
const STOP_HOOK_TIMEOUT_SEC = 20;

/** 순수 전달(추적)용 상한. 루프백이라 이보다 오래 걸리면 이미 잘못된 것이다. */
const TRACK_TIMEOUT_SEC = 10;

/** §3.6 — `SessionEnd` 는 기본 예산 1.5초이고 per-hook timeout 최댓값이 종료 예산이 된다 — 10초면 서버가 멎을 때 `/clear`·`/resume` 이 10초 멈춘다. POST 한 번이라 2초. */
const EVENT_TIMEOUT_SEC: Partial<Record<HookEvent, number>> = {
  SessionEnd: 2,
};
/** §3.6 — HTTP 훅을 실측 확인한 최저 판(2.1.251 번들 스키마 — 공식 문서엔 없다). 낮으면 command 로. **추측으로 내리지 마라** — 모르는 `type` 에 옛 CLI 가 훅을 버리면 이벤트 0건이다. */
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
  /** §3.6 「수명」 — 이 프로세스가 이미 훅을 걷어(종료 중) 깔지 않았다. */
  skippedRetired?: boolean;
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
  /** 설정 홈(기본 `~/.claude`). Cowork 세션 홈을 넘기면 같은 블록이 깔린다(§3.6 · anthropics/claude-code#63360). */
  settingsDir?: string;
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

/** §3.6 — `allowedHttpHookUrls` 통과 판정(키가 없으면 허용). 목록 밖 HTTP 훅은 조용히 안 돌아 command 로 떨어진다. */
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
 * §3.6 — handler.mjs 엔트리는 **exec 형식(`args`)** — 한 줄 명령이면 경로의 공백·따옴표·`$` 가 OS 마다 다른 셸 파서를 탄다.
 * Node 없는 설치본은 Electron 의 Node 로 돌고, 훅에 env 필드가 없어 OS 런처를 exec 형식으로 부른다(`claudeHookInvocation`).
 */
function buildHandlerEntry(
  port: number,
  handlerPath: string,
  token: string,
  opts: { if?: string; sync: boolean; timeout: number; statusMessage?: string; extraArgs?: readonly string[] },
): HookCommandEntry {
  const invocation = claudeHookInvocation(getAppNodeRuntime(), [
    handlerPath,
    '--server', `http://127.0.0.1:${port}`,
    '--token', token,
    ...(opts.extraArgs ?? []),
  ], process.platform, process.env['SystemRoot']);
  const entry: HookCommandEntry = {
    type: 'command',
    ...invocation,
    timeout: opts.timeout,
  };
  if (opts.if) entry.if = opts.if;
  // 동기가 아닌 훅은 배경으로 돌린다 — 안 그러면 순수 전달용 훅이 매번 턴을 붙잡는다.
  if (!opts.sync) entry.async = true;
  if (opts.statusMessage) entry.statusMessage = opts.statusMessage;
  return entry;
}

/**
 * §3.6 — CLI 가 직접 POST 하는 HTTP 훅 엔트리(순수 전달 이벤트마다 Node 를 띄우지 않는다).
 * 본문을 못 고쳐 `VIBISUAL_OWNER_AGENT_ID`(CMD 귀속, §4)는 헤더 `$VAR` 로 보내고 서버가 본문으로 되돌린다. `allowedEnvVars` 밖 변수는 빈 문자열 = 없음.
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
      // §5.1 #1-1 (D) — 이 이벤트를 낸 우리 sub(앱 작업 귀속의 명시 상관 id). 우리가 띄우지 않은 세션은 빈 값이다.
      'x-vibisual-subagent-id': '$VIBISUAL_SUBAGENT_ID',
    },
    allowedEnvVars: ['VIBISUAL_OWNER_AGENT_ID', 'VIBISUAL_OWNER_TERM_ID', 'VIBISUAL_USAGE_PROBE', 'VIBISUAL_SUBAGENT_ID'],
  };
  if (opts.if) entry.if = opts.if;
  return entry;
}

/** HTTP 훅이 POST 할 주소. 허용목록 판정도 같은 문자열로 한다. */
export function hookEventUrl(port: number): string {
  return `http://127.0.0.1:${port}/api/hook-event`;
}

/** §3.6 — 한 이벤트에 깔 우리 블록(이벤트마다 한 장). */
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

  /* §5.10 — `PostToolUse` 는 한 갈래(기억 카드 축 폐기). 분기는 남긴다 — 일반 경로와 달리 `sync: true`·`TRACK_TIMEOUT_SEC` 라, 합치면 전송 방식이 바뀐다. */
  if (event === 'PostToolUse') {
    if (transport === 'command') {
      return wrap([buildHandlerEntry(port, handlerPath, token, { sync: true, timeout: TRACK_TIMEOUT_SEC })]);
    }
    return wrap([buildHttpEntry(port, token, { timeout: TRACK_TIMEOUT_SEC })]);
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
 * §3.6 — 표식(`_vibisualManaged`) 없는 우리 블록 판정(옛 판본 · 표식이 떨어진 것). 안 걷으면 부팅마다 쌓인다(실측 이벤트당 8장).
 * command: 우리 서명(`handler.mjs` + loopback `--server`) **둘 다**(`command`·`args` 합쳐서). HTTP: loopback `/api/hook-event` + 우리 토큰 헤더 둘 다.
 * Node 없는 Windows 런처는 서명이 `-EncodedCommand` 안이라 풀어 본다. 남의 훅은 건드리지 않는다.
 */
function isLegacyVibisualBlock(block: HookMatcherBlock): boolean {
  if (!block || typeof block !== 'object') return false;
  if (block[MARKER] === true) return false;
  if (!Array.isArray(block.hooks)) return false;
  return block.hooks.some((h) => {
    if (!h || typeof h !== 'object') return false;
    if (h.type === 'http') return isOurHttpHookEntry(h);
    if (h.type !== 'command') return false;
    const args = Array.isArray(h.args) ? h.args.filter((s): s is string => typeof s === 'string') : [];
    const parts = [h.command, ...args, ...args.map(decodeEncodedCommandArg)].filter((s): s is string => typeof s === 'string');
    const joined = parts.join(' ');
    return joined.includes('handler.mjs') && joined.includes('http://127.0.0.1:');
  });
}

/** 우리가 까는 HTTP 훅 주소 모양 — 포트만 바뀐다(`hookEventUrl`). */
const OUR_HOOK_EVENT_URL_RE = /^http:\/\/127\.0\.0\.1:\d{1,5}\/api\/hook-event$/;

/** HTTP 훅 엔트리가 우리 것인가 — 주소와 토큰 헤더가 둘 다 맞아야 한다(남의 HTTP 훅은 둘 중 하나가 어긋난다). */
function isOurHttpHookEntry(h: HookHttpEntry): boolean {
  if (typeof h.url !== 'string' || !OUR_HOOK_EVENT_URL_RE.test(h.url)) return false;
  const headers = h.headers;
  if (!headers || typeof headers !== 'object') return false;
  return Object.keys(headers).some((k) => k.toLowerCase() === 'x-vibisual-hook-token');
}

/**
 * `-EncodedCommand` 다음 인자면 그 스크립트를 푼다(PowerShell 규약: UTF-16LE 의 base64). 아니면 `undefined`.
 * 판정용이라 실패는 조용히 `undefined` 다 — 남의 인자를 잘못 풀어도 서명 두 조각이 다 맞을 리 없다.
 */
function decodeEncodedCommandArg(arg: string, index: number, all: readonly string[]): string | undefined {
  if (index === 0 || all[index - 1]?.toLowerCase() !== '-encodedcommand') return undefined;
  if (!/^[A-Za-z0-9+/=]+$/.test(arg)) return undefined;
  try {
    return Buffer.from(arg, 'base64').toString('utf16le');
  } catch {
    return undefined;
  }
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

/** §3.6 — 요청 전송 경로를 쓸 수 있는지 보고 못 쓰면 사유와 함께 `command`(손실 없음). 못 도는 HTTP 훅 = 이벤트 0건. */
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
  // 기본은 호스트 홈 — Cowork 세션 홈을 심을 때만 호출부가 `settingsDir` 을 넘긴다.
  const settingsDir = options.settingsDir ?? path.join(os.homedir(), '.claude');
  const settingsPath = path.join(settingsDir, 'settings.json');

  const result: HookInstallResult = {
    installed: false,
    alreadyPresent: false,
    settingsPath,
    prunedLegacy: 0,
    prunedBackups: 0,
    transport: 'command',
  };

  // §3.6 「수명」 — 종료 중에 걷은 뒤에는 같은 프로세스가 다시 깔지 않는다(스윕·전송 승격이 되살리지 못하게).
  if (hooksRetired) {
    result.skippedRetired = true;
    return result;
  }

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
      noteSettingsStamp(settingsPath);
      return result;
    }

    const written = writeSettingsFile(settingsDir, settingsPath, settings, raw);
    if (written.backupPath) result.backupPath = written.backupPath;
    result.prunedBackups = written.prunedBackups;
    noteSettingsStamp(settingsPath);

    result.installed = true;
    return result;
  } catch (err) {
    result.error = err as Error;
    return result;
  }
}

/**
 * §3.6 — settings.json 쓰기(깔기·걷기 공용): 백업 후 tmp → rename. 훅 토큰이 평문이라(하나로 loopback 화이트리스트 전체에 닿는다) 본 파일·백업 모두 **소유자만 읽게**.
 * `mode` 는 새 파일에만 먹어 rename 뒤 `chmodSync` 도 한다(Windows 는 no-op).
 */
function writeSettingsFile(
  settingsDir: string,
  settingsPath: string,
  settings: ClaudeSettings,
  raw: string | null,
): { backupPath?: string; prunedBackups: number } {
  let backupPath: string | undefined;
  let prunedBackups = 0;
  if (raw !== null) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    backupPath = `${settingsPath}.bak-vibisual-${ts}`;
    fs.writeFileSync(backupPath, raw, { encoding: 'utf-8', mode: 0o600 });
    prunedBackups = pruneBackups(settingsDir, settingsPath);
  }
  const tmpPath = `${settingsPath}.tmp-vibisual-${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tmpPath, settingsPath);
  try {
    fs.chmodSync(settingsPath, 0o600);
  } catch {
    /* 권한을 다루지 않는 파일시스템 — 위 mode 로 할 수 있는 데까지는 했다 */
  }
  return { ...(backupPath ? { backupPath } : {}), prunedBackups };
}

// ── §3.6 「수명」 — 훅은 앱이 켜져 있는 동안만 둔다 ───────────────────────────────────────────────

/** 걷은 뒤엔 `ensureClaudeHooksInstalled` 가 깔지 않는다 — 종료 중에도 스윕·승격 타이머가 돌아 훅이 되살아난다. */
let hooksRetired = false;

/** 설정 파일마다 우리가 마지막으로 맞춘 뒤의 지문(수정 시각·크기). 바뀐 홈만 다시 맞추는 데 쓴다. */
const settingsStamps = new Map<string, string>();

function settingsStampOf(settingsPath: string): string {
  try {
    const st = fs.statSync(settingsPath);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return 'missing';
  }
}

function noteSettingsStamp(settingsPath: string): void {
  settingsStamps.set(settingsPath, settingsStampOf(settingsPath));
}

/** 테스트에서 걷음 표시와 지문 장부를 비운다. */
export function __resetHookLifetimeForTest(): void {
  hooksRetired = false;
  settingsStamps.clear();
}

/** 이 프로세스가 이미 훅을 걷었는가(종료 중). */
export function areClaudeHooksRetired(): boolean {
  return hooksRetired;
}

/** 블록이 가리키는 루프백 포트. HTTP 주소나 command 의 `--server` 인자(PowerShell 런처는 풀어서)에서 읽는다. */
function vibisualBlockPort(block: HookMatcherBlock): number | null {
  if (!Array.isArray(block.hooks)) return null;
  for (const h of block.hooks) {
    if (!h || typeof h !== 'object') continue;
    let text = '';
    if (h.type === 'http') {
      text = typeof h.url === 'string' ? h.url : '';
    } else if (h.type === 'command') {
      const args = Array.isArray(h.args) ? h.args.filter((s): s is string => typeof s === 'string') : [];
      text = [h.command, ...args, ...args.map(decodeEncodedCommandArg)].filter((s): s is string => typeof s === 'string').join(' ');
    }
    const m = /http:\/\/127\.0\.0\.1:(\d{1,5})(?!\d)/.exec(text);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * 걷어도 되는 우리 블록인가 — 표식이 있거나 옛 서명(§3.6 머지 규칙 5)이 맞고, **이 앱의 포트**를 가리킬 때만.
 * 포트를 모르면(`null`) 우리 블록 전부다. 포트를 못 읽는 우리 블록은 걷는다 — 우리 것인데 주소가 없으면
 * 어디로도 닿지 않는 블록이다.
 */
function isRemovableVibisualBlock(block: HookMatcherBlock, port: number | null): boolean {
  if (!block || typeof block !== 'object') return false;
  if (!isOurBlock(block) && !isLegacyVibisualBlock(block)) return false;
  if (port === null) return true;
  const blockPort = vibisualBlockPort(block);
  return blockPort === null || blockPort === port;
}

export interface HookRemovalResult {
  settingsPath: string;
  /** 걷은 블록 수. */
  removed: number;
  /** 파일을 다시 썼는가(걷을 것이 없으면 쓰지 않는다). */
  written: boolean;
  backupPath?: string;
  error?: Error;
}

/** §3.6 「수명」 — 홈 하나에서 이 포트의 우리 블록만 걷고 빈 이벤트 키·`hooks` 도 지운다. 파일이 없거나 JSON 이 깨졌으면 손대지 않고(§3.6), 홈을 만들지 않는다(빈 껍데기 ❌). */
export function removeClaudeHooks(options: { port?: number | null; settingsDir?: string } = {}): HookRemovalResult {
  const settingsDir = options.settingsDir ?? path.join(os.homedir(), '.claude');
  const settingsPath = path.join(settingsDir, 'settings.json');
  const result: HookRemovalResult = { settingsPath, removed: 0, written: false };
  try {
    if (!fs.existsSync(settingsPath)) return result;
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    let settings: ClaudeSettings;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result;
      settings = parsed as ClaudeSettings;
    } catch (parseErr) {
      result.error = new Error(`settings.json JSON 파싱 실패 — 걷지 않고 그대로 둠: ${(parseErr as Error).message}`);
      return result;
    }
    const hooks = settings.hooks as Record<string, unknown> | undefined;
    if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return result;

    for (const [event, blocks] of Object.entries(hooks)) {
      if (!Array.isArray(blocks)) continue;
      const kept = (blocks as HookMatcherBlock[]).filter((b) => !isRemovableVibisualBlock(b, options.port ?? null));
      const removed = blocks.length - kept.length;
      if (removed === 0) continue;
      result.removed += removed;
      if (kept.length > 0) hooks[event] = kept;
      else delete hooks[event];
    }
    if (result.removed === 0) return result;
    if (Object.keys(hooks).length === 0) delete settings.hooks;

    const written = writeSettingsFile(settingsDir, settingsPath, settings, raw);
    if (written.backupPath) result.backupPath = written.backupPath;
    result.written = true;
    noteSettingsStamp(settingsPath);
    return result;
  } catch (err) {
    result.error = err as Error;
    return result;
  }
}

export interface HookRemovalAllResult {
  host: HookRemovalResult;
  cowork: HookRemovalResult[];
}

/** 호스트 + Cowork 세션 홈 전부에서 걷는다(깔 때와 같은 목록 — §3.6 「설치처는 하나가 아니다」). */
export function removeHooksEverywhere(port: number | null): HookRemovalAllResult {
  const host = removeClaudeHooks({ port });
  const cowork: HookRemovalResult[] = [];
  try {
    for (const home of listCoworkConfigHomes()) {
      cowork.push(removeClaudeHooks({ port, settingsDir: home.dir }));
    }
  } catch {
    /* 열거 실패 — 호스트는 이미 걷었다 */
  }
  return { host, cowork };
}

/**
 * §3.6 「수명」 — **앱을 끌 때** 부른다. 다시 깔지 않게 막은 뒤(같은 프로세스의 스윕·승격) 모든 홈에서 걷는다.
 * 한 번만 의미가 있다 — 두 번째 부름은 걷을 것이 없어 파일을 쓰지 않는다.
 */
export function retireClaudeHooks(port: number | null): HookRemovalAllResult {
  hooksRetired = true;
  return removeHooksEverywhere(port);
}

export interface HookReensureResult {
  /** 지문이 바뀌어 다시 맞춘 홈(`settingsDir`). */
  checked: string[];
  /** 그중 실제로 파일을 다시 쓴 홈. */
  rewritten: string[];
  /** 호스트 `~/.claude/settings.json` 이 바뀌어 다시 맞췄는가(상태 줄도 거기 산다). */
  hostChecked: boolean;
}

/** §3.6 「수명」 ③ — 10초 스윕: 맞춘 뒤 설정 파일(수정 시각·크기)이 바뀐 홈만 다시 맞춘다. 대상은 호스트와 이 프로세스가 심은 Cowork 홈(새 홈은 `installHooksIntoNewCoworkHomes`). */
export function reensureHooksWhereChanged(
  port: number,
  handlerPath: string,
  token: string,
  options: HookInstallOptions = {},
): HookReensureResult {
  const out: HookReensureResult = { checked: [], rewritten: [], hostChecked: false };
  if (hooksRetired) return out;
  const hostDir = path.join(os.homedir(), '.claude');
  for (const dir of [hostDir, ...coworkHomesDone]) {
    // 지워진 Cowork 세션 — 설치기가 `mkdir -p` 로 빈 껍데기를 되살리지 않게 장부에서 뺀다.
    if (dir !== hostDir && !fs.existsSync(dir)) {
      coworkHomesDone.delete(dir);
      continue;
    }
    const settingsPath = path.join(dir, 'settings.json');
    if (settingsStamps.get(settingsPath) === settingsStampOf(settingsPath)) continue;
    out.checked.push(dir);
    if (dir === hostDir) out.hostChecked = true;
    const r = ensureClaudeHooksInstalled(port, handlerPath, token, {
      ...options,
      settingsDir: dir === hostDir ? undefined : dir,
    });
    if (r.installed) out.rewritten.push(dir);
  }
  return out;
}

/** §3.6 — 설치처가 여럿일 때의 결과: 호스트 한 건 + Cowork 세션 홈마다 한 건. */
export interface HookInstallAllResult {
  /** 호스트 `~/.claude` 설치 결과 — VS Code 등 종전 경로 전부가 여기에 달렸다. */
  host: HookInstallResult;
  /** Cowork 세션 홈별 결과. Claude Desktop 이 없는 기계에서는 빈 배열(정상). */
  cowork: HookInstallResult[];
  /** 이번 호출에서 **실제로 파일을 쓴** Cowork 홈 수(진단용 — 로그 도배 방지에 쓴다). */
  coworkInstalled: number;
}

/**
 * 모든 설정 홈(호스트 + Cowork 세션 홈)에 같은 블록을 심는다 — Cowork 는 홈을 세션마다 따로 잡아 호스트 훅이 안 돈다(anthropics/claude-code#63360).
 * **호스트가 먼저다**(Cowork 열거가 느리거나 실패해도). 홈 하나가 실패해도 계속(§3.6 failure-tolerant).
 * 홈 목록은 15초 캐시라 심기 직전 세션 디렉터리가 있는지 다시 본다 — 설치기는 `mkdir -p` 라 지워진 세션 폴더를 되살린다.
 */
export function ensureHooksInstalledEverywhere(
  port: number,
  handlerPath: string,
  token: string,
  options: HookInstallOptions = {},
): HookInstallAllResult {
  // 호스트 — `settingsDir` 을 비워 종전 경로(`~/.claude`)로 간다.
  const host = ensureClaudeHooksInstalled(port, handlerPath, token, {
    ...options,
    settingsDir: undefined,
  });

  const cowork: HookInstallResult[] = [];
  let coworkInstalled = 0;
  try {
    resetCoworkLedgerIfStale(port, handlerPath, token, options);
    for (const home of listCoworkConfigHomes()) {
      // 캐시가 잡아 둔 사이에 사라진 세션 — 되살리지 않는다.
      if (home.sessionDir && !fs.existsSync(home.sessionDir)) continue;
      const r = ensureClaudeHooksInstalled(port, handlerPath, token, {
        ...options,
        settingsDir: home.dir,
      });
      cowork.push(r);
      if (!r.error) coworkHomesDone.add(home.dir);
      if (r.installed) coworkInstalled += 1;
    }
  } catch {
    /* 열거 자체가 실패해도 호스트 설치는 이미 끝났다 — 조용히 넘어간다 */
  }

  return { host, cowork, coworkInstalled };
}

/** 이 프로세스가 심은 Cowork 홈 장부 — 새 세션만 깔려고(부팅 1회는 새고, 매번 전부 열면 스윕마다 파싱한다). */
const coworkHomesDone = new Set<string>();

/** 장부가 가리키는 설치 내용(포트·토큰·전송 경로). 이게 바뀌면 전부 다시 깔아야 한다. */
let coworkLedgerSignature = '';

/** 포트·토큰·핸들러·전송 경로가 바뀌면 장부를 비운다 — 아니면 HTTP 승격 뒤에도 Cowork 홈에 옛 command 블록이 남는다. */
function resetCoworkLedgerIfStale(
  port: number,
  handlerPath: string,
  token: string,
  options: HookInstallOptions,
): void {
  const sig = [port, handlerPath, token, options.transport ?? 'command', options.cliVersion ?? ''].join('|');
  if (sig !== coworkLedgerSignature) {
    coworkLedgerSignature = sig;
    coworkHomesDone.clear();
  }
}

/** 테스트에서 장부를 비운다. */
export function __resetCoworkInstallLedgerForTest(): void {
  coworkHomesDone.clear();
  coworkLedgerSignature = '';
}

/**
 * 새 Cowork 세션 홈에만 심는다(10초 주기 — 깔리기 전에 CLI 가 설정을 읽으면 그 세션은 안 보인다). 호스트는 부팅 설치·승격이 맡는다.
 * @returns 새로 심은 홈 수(0 이면 로그 없음).
 */
export function installHooksIntoNewCoworkHomes(
  port: number,
  handlerPath: string,
  token: string,
  options: HookInstallOptions = {},
): number {
  let installed = 0;
  try {
    resetCoworkLedgerIfStale(port, handlerPath, token, options);
    for (const home of listCoworkConfigHomes()) {
      if (coworkHomesDone.has(home.dir)) continue;
      if (home.sessionDir && !fs.existsSync(home.sessionDir)) continue;
      const r = ensureClaudeHooksInstalled(port, handlerPath, token, {
        ...options,
        settingsDir: home.dir,
      });
      // 실패는 장부에 남기지 않는다 — 다음 회차에 다시 시도한다(일시적 잠금·권한 문제 대비).
      if (r.error) continue;
      coworkHomesDone.add(home.dir);
      if (r.installed) installed += 1;
    }
  } catch {
    /* 열거 실패는 조용히 — 다음 회차가 다시 본다 */
  }
  return installed;
}
