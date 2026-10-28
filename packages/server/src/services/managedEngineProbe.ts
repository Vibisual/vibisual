import { spawn } from 'node:child_process';
import path from 'node:path';
import {
  AVAILABLE_PERMISSION_MODES,
  CLAUDE_MANAGED_SPAWN_ENV,
  CODEX_MANAGED_TUI_ARGS,
  MANAGED_ENGINE_PROBE_CONCURRENCY,
  MANAGED_ENGINE_PROBE_TIMEOUT_MS,
  resolveCodexPermission,
  toCliPermissionMode,
  type ManagedEngineId,
} from '@vibisual/shared';
import { buildCliInvocation } from './claudeCliRun.js';
import { killTree, processGroupSpawnOptions } from './processTree.js';

/**
 * §4 (앱 전용 엔진) ③ — 판을 바꾸기 전에 우리 인자를 받는지 잰다. CLI 는 모르는 플래그에서 죽는다(플래그 하나가 사라지면 그 스폰이 전부 못 뜬다).
 * Claude: `<플래그> [값] --print` 를 프롬프트 없이 — `unknown option`·`is invalid` 만 탈락, 실행 단계 오류는 통과(`--version`·`--help` 는 검증 전에 끝나 못 쓴다).
 * 코덱스(clap): 조합 끝에 `--help` — 종료 0 이면 통과, `unexpected argument` 면 탈락.
 * 빈 임시 설정 홈(`CLAUDE_CONFIG_DIR`·`CODEX_HOME`)에서 자체 갱신을 끄고 돈다 — 사용자 설정을 건드리지 않고 프로브 탭도 안 생긴다.
 */

export interface EngineProbeCase {
  /** 사람이 읽는 이름 — 떨어졌을 때 Version 탭에 그대로 적힌다. */
  label: string;
  /** 띄울 인자(Claude 는 `--print` 를 러너가 붙인다 · 코덱스는 `--help` 까지 들어 있다). */
  args: string[];
  /** 값이 선택지라 "값이 틀렸다"(`is invalid`)도 탈락으로 볼지. */
  strictValue: boolean;
  /** 하위 명령 점검이라 `--print` 를 붙이지 않는다(그 하위 명령은 `--print` 를 모른다). */
  raw?: boolean;
}

function lenient(flag: string, value?: string): EngineProbeCase {
  return { label: value === undefined ? flag : `${flag} ${value}`, args: value === undefined ? [flag] : [flag, value], strictValue: false };
}
function strict(flag: string, value: string): EngineProbeCase {
  return { label: `${flag} ${value}`, args: [flag, value], strictValue: true };
}

/** 같은 판정을 두 번 띄우지 않게 라벨로 거른다. */
function uniqueCases(cases: EngineProbeCase[]): EngineProbeCase[] {
  const seen = new Set<string>();
  return cases.filter((c) => (seen.has(c.label) ? false : (seen.add(c.label), true)));
}

/**
 * claude 에 넘길 수 있는 **모든** 플래그. 스폰 코드에 플래그를 달면 여기도 넣는다(`managedEngineProbe.test.ts` 가 표 밖을 막는다).
 * `--bg` 는 상주 프로세스를 띄워 빼 둔다(`CLAUDE_PROBE_EXEMPT_FLAGS`). `scratchDir` = 경로 플래그가 가리킬 빈 폴더.
 */
export function claudeFlagProbeCases(scratchDir: string): EngineProbeCase[] {
  const cliPermissionModes = [
    ...new Set(AVAILABLE_PERMISSION_MODES.map((m) => toCliPermissionMode(m)).filter((v): v is string => !!v)),
  ];
  return uniqueCases([
    lenient('--model', 'sonnet'),
    ...cliPermissionModes.map((m) => strict('--permission-mode', m)),
    lenient('--dangerously-skip-permissions'),
    lenient('--effort', 'high'),
    lenient('--tools', 'Read,Edit'),
    lenient('--disallowedTools', 'Bash'),
    lenient('--allowedTools', 'Read'),
    lenient('--mcp-config', path.join(scratchDir, 'mcp.json')),
    lenient('--settings', path.join(scratchDir, 'settings.json')),
    lenient('--worktree'),
    strict('--system-prompt-snapshot', 'off'),
    lenient('--exclude-dynamic-system-prompt-sections'),
    strict('--setting-sources', 'user,project,local'),
    lenient('--safe-mode'),
    lenient('--betas', 'probe'),
    lenient('--append-system-prompt', 'probe'),
    lenient('--agents', JSON.stringify({ probe: { description: 'probe', prompt: 'probe' } })),
    lenient('--plugin-dir', scratchDir),
    lenient('--add-dir', scratchDir),
    lenient('--resume', '00000000-0000-4000-8000-000000000000'),
    strict('--output-format', 'stream-json'),
    strict('--output-format', 'json'),
    strict('--output-format', 'text'),
    strict('--input-format', 'stream-json'),
    lenient('--verbose'),
    lenient('--include-partial-messages'),
    lenient('--include-hook-events'),
    lenient('--replay-user-messages'),
    lenient('--forward-subagent-text'),
    lenient('--prompt-suggestions', 'true'),
    lenient('--fallback-model', 'haiku'),
    lenient('--max-budget-usd', '1'),
    lenient('--max-turns', '1'),
  ]);
}

