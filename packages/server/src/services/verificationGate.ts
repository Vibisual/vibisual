/**
 * verificationGate.ts — §5.3 #12-4 · 검증 권한 판정의 서버 쪽 한 벌.
 *
 * 분류·판정은 shared `verificationPolicy.ts` 의 순수 함수가 하고, 여기서는 **이 호스트의 값**을 물려 준다:
 *  - 지금 그 탭에서 도는 명령(그 명령에 서버가 찍은 범위·기록) — 명령이 끝나면 판정이 그 명령을 못
 *    찾으므로 권한은 그대로 만료된다(다음 명령으로 승계 ❌).
 *  - 패키지 스크립트 본문(`package.json` — mtime 캐시) — `npm run check` 의 본문이 무엇을 도는지.
 *  - CMD 터미널의 턴 — 사람이 친 문장(`UserPromptSubmit`)에서 만든 범위가 `Stop` 까지 산다.
 *
 * 판정 자리 다섯(헤드리스 클로드 `/api/permission-check` · 코덱스 권한 훅 · 로컬 `requestTool` · CMD 훅 ·
 * 앱 검증 MCP)이 이 객체 하나를 부른다 — 두 벌이 되면 한 엔진에서만 막힌다.
 *
 * 정책을 켠 동안 권한을 확인하지 못하면(도는 명령을 못 찾음) 검증은 거부한다(fail-closed). 검증이 아닌 호출은 언제나
 * 통과(`none`)라, 이 객체가 일반 작업(읽기·검색·편집)을 막는 일은 없다.
 *
 * (J) 실행 전 차단은 옵션창 권한 탭의 스위치다(기본 끔). 꺼져 있으면 다섯 자리 모두 거부하지 않고 실행으로만
 * 센다 — 스위치를 이 객체가 쥐어야 한 자리만 빠지는 일이 없다. 값은 호출마다 읽는다(다음 호출부터 적용).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  applyVerificationDecision,
  buildVerificationPolicyRules,
  buildVerificationStateLine,
  classifyVerificationCall,
  decideVerificationCall,
  markVerificationEdited,
  verificationScopeAllows,
  verificationScopeFromText,
  VERIFICATION_GATE_DEFAULT_ENABLED,
  type CommandVerificationSummary,
  type QueuedCommand,
  type VerificationDecision,
  type VerificationPolicyKind,
  type VerificationScope,
} from '@vibisual/shared';

/** `package.json` 스크립트 캐시에 남기는 파일 수(작업 폴더 수만큼만 는다 — 작은 값이면 충분하다). */
export const VERIFICATION_SCRIPT_CACHE_MAX = 200;

/** CMD 터미널 턴 기록 상한(터미널 수만큼만 는다). 넘치면 가장 오래된 턴부터 버린다 — 버린 턴은 fail-closed 다. */
export const VERIFICATION_CMD_TURN_MAX = 200;

export interface VerificationGateDeps {
  /** 이 세션 탭에서 지금 도는 명령. 없으면 undefined(정책을 켠 동안 검증은 거부). */
  findExecutingCommand(subAgentId: string): QueuedCommand | undefined;
  /**
   * (J) 실행 전 차단이 켜져 있는가 — 앱은 옵션 값(`isVerificationGateEnabled`, 기본 끔)을 넘긴다.
   * 안 넘겨도 공통 기본값(끔)을 따른다.
   */
  isEnforced?: () => boolean;
  now?: () => number;
  /** 플랫폼(테스트 주입용 — 기본 `process.platform`). msys 경로(`/c/...`) 해석에만 쓴다. */
  platform?: NodeJS.Platform;
}

export interface VerificationCallInput {
  toolName: string;
  toolInput: Record<string, unknown> | null | undefined;
  /** 도구 호출의 작업 폴더(`package.json` 스크립트를 풀 기준). */
  cwd?: string | null;
}

interface CmdTurn {
  scope?: VerificationScope;
  summary?: CommandVerificationSummary;
  startedAt: number;
}

export class VerificationGate {
  private readonly cmdTurns = new Map<string, CmdTurn>();
  private readonly scriptCache = new Map<string, { mtimeMs: number; scripts: Record<string, string> | null }>();

  constructor(private readonly deps: VerificationGateDeps) {}

  /** (J) 실행 전 차단이 켜져 있는가. 코덱스 훅 필수 여부·호스팅 도구 끄기·스폰 표식도 이 답을 본다. */
  isEnforced(): boolean {
    return this.deps.isEnforced ? this.deps.isEnforced() : VERIFICATION_GATE_DEFAULT_ENABLED;
  }

  /**
   * 헤드리스 클로드·코덱스 — 그 탭에서 **지금 도는 명령**의 범위로 판정하고 그 명령에 기록한다.
   * 명령을 못 찾으면 `confirmed=false` 로 판정한다(정책을 켠 동안 검증이면 거부).
   */
  checkSubAgentCall(subAgentId: string | undefined, input: VerificationCallInput): VerificationDecision {
    const cmd = subAgentId ? this.deps.findExecutingCommand(subAgentId) : undefined;
    return this.checkCommandCall(cmd, input);
  }

