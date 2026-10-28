import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AVAILABLE_PERMISSION_MODES, CLAUDE_MANAGED_SPAWN_ENV, resolveCodexPermission, toCliPermissionMode } from '@vibisual/shared';
import {
  CLAUDE_PROBE_EXEMPT_FLAGS,
  claudeFlagProbeCases,
  claudeSubcommandProbeCases,
  codexProbeCases,
  evaluateProbeCases,
  probeEnvFor,
  probeRejected,
  type ProbeExecResult,
} from './managedEngineProbe.js';

/** §4 (앱 전용 엔진) ③ — 판을 바꾸기 전 점검 시험: 판정 규칙과 "우리가 넘기는 플래그를 전부 본다"를 못 박는다. */

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRATCH = path.join('probe', 'scratch');

/** 주석을 걷고 따옴표 안의 `--플래그` 글자만 뽑는다(주석에 적힌 옛 플래그 · 설명은 대상이 아니다). */
function flagLiterals(file: string): string[] {
  const src = fs.readFileSync(path.join(here, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  return [...new Set([...src.matchAll(/['"`](--[a-zA-Z][a-zA-Z-]*)['"`]/g)].map((m) => m[1] ?? ''))].filter(Boolean).sort();
}

describe('거부 판정 — "이 인자를 모른다"만 탈락이다', () => {
  it('Claude(commander)의 모르는 플래그는 언제나 탈락', () => {
    expect(probeRejected("error: unknown option '--isolation'", false)).toBe(true);
    expect(probeRejected("error: unknown command 'marketplace'", false)).toBe(true);
  });

  it('선택지 밖 값은 선택지 플래그에서만 탈락', () => {
    const out = "error: option '--permission-mode <mode>' argument 'manualx' is invalid. Allowed choices are acceptEdits, auto.";
    expect(probeRejected(out, true)).toBe(true);
    expect(probeRejected(out, false)).toBe(false);
  });

  it('인자를 받아들인 뒤의 실행 단계 오류는 통과', () => {
    expect(probeRejected('Error: Input must be provided either through stdin or as a prompt argument when using --print', true)).toBe(false);
    expect(probeRejected('fatal: not a git repository', true)).toBe(false);
    expect(probeRejected('Plugin "vibisual-probe" not found', false)).toBe(false);
  });

  it('코덱스(clap)의 모르는 인자 · 틀린 값도 탈락', () => {
    expect(probeRejected("error: unexpected argument '--foo' found", true)).toBe(true);
    expect(probeRejected("error: invalid value 'x' for '--sandbox <SANDBOX_MODE>'\n  [possible values: read-only]", true)).toBe(true);
  });

  it('도움말 본문의 `[possible values: …]` 줄은 거부가 아니다 — 코덱스 0.164.0 이 이 줄로 7개를 떨어졌다(2026-10-26)', () => {
    const help = [
      'Run Codex non-interactively',
      '',
      'Options:',
      '  -s, --sandbox <SANDBOX_MODE>',
      '          Select the sandbox policy to use when executing model-generated shell commands',
      '',
      '          [possible values: read-only, workspace-write, danger-full-access]',
      '      --color <COLOR>',
      '          [default: auto]',
      '          [possible values: always, never, auto]',
    ].join('\n');
    expect(probeRejected(help, true)).toBe(false);
    expect(probeRejected(help, false)).toBe(false);
  });

  it('거부 낱말이 `error:` 줄 밖(목록 · 설명 글)에 있으면 거부가 아니다', () => {
    expect(probeRejected('{"plugins":[{"description":"warns on unknown option names"}]}', false)).toBe(false);
    expect(probeRejected('Error: Input must be provided either through stdin or as a prompt argument when using --print', true)).toBe(false);
  });
});

describe('Claude 점검 목록 — 우리가 넘길 수 있는 플래그 전부', () => {
  const cases = claudeFlagProbeCases(SCRATCH);
  const flags = new Set(cases.map((c) => c.args[0]));

  it('권한 모드는 변환표가 낼 수 있는 값을 전부 선택지로 본다', () => {
    const want = [...new Set(AVAILABLE_PERMISSION_MODES.map((m) => toCliPermissionMode(m)).filter(Boolean))];
    const got = cases.filter((c) => c.args[0] === '--permission-mode');
    expect(got.map((c) => c.args[1]).sort()).toEqual([...want].sort());
    expect(got.every((c) => c.strictValue)).toBe(true);
    expect(want).toContain('manual'); // 'default' 는 CLI 로 나갈 때 manual 이다
  });

  it('값이 선택지인 플래그는 그 값까지 본다', () => {
    for (const f of ['--system-prompt-snapshot', '--setting-sources', '--input-format', '--output-format']) {
      expect(cases.filter((c) => c.args[0] === f).every((c) => c.strictValue)).toBe(true);
    }
  });

  it('Agent View 의 `--bg` 는 상주 감독 프로세스를 띄우므로 점검하지 않고, 그 이유가 적혀 있다', () => {
    expect(flags.has('--bg')).toBe(false);
    expect(CLAUDE_PROBE_EXEMPT_FLAGS['--bg']).toBeTruthy();
  });

  it.each([
    'subAgentManager.ts',
    'contiManager.ts',
    'feedbackDistillService.ts',
    'sessionDiscovery.ts',
    'claudeAgentViewService.ts',
    'backgroundTaskProbe.ts',
    'sessionLivenessProbe.ts',
    'claudeUsageProbe.ts',
  ])('%s 가 내는 플래그는 전부 점검 목록에 있다 — 새 플래그를 달면 목록도 함께 고친다', (file) => {
    const missing = flagLiterals(file).filter((f) => !flags.has(f) && !(f in CLAUDE_PROBE_EXEMPT_FLAGS));
    expect(missing).toEqual([]);
  });

  it.each(['claudeAuthService.ts', 'claudePluginService.ts'])('%s 의 하위 명령 플래그도 하위 명령 점검에 있다', (file) => {
    const sub = claudeSubcommandProbeCases(SCRATCH);
    const seen = new Set(sub.flatMap((c) => c.args.filter((a) => a.startsWith('--'))));
    expect(flagLiterals(file).filter((f) => !seen.has(f))).toEqual([]);
    expect(sub.every((c) => c.raw)).toBe(true);
  });

  it('auth logout 은 점검하지 않는다 — mac 키체인의 실제 로그인을 지울 수 있다', () => {
    expect(claudeSubcommandProbeCases(SCRATCH).some((c) => c.args[0] === 'auth' && c.args[1] === 'logout')).toBe(false);
  });
});

describe('코덱스 점검 목록 — 우리가 쓰는 하위 명령 · 플래그 조합', () => {
  const cases = codexProbeCases(SCRATCH);
  const allArgs = new Set(cases.flatMap((c) => c.args));

  it('모든 점검은 `--help` 로 끝나 종료 0 이어야 한다(clap 은 앞의 인자를 먼저 검증한다)', () => {
    expect(cases.every((c) => c.args[c.args.length - 1] === '--help')).toBe(true);
  });

  it('샌드박스는 권한 변환표가 낼 수 있는 값을 전부 본다', () => {
    const want = [...new Set(AVAILABLE_PERMISSION_MODES.map((m) => resolveCodexPermission(m).sandbox))];
    for (const s of want) expect(cases.some((c) => c.args.includes('-s') && c.args.includes(s))).toBe(true);
  });

  it.each(['codexRunner.ts', 'codexReviewService.ts'])('%s 의 플래그는 전부 점검에 있다', (file) => {
    expect(flagLiterals(file).filter((f) => !allArgs.has(f))).toEqual([]);
  });

  it('exec 의 짧은 플래그(-C · -s · -m · -c)와 resume 조합도 본다', () => {
    const exec = cases.find((c) => c.label === 'exec');
    for (const f of ['-C', '-s', '-m', '-c', '--json', '--skip-git-repo-check']) expect(exec?.args).toContain(f);
    expect(cases.find((c) => c.label === 'exec resume')?.args).toContain('resume');
  });
});

describe('판정 실행 — 하나라도 떨어지면 그 판은 바꾸지 않는다', () => {
  const ok: ProbeExecResult = { code: 1, out: 'Error: Input must be provided', timedOut: false };

  it('Claude 는 `--print` 를 붙여 띄우고, 하위 명령 점검에는 붙이지 않는다', async () => {
    const seen: string[][] = [];
    const cases = [...claudeFlagProbeCases(SCRATCH).slice(0, 2), ...claudeSubcommandProbeCases(SCRATCH).slice(0, 1)];
    const out = await evaluateProbeCases('claude', cases, async (args) => { seen.push(args); return ok; }, 1);
    expect(out.failures).toEqual([]);
    expect(seen[0]?.[seen[0].length - 1]).toBe('--print');
    expect(seen[2]).toEqual(['auth', 'status', '--json']);
  });

  it('모르는 플래그 · 실행 실패는 이유와 함께 떨어진다', async () => {
    const cases = claudeFlagProbeCases(SCRATCH).slice(0, 2);
    const results: ProbeExecResult[] = [
      { code: 1, out: "error: unknown option '--model'", timedOut: false },
      { code: null, out: '', timedOut: false, spawnError: 'EACCES' },
    ];
    let i = 0;
    const out = await evaluateProbeCases('claude', cases, async () => results[i++] ?? ok, 1);
    expect(out.failures.map((f) => f.reason)).toEqual(["error: unknown option '--model'", 'EACCES']);
  });

  it('시간 초과는 탈락이 아니다 — 인자 검증은 시작하자마자 끝나므로, 끝나지 않았다는 것은 받아들였다는 뜻이다', async () => {
    const timedOut: ProbeExecResult = { code: null, out: '', timedOut: true };
    expect((await evaluateProbeCases('claude', claudeSubcommandProbeCases(SCRATCH).slice(0, 3), async () => timedOut, 1)).failures).toEqual([]);
    expect((await evaluateProbeCases('codex', codexProbeCases(SCRATCH).slice(0, 2), async () => timedOut, 1)).failures).toEqual([]);
  });

  it('코덱스는 거부 문구가 없어도 종료 코드가 0 이 아니면 떨어진다', async () => {
    const out = await evaluateProbeCases('codex', codexProbeCases(SCRATCH).slice(0, 1), async () => ({ code: 2, out: 'boom', timedOut: false }), 1);
    expect(out.failures).toHaveLength(1);
  });

  it('코덱스는 종료 0 이면 도움말에 `[possible values: …]` 가 있어도 통과다', async () => {
    const help = 'Options:\n  -s, --sandbox <SANDBOX_MODE>\n          [possible values: read-only, workspace-write, danger-full-access]\n';
    const out = await evaluateProbeCases('codex', codexProbeCases(SCRATCH), async () => ({ code: 0, out: help, timedOut: false }), 2);
    expect(out.failures).toEqual([]);
  });

  it('코덱스가 떨어지면 까닭은 `error:` 줄이다(첫 경고 줄이 아니라)', async () => {
    const out = await evaluateProbeCases('codex', codexProbeCases(SCRATCH).slice(0, 1), async () => ({
      code: 2,
      out: "WARNING: proceeding, even though we could not create PATH aliases\nerror: invalid value 'x' for '--sandbox <SANDBOX_MODE>'\n  [possible values: read-only]",
      timedOut: false,
    }), 1);
    expect(out.failures[0]?.reason).toContain("error: invalid value 'x'");
  });
});

describe('점검 프로세스 회수 — 시간 상한에 걸린 점검은 트리째 끊는다(멀티플랫폼 축 ②)', () => {
  it('POSIX 는 그룹 리더로 띄우고, 끊을 때도 그 플랫폼으로 트리를 회수한다', () => {
    const src = fs.readFileSync(path.join(here, 'managedEngineProbe.ts'), 'utf8');
    expect(src).toContain('...processGroupSpawnOptions(platform)');
    expect(src).toContain('killTree(child.pid, platform)');
  });
});

describe('점검 환경 — 빈 설정 홈 · 갱신 끄기', () => {
  it('Claude 는 CLAUDE_CONFIG_DIR 을 빈 홈으로, 엔진 자체 갱신은 끈다(사용자 훅 · 세션을 건드리지 않는다)', () => {
    const env = probeEnvFor('claude', '/tmp/iso', { PATH: '/bin' });
    expect(env).toMatchObject({ PATH: '/bin', CLAUDE_CONFIG_DIR: '/tmp/iso', ...CLAUDE_MANAGED_SPAWN_ENV });
  });

  it('코덱스는 CODEX_HOME 을 빈 홈으로', () => {
    expect(probeEnvFor('codex', '/tmp/iso', {})).toEqual({ CODEX_HOME: '/tmp/iso' });
  });
});