/**
 * claude 하위 명령(`--print` 를 몰라 그대로 띄운다). 빈 설정 홈 + 없는 플러그인 이름 — `unknown option`·`unknown command` 만 탈락.
 * `auth logout` 은 빼 둔다 — mac 은 자격 증명이 키체인에 있어 빈 홈에서도 실제 로그인을 지운다.
 */
export function claudeSubcommandProbeCases(scratchDir: string): EngineProbeCase[] {
  const id = 'vibisual-probe@vibisual-probe-none';
  const raw = (label: string, args: string[]): EngineProbeCase => ({ label, args, strictValue: false, raw: true });
  return [
    raw('auth status --json', ['auth', 'status', '--json']),
    raw('plugin list --json --available', ['plugin', 'list', '--json', '--available']),
    raw('plugin enable --scope', ['plugin', 'enable', id, '--scope', 'project']),
    raw('plugin disable --scope', ['plugin', 'disable', id, '--scope', 'project']),
    raw('plugin install --scope --yes', ['plugin', 'install', id, '--scope', 'project', '--yes']),
    raw('plugin uninstall --scope --yes', ['plugin', 'uninstall', id, '--scope', 'project', '--yes']),
    raw('plugin update --scope --yes', ['plugin', 'update', id, '--scope', 'project', '--yes']),
    raw('plugin marketplace add', ['plugin', 'marketplace', 'add', scratchDir]),
    raw('plugin marketplace remove', ['plugin', 'marketplace', 'remove', 'vibisual-probe-none']),
    raw('plugin marketplace update', ['plugin', 'marketplace', 'update']),
  ];
}

/** 점검하지 않는 claude 하위 명령과 그 이유. */
export const CLAUDE_PROBE_EXEMPT_SUBCOMMANDS: Readonly<Record<string, string>> = {
  'auth logout': 'mac 키체인의 실제 로그인을 지울 수 있다',
  'stop / rm (Agent View)': '상주 감독 프로세스에 닿는다',
};

/** 점검하지 않는 claude 플래그와 그 이유 — 시험이 이 목록 밖의 미점검 플래그를 막는다. */
export const CLAUDE_PROBE_EXEMPT_FLAGS: Readonly<Record<string, string>> = {
  '--bg': 'Agent View 상주 감독 프로세스를 띄운다',
  '--print': '모든 점검이 이미 싣는다',
  '--version': '판 확인으로 따로 잰다',
  '--help': '옵션 검증 전에 끝나 판정에 못 쓴다',
};

/**
 * 우리 코드가 codex 에 넘기는 하위 명령 · 플래그 조합(`codexRunner` · `codexReviewService` · `codexCli` · CMD).
 * 샌드박스 값은 권한 변환표(`resolveCodexPermission`)가 낼 수 있는 값 전부를 본다 — 코덱스 쪽도 선택지다.
 */