  /** 명령을 이미 쥔 자리(로컬 `requestTool`) — 그 명령으로 판정하고 기록한다. */
  checkCommandCall(cmd: QueuedCommand | undefined, input: VerificationCallInput): VerificationDecision {
    if (cmd) cmd.verification = markVerificationEdited(cmd.verification, input.toolName, input.toolInput);
    const decision = decideVerificationCall({
      hits: this.classify(input),
      ...(cmd?.verificationScope ? { scope: cmd.verificationScope } : {}),
      ...(cmd?.verification ? { summary: cmd.verification } : {}),
      ...(typeof cmd?.startedAt === 'number' ? { startedAt: cmd.startedAt } : {}),
      now: this.now(),
      confirmed: !!cmd,
      enforced: this.isEnforced(),
    });
    if (cmd) cmd.verification = applyVerificationDecision(cmd.verification, decision);
    return decision;
  }

  /**
   * 전용 검증 경로(앱 검증 MCP) — 그 검증 실행의 명령이 돌고 있고, 이 종류들이 열려 있는가. 기록은 하지 않는다
   * (같은 호출이 이미 권한 창구를 지나며 적혔다). 차단을 꺼 두면(J) 그 명령이 돌고 있는지만 본다.
   */
  commandAllows(cmd: QueuedCommand | undefined, kinds: readonly VerificationPolicyKind[]): boolean {
    if (!cmd || cmd.status !== 'executing') return false;
    return !this.isEnforced() || verificationScopeAllows(cmd.verificationScope, kinds);
  }

  // ── CMD 터미널 턴 ──────────────────────────────────────────────────────────

  /** 사람이 터미널에 친 문장으로 그 탭의 새 턴을 연다. 이전 턴의 권한은 승계하지 않는다. */
  beginCmdTurn(subAgentId: string, prompt: string): VerificationScope | undefined {
    const scope = verificationScopeFromText(prompt);
    if (this.cmdTurns.size >= VERIFICATION_CMD_TURN_MAX && !this.cmdTurns.has(subAgentId)) {
      const oldest = this.cmdTurns.keys().next().value;
      if (oldest !== undefined) this.cmdTurns.delete(oldest);
    }
    this.cmdTurns.delete(subAgentId);
    this.cmdTurns.set(subAgentId, { ...(scope ? { scope } : {}), startedAt: this.now() });
    return scope;
  }

  /** 턴 끝(`Stop`·`StopFailure`·`SessionEnd`) — 그 턴의 권한은 여기서 만료된다. */
  endCmdTurn(subAgentId: string): void {
    this.cmdTurns.delete(subAgentId);
  }

  /** CMD도 매 턴 현재 설정을 받는다. 이미 열린 터미널의 오래된 규칙 파일에만 의존하지 않는다. */
  cmdTurnStateLine(subAgentId: string): string {
    const turn = this.cmdTurns.get(subAgentId);
    const opts = { enforced: this.isEnforced() };
    return buildVerificationPolicyRules(opts) + buildVerificationStateLine(turn?.scope, turn?.summary, opts);
  }

  /** CMD 터미널의 도구 호출. 정책을 켠 동안 턴이 없으면(문장을 못 받음) 검증은 거부한다. */
  checkCmdCall(subAgentId: string, input: VerificationCallInput): VerificationDecision {
    const turn = this.cmdTurns.get(subAgentId);
    if (turn) turn.summary = markVerificationEdited(turn.summary, input.toolName, input.toolInput);
    const decision = decideVerificationCall({
      hits: this.classify(input),
      ...(turn?.scope ? { scope: turn.scope } : {}),
      ...(turn?.summary ? { summary: turn.summary } : {}),
      ...(turn ? { startedAt: turn.startedAt } : {}),
      now: this.now(),
      confirmed: !!turn,
      enforced: this.isEnforced(),
    });
    if (turn) turn.summary = applyVerificationDecision(turn.summary, decision);
    return decision;
  }

  // ── 내부 ──────────────────────────────────────────────────────────────────

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private classify(input: VerificationCallInput) {
    const cwd = input.cwd ?? undefined;
    return classifyVerificationCall(input.toolName, input.toolInput ?? {}, {
      resolveScript: (name, dir) => this.resolveScript(cwd, name, dir),
    });
  }

  private resolveScript(cwd: string | undefined, name: string, dir: string | undefined): string | undefined {
    if (!cwd) return undefined;
    const platform = this.deps.platform ?? process.platform;
    // git bash 가 넘기는 msys 경로(`/c/work`)는 Windows 에서 드라이브 경로로 읽어야 같은 폴더다.
    const native = dir && platform === 'win32' ? dir.replace(/^\/([A-Za-z])\//, '$1:/') : dir;
    const base = native ? path.resolve(cwd, native) : cwd;
    const body = this.readScripts(base)?.[name];
    return typeof body === 'string' ? body : undefined;
  }

  private readScripts(dir: string): Record<string, string> | null {
    const file = path.join(dir, 'package.json');
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(file).mtimeMs;
    } catch {
      return null;
    }
    const cached = this.scriptCache.get(file);
    if (cached && cached.mtimeMs === mtimeMs) return cached.scripts;
    let scripts: Record<string, string> | null = null;
    try {
      const json = JSON.parse(fs.readFileSync(file, 'utf8')) as { scripts?: unknown };
      if (json && typeof json.scripts === 'object' && json.scripts !== null) {
        scripts = {};
        for (const [key, value] of Object.entries(json.scripts as Record<string, unknown>)) {
          if (typeof value === 'string') scripts[key] = value;
        }
      }
    } catch {
      scripts = null;
    }
    if (!this.scriptCache.has(file) && this.scriptCache.size >= VERIFICATION_SCRIPT_CACHE_MAX) {
      const oldest = this.scriptCache.keys().next().value;
      if (oldest !== undefined) this.scriptCache.delete(oldest);
    }
    this.scriptCache.set(file, { mtimeMs, scripts });
    return scripts;
  }
}