export function codexProbeCases(scratchDir: string): EngineProbeCase[] {
  const sandboxes = [...new Set(AVAILABLE_PERMISSION_MODES.map((m) => resolveCodexPermission(m).sandbox))];
  const approvals = [...new Set(AVAILABLE_PERMISSION_MODES.map((m) => resolveCodexPermission(m).approval))];
  const execBase = ['exec', '-C', scratchDir, '-s', sandboxes[0] ?? 'read-only'];
  const execTail = ['--json', '--skip-git-repo-check', '-m', 'probe', '-c', `approval_policy=${approvals[0] ?? 'never'}`];
  const help = (label: string, args: string[]): EngineProbeCase => ({ label, args: [...args, '--help'], strictValue: true });
  return uniqueCases([
    help('exec', [...execBase, ...execTail]),
    ...sandboxes.map((s) => help(`exec -s ${s}`, ['exec', '-s', s])),
    help('exec resume', [...execBase, 'resume', ...execTail]),
    help('review --uncommitted', ['review', '--uncommitted', '-c', `sandbox_mode=${sandboxes[0] ?? 'read-only'}`]),
    help('review --base', ['review', '--base', 'main']),
    help('review --commit', ['review', '--commit', 'HEAD']),
    help('app-server', ['app-server']),
    help('login', ['login']),
    help('login --device-auth', ['login', '--device-auth']),
    help('login status', ['login', 'status']),
    help('logout', ['logout']),
    help(CODEX_MANAGED_TUI_ARGS.join(' '), [...CODEX_MANAGED_TUI_ARGS]),
  ]);
}

/**
 * 거부 문구 판정(commander·clap) — `error:` 줄에서만 찾는다. 2026-10-26 실측: Claude 2.1.310 `error: unknown option '--x'`·`… is invalid. Allowed choices …`,
 * 코덱스 0.164.0 `error: invalid value 'x' for '--sandbox <SANDBOX_MODE>'`.
 * 출력 전체를 보면 도움말의 `[possible values: …]` 가 거부로 읽혀 멀쩡한 판이 떨어진다(코덱스 14개 중 7개).
 */
export function probeRejected(output: string, strictValue: boolean): boolean {
  const errorLines = output.split(/\r?\n/).filter((line) => /^\s*error:/i.test(line)).join('\n');
  if (!errorLines) return false;
  if (/unknown option|unknown argument|unknown command|unexpected argument|unrecognized (?:option|argument|subcommand)/i.test(errorLines)) return true;
  if (!strictValue) return false;
  return /argument .* is invalid|is invalid\. Allowed choices|invalid value .* for/i.test(errorLines);
}

/** 떨어진 까닭으로 적을 한 줄 — `error:` 줄이 있으면 그것, 없으면 첫 글줄. */
function rejectionReason(output: string): string {
  const lines = output.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
  return (lines.find((l) => /^\s*error:/i.test(l)) ?? lines[0] ?? '').trim().slice(0, 200);
}

export interface ProbeOutcome {
  /** 떨어진 점검(라벨 · 이유). 비면 통과. */
  failures: Array<{ label: string; reason: string }>;
}

export interface ProbeRunOptions {
  /** 점검 실행에 쓸 빈 설정 홈 — Claude 는 `CLAUDE_CONFIG_DIR`, 코덱스는 `CODEX_HOME` 으로 들어간다. */
  isolatedHome: string;
  /** 점검마다 cwd 로 쓸 빈 폴더. */
  scratchDir: string;
  timeoutMs?: number;
  concurrency?: number;
  platform?: NodeJS.Platform;
}

/** 점검 한 번의 결과(실행기가 돌려준다). */
export interface ProbeExecResult { code: number | null; out: string; timedOut: boolean; spawnError?: string }
type RunResult = ProbeExecResult;

function runOnce(bin: string, args: string[], env: NodeJS.ProcessEnv, cwd: string, timeoutMs: number, platform: NodeJS.Platform): Promise<RunResult> {
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const finish = (r: RunResult): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    let child: ReturnType<typeof spawn>;
    try {
      const invocation = buildCliInvocation(bin, args, platform);
      child = spawn(invocation.file, invocation.args, {
        cwd,
        env,
        shell: invocation.shell,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        // POSIX 한정 detached — 대개 인자 검증에서 바로 끝나지만, 받아들인 하위 명령(`plugin install` 등)은 다음 일을
        //   하다 시간 상한에 걸려 아래 `killTree` 로 끊긴다. 그룹 리더가 아니면 `-pid` 가 ESRCH 로 떨어져
        //   그 사이 띄운 손자가 mac/linux 에서 남는다. win 은 빈 객체(`taskkill /T` 가 트리를 회수한다).
        ...processGroupSpawnOptions(platform),
      });
    } catch (err) {
      finish({ code: null, out: '', timedOut: false, spawnError: err instanceof Error ? err.message : String(err) });
      return;
    }
    const timer = setTimeout(() => {
      killTree(child.pid, platform);
      finish({ code: null, out, timedOut: true });
    }, timeoutMs);
    child.stdout?.on('data', (c) => { out += String(c); });
    child.stderr?.on('data', (c) => { out += String(c); });
    child.on('error', (err) => {
      clearTimeout(timer);
      finish({ code: null, out, timedOut: false, spawnError: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish({ code, out, timedOut: false });
    });
  });
}

/** 점검 환경 — 사용자의 환경 위에 빈 설정 홈과 갱신 끄기만 얹는다(인증 변수 등은 그대로 — 파싱만 본다). */
export function probeEnvFor(engine: ManagedEngineId, isolatedHome: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return engine === 'claude'
    ? { ...base, ...CLAUDE_MANAGED_SPAWN_ENV, CLAUDE_CONFIG_DIR: isolatedHome }
    : { ...base, CODEX_HOME: isolatedHome };
}

/** `--version` 출력이 그 판을 말하는가. */
export async function probeEngineVersion(
  engine: ManagedEngineId,
  bin: string,
  expectedVersion: string,
  opts: ProbeRunOptions,
): Promise<string | null> {
  const platform = opts.platform ?? process.platform;
  const r = await runOnce(bin, ['--version'], probeEnvFor(engine, opts.isolatedHome), opts.scratchDir, opts.timeoutMs ?? MANAGED_ENGINE_PROBE_TIMEOUT_MS, platform);
  if (r.spawnError) return `--version: ${r.spawnError}`;
  if (r.timedOut) return '--version: timed out';
  if (!r.out.includes(expectedVersion)) return `--version printed "${r.out.trim().slice(0, 80)}" (expected ${expectedVersion})`;
  return null;
}

/** 점검을 모두 돌린다(동시 `concurrency` 개). 하나라도 떨어지면 그 판은 바꾸지 않는다. */
export async function runEngineProbes(
  engine: ManagedEngineId,
  bin: string,
  cases: readonly EngineProbeCase[],
  opts: ProbeRunOptions,
): Promise<ProbeOutcome> {
  const platform = opts.platform ?? process.platform;
  const env = probeEnvFor(engine, opts.isolatedHome);
  const timeoutMs = opts.timeoutMs ?? MANAGED_ENGINE_PROBE_TIMEOUT_MS;
  return evaluateProbeCases(
    engine,
    cases,
    (args) => runOnce(bin, args, env, opts.scratchDir, timeoutMs, platform),
    opts.concurrency ?? MANAGED_ENGINE_PROBE_CONCURRENCY,
  );
}

/** 실행기를 인자로 받는다 — 시험이 실행본 없이 판정 규칙(거부 문구·시간 초과·코덱스 종료 코드)을 본다. */
export async function evaluateProbeCases(
  engine: ManagedEngineId,
  cases: readonly EngineProbeCase[],
  exec: (args: string[]) => Promise<ProbeExecResult>,
  concurrency: number = MANAGED_ENGINE_PROBE_CONCURRENCY,
): Promise<ProbeOutcome> {
  const failures: ProbeOutcome['failures'] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < cases.length) {
      const c = cases[next];
      next += 1;
      if (!c) continue;
      const args = engine === 'claude' && !c.raw ? [...c.args, '--print'] : c.args;
      const r = await exec(args);
      if (r.spawnError) {
        failures.push({ label: c.label, reason: r.spawnError });
      } else if (engine === 'codex') {
        // 코덱스는 모든 점검이 `--help` 로 끝난다 — clap 은 앞의 인자를 다 받아들였을 때만 도움말을 내고 종료 0 이다.
        //   판정은 종료 코드 하나다(도움말 본문의 `[possible values: …]` 줄을 거부로 읽지 않는다).
        if (!r.timedOut && r.code !== 0) {
          failures.push({ label: c.label, reason: `exit ${String(r.code)}: ${rejectionReason(r.out) || 'no output'}`.slice(0, 200) });
        }
      } else if (probeRejected(r.out, c.strictValue)) {
        failures.push({ label: c.label, reason: rejectionReason(r.out) || 'rejected' });
      }
      // 시간 초과는 탈락이 아니다 — 인자 검증은 시작하자마자 끝나므로 안 끝났으면 인자를 받고 다른 일을 하던 것이다. 안 뜨는 판은 `--version` 확인이 잡는다.
    }
  };
  const n = Math.max(1, Math.min(concurrency, cases.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return { failures };
}
