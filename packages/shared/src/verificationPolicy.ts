/**
 * verificationPolicy.ts — §5.3 #12-4 · 검증은 시킬 때만 돈다.
 *
 * 간단한 수정에도 AI 가 테스트·빌드·브라우저 확인을 스스로 돌려 시간과 토큰을 썼다. 기본 정책은
 * **"검증은 사용자가 그 작업에서 명시적으로 요청했을 때만 실행"** 이고, 프롬프트와 실제 도구 실행 판정이
 * 같은 정책을 본다. 여기 사는 것은 넷이며 전부 결정적 순수 함수다(디스크·`process` 읽기 ❌ — 패키지
 * 스크립트 본문처럼 바깥에서 오는 값은 호출부가 인자로 넘긴다). 호출마다 AI 판정기를 부르지 않는다.
 *
 *  1. **분류** `classifyVerificationCall` — 이 도구 호출이 검증인가, 어떤 종류인가.
 *  2. **요청 해석** `parseVerificationRequest` — 사람이 친 문장이 검증을 요청했는가(부정·인용·문서 제외).
 *  3. **판정** `decideVerificationCall` — 그 명령에 열린 범위·횟수·시간 안인가.
 *  4. **문구** — 모델에게 주는 거부 사유 · 정책 문단 · 매 턴 권한 한 줄.
 *
 * 서버의 판정 자리 다섯(헤드리스 클로드 `/api/permission-check` · 코덱스 권한 훅 · 로컬 모델 `requestTool` ·
 * CMD 터미널 훅 · 앱 검증 MCP)이 **같은 함수**를 부른다. 두 벌이 되면 한 엔진에서만 막히고 사용자에게는
 * "켰는데 안 먹는다"로만 보인다(자물쇠 `pathLock.ts` 와 같은 규율).
 *
 * 셸 명령은 읽기·쓰기 축과 **같은 토크나이저**(`bashCommandPaths.ts`)로 자른다(§2.1 #3 — 두 벌 금지).
 */
import {
  extractBashWritePaths,
  normalizeShellCommandName,
  readHeredocDelimiter,
  splitShellSegments,
  tokenizeShellCommand,
} from './bashCommandPaths.js';
import type {
  CommandVerificationSummary,
  VerificationPolicyKind,
  VerificationScope,
} from './types.js';

type Kind = VerificationPolicyKind;

// ─────────────────────────────────────────────────────────────────────────────
// 설정 — 값은 전부 여기(§3.3 매직넘버 금지)
// ─────────────────────────────────────────────────────────────────────────────

/** 앱이 "검증"으로 세는 종류 전부(표시 순서). */
export const VERIFICATION_POLICY_KINDS: readonly Kind[] = ['test', 'lint', 'typecheck', 'build', 'e2e', 'browser', 'screenshot', 'agent'];

/** "검증해 줘"처럼 종류 없이 부를 때 여는 범위 — 브라우저·E2E·스크린샷·검증 에이전트는 따로 말해야 한다. */
export const VERIFICATION_GENERIC_KINDS: readonly Kind[] = ['test', 'typecheck', 'lint', 'build'];

/** 결과 줄 [검증 실행] 버튼이 여는 범위 — 변경과 관련된 코드 검증. */
export const VERIFICATION_BUTTON_KINDS: readonly Kind[] = ['test', 'typecheck', 'lint', 'build'];

/** 검증 뷰(§5.5 #17-35)의 실행이 여는 범위 — 사람이 고른 화면을 앱 검증 도구로 직접 조작한다. */
export const VERIFICATION_APP_RUN_KINDS: readonly Kind[] = ['browser', 'screenshot'];

/** 한 명령에서 종류별로 실행을 허락하는 횟수(첫 실행 + 고친 뒤 확인 + 잘못 부른 한 번). */
export const VERIFICATION_GRANT_RUNS_PER_KIND = 3;

/** 한 명령에서 실행을 허락하는 검증 호출 합계 — 무한 재실행을 끊는 상한. */
export const VERIFICATION_GRANT_RUNS_TOTAL = 6;

/** 명령이 시작된 뒤 검증 권한이 유효한 시간. 그 명령이 끝나면 이보다 먼저 만료된다. */
export const VERIFICATION_GRANT_MAX_AGE_MS = 3 * 60 * 60 * 1000;

/** 권한을 세운 사용자 문장을 남기는 길이 상한. */
export const VERIFICATION_EVIDENCE_MAX = 200;

/** 요청 해석이 읽는 본문 상한(그 뒤는 보지 않는다 — 긴 붙여넣기는 대개 문서다). */
export const VERIFICATION_REQUEST_SCAN_MAX = 20_000;

/** 이 길이 이하의 인라인 코드·따옴표는 "그 명령"이라는 목적어로 남긴다. 더 길면 인용으로 보고 걷는다. */
export const VERIFICATION_QUOTE_OBJECT_MAX = 80;

/** 이 줄 수 이상인 문단은 문서처럼 다룬다(부름 표지가 있는 절만 센다). */
export const VERIFICATION_DOC_BLOCK_MIN_LINES = 4;

/** `bash -c`·패키지 스크립트·인라인 코드로 파고드는 깊이 상한(자기 자신을 부르는 스크립트의 무한 반복 차단). */
export const VERIFICATION_SHELL_DEPTH_MAX = 4;

/** 감싸개를 벗기며 파고드는 깊이 상한(셸 다시 들어가기와 따로 센다 — 감싸개는 여러 겹이 흔하다). */
export const VERIFICATION_WRAPPER_DEPTH_MAX = 8;

/** 판정 사유에 싣는 "무엇으로 읽었나" 한 줄의 길이 상한. */
export const VERIFICATION_DETAIL_MAX = 160;

/** 승인 창구가 거부할 때 싣는 약속된 사유 마커(`reason`). 문구는 `message` 로 따로 간다. */
export const VERIFICATION_DENY_REASON = 'verification';

/** 앱 검증 MCP 서버 이름(§5.5 #17-35) — 검증 실행 한 건 안의 세부 조작이라 횟수를 세지 않는다. */
export const VERIFICATION_APP_MCP_SERVER = 'vibisual_verify';

// ─────────────────────────────────────────────────────────────────────────────
// 1. 분류
// ─────────────────────────────────────────────────────────────────────────────

/** 도구 호출 하나가 검증으로 읽힌 근거. */
export interface VerificationHit {
  kind: Kind;
  /** 무엇으로 읽었나(모델·사람이 읽는 한 줄). */
  detail: string;
  /** `test` 가 전체 스위트를 돈다(관련 테스트만 열린 명령에서 거부). */
  fullSuite?: boolean;
  /** 횟수 상한을 세지 않는다 — 검증 실행 한 건 안의 세부 조작(앱 검증 MCP). */
  budgetExempt?: boolean;
}

export interface VerificationClassifyOptions {
  /**
   * 패키지 스크립트(`npm run <name>`)의 본문. `dir` 은 명령 안의 `cd`·`-C` 로 옮긴 곳(원문 그대로) —
   * 없으면 호출 cwd. 본문을 모르면 `undefined`(그때는 이름으로 판정한다).
   */
  resolveScript?: (name: string, dir?: string) => string | undefined;
}

const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** `--version`·`--help` 만 묻는 호출은 검증이 아니다(`-v` 는 넣지 않는다 — `pytest -v` 는 자세히 돌리기다). */
const VERSION_ARGS: ReadonlySet<string> = new Set(['--version', '-V', 'version', '--help', '-h', 'help', '-?', '/?']);
/** 다른 명령을 그대로 실행하는 감싸개 — 건너뛰고 안쪽을 본다. */
const PASS_THROUGH_WRAPPERS: ReadonlySet<string> = new Set([
  'time', 'nice', 'nohup', 'sudo', 'doas', 'exec', 'builtin', 'stdbuf', 'unbuffer', 'chronic', 'caffeinate',
  'ionice', 'xvfb-run', 'cross-env', 'cross-env-shell', 'dotenv', 'env-cmd', 'call', 'timeout', 'gtimeout', 'retry',
]);
/** 감싸개 뒤에서 값을 하나 더 먹는 플래그. */
const WRAPPER_VALUE_FLAGS: ReadonlySet<string> = new Set(['-n', '-u', '-g', '-e', '--env-file', '-f', '--file', '-s', '--signal', '-k', '--kill-after', '-c']);
const POSIX_SHELLS: ReadonlySet<string> = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'ash', 'git-bash']);
const POWERSHELLS: ReadonlySet<string> = new Set(['powershell', 'pwsh']);
const JS_RUNNERS: ReadonlySet<string> = new Set(['node', 'nodejs', 'tsx', 'ts-node', 'esno', 'esrun', 'vite-node', 'babel-node', 'jiti']);
const OTHER_INTERPRETERS: ReadonlySet<string> = new Set(['ruby', 'perl', 'php']);
const PACKAGE_MANAGERS: ReadonlySet<string> = new Set(['npm', 'pnpm', 'yarn', 'bun', 'deno', 'corepack']);
/** `<x> run <명령>` 꼴로 다른 명령을 띄우는 파이썬 환경 도구. */
const PY_ENV_RUNNERS: ReadonlySet<string> = new Set(['uv', 'poetry', 'pipenv', 'hatch', 'pdm', 'rye']);
const MAKE_RUNNERS: ReadonlySet<string> = new Set(['make', 'gmake', 'mingw32-make', 'nmake']);
/** 대상 이름을 받는 작업 실행기(이름이 곧 종류를 말한다). */
const NAMED_TASK_RUNNERS: ReadonlySet<string> = new Set(['just', 'task', 'invoke', 'inv', 'rake', 'gulp', 'grunt', 'mage']);
/** 인자 없이 부르면 기본 대상이 빌드인 실행기. */
const DEFAULT_BUILD_RUNNERS: ReadonlySet<string> = new Set(['gulp', 'grunt']);
/** 패키지 관리자의 자기 명령 — 스크립트 이름이 아니다. */
const PM_BUILTINS: ReadonlySet<string> = new Set([
  'install', 'i', 'add', 'ci', 'uninstall', 'remove', 'rm', 'un', 'update', 'up', 'upgrade', 'outdated', 'audit',
  'publish', 'pack', 'link', 'ln', 'unlink', 'init', 'create', 'view', 'info', 'ls', 'list', 'why', 'config', 'cache',
  'prune', 'dedupe', 'login', 'logout', 'whoami', 'version', 'help', 'doctor', 'fund', 'set', 'get', 'store', 'import',
  'patch', 'patch-commit', 'env', 'setup', 'self-update', 'start', 'restart', 'stop', 'explain', 'query', 'root', 'bin',
  'prefix', 'completion', 'licenses', 'deploy', 'fetch', 'rebuild', 'plugin', 'constraints', 'node', 'dev', 'serve',
]);
/** 이름만으로 검증인 실행 파일(서브커맨드를 봐야 하는 것은 아래 표·분기가 맡는다). */
const DIRECT_RUNNERS: Readonly<Record<string, Kind>> = {
  jest: 'test', vitest: 'test', mocha: 'test', ava: 'test', tap: 'test', tape: 'test', karma: 'test', jasmine: 'test',
  uvu: 'test', pytest: 'test', 'py.test': 'test', nose2: 'test', tox: 'test', nox: 'test', phpunit: 'test', pest: 'test',
  rspec: 'test', cucumber: 'test', 'cucumber-js': 'test', behave: 'test', ctest: 'test', 'invoke-pester': 'test',
  'test-storybook': 'test', vstest: 'test', 'vstest.console': 'test', 'jest-cli': 'test',
  playwright: 'e2e', cypress: 'e2e', testcafe: 'e2e', wdio: 'e2e', nightwatch: 'e2e', detox: 'e2e', codeceptjs: 'e2e',
  maestro: 'e2e',
  eslint: 'lint', tslint: 'lint', stylelint: 'lint', oxlint: 'lint', xo: 'lint', standard: 'lint', markdownlint: 'lint',
  'markdownlint-cli2': 'lint', shellcheck: 'lint', hadolint: 'lint', flake8: 'lint', pylint: 'lint', pycodestyle: 'lint',
  pydocstyle: 'lint', bandit: 'lint', 'golangci-lint': 'lint', staticcheck: 'lint', revive: 'lint', rubocop: 'lint',
  swiftlint: 'lint', ktlint: 'lint', detekt: 'lint', phpcs: 'lint', 'clang-tidy': 'lint', cpplint: 'lint',
  cppcheck: 'lint', knip: 'lint', 'lint-staged': 'lint', yamllint: 'lint', actionlint: 'lint', tflint: 'lint',
  htmlhint: 'lint', cspell: 'lint', textlint: 'lint', vale: 'lint',
  'vue-tsc': 'typecheck', 'svelte-check': 'typecheck', mypy: 'typecheck', pyright: 'typecheck', basedpyright: 'typecheck',
  pyre: 'typecheck', pytype: 'typecheck', phpstan: 'typecheck', psalm: 'typecheck',
  rollup: 'build', parcel: 'build', tsup: 'build', unbuild: 'build', 'electron-builder': 'build', msbuild: 'build',
  ninja: 'build', lighthouse: 'browser', 'shot-scraper': 'browser', pageres: 'browser', 'capture-website': 'browser',
  wkhtmltoimage: 'browser', screencapture: 'browser', scrot: 'browser', 'gnome-screenshot': 'browser',
  backstop: 'screenshot', backstopjs: 'screenshot', 'reg-cli': 'screenshot', 'reg-suit': 'screenshot', loki: 'screenshot',
  percy: 'screenshot', chromatic: 'screenshot', odiff: 'screenshot', pixelmatch: 'screenshot',
};
/** 서브커맨드로 종류가 갈리는 도구 — 첫 위치 인자를 본다. */
const SUBCOMMAND_TOOLS: Readonly<Record<string, Readonly<Record<string, Kind>>>> = {
  cargo: { test: 'test', nextest: 'test', bench: 'test', t: 'test', build: 'build', b: 'build', check: 'typecheck', c: 'typecheck', clippy: 'lint' },
  go: { test: 'test', build: 'build', vet: 'lint' },
  dotnet: { test: 'test', vstest: 'test', build: 'build', publish: 'build', pack: 'build', msbuild: 'build' },
  swift: { test: 'test', build: 'build' },
  flutter: { test: 'test', build: 'build', analyze: 'lint', drive: 'e2e' },
  dart: { test: 'test', analyze: 'lint', compile: 'build' },
  deno: { test: 'test', bench: 'test', lint: 'lint', check: 'typecheck', compile: 'build' },
  zig: { test: 'test', build: 'build' },
  stack: { test: 'test', build: 'build' },
  cabal: { test: 'test', build: 'build' },
  lein: { test: 'test', uberjar: 'build', jar: 'build', compile: 'build' },
  mix: { test: 'test', compile: 'build', credo: 'lint', dialyzer: 'typecheck' },
  rebar3: { eunit: 'test', ct: 'test', compile: 'build', dialyzer: 'typecheck' },
  bazel: { test: 'test', build: 'build' },
  bazelisk: { test: 'test', build: 'build' },
  buck: { test: 'test', build: 'build' },
  buck2: { test: 'test', build: 'build' },
  pants: { test: 'test', package: 'build', lint: 'lint', check: 'typecheck' },
  ng: { test: 'test', t: 'test', build: 'build', b: 'build', lint: 'lint', e2e: 'e2e' },
  next: { build: 'build', lint: 'lint' },
  nuxt: { build: 'build', generate: 'build', typecheck: 'typecheck' },
  nuxi: { build: 'build', generate: 'build', typecheck: 'typecheck' },
  astro: { build: 'build', check: 'typecheck' },
  vite: { build: 'build' },
  'vue-cli-service': { build: 'build', 'test:unit': 'test', 'test:e2e': 'e2e', lint: 'lint' },
  'react-scripts': { build: 'build', test: 'test' },
  'electron-vite': { build: 'build' },
  'electron-forge': { make: 'build', package: 'build', publish: 'build' },
  vsce: { package: 'build', publish: 'build' },
  gatsby: { build: 'build' },
  remix: { build: 'build' },
  'svelte-kit': { build: 'build' },
  storybook: { build: 'build', test: 'test' },
  playwright: { test: 'e2e', screenshot: 'browser', pdf: 'browser' },
  cypress: { run: 'e2e', open: 'e2e' },
  biome: { check: 'lint', lint: 'lint', ci: 'lint' },
  docker: { build: 'build' },
  podman: { build: 'build' },
  coverage: { run: 'test' },
  composer: { test: 'test' },
  rush: { test: 'test', build: 'build', rebuild: 'build', lint: 'lint' },
};
/** 그 자체로 화면을 여는 명령 — 루프백 주소를 열면 브라우저 확인이다. */
const BROWSER_OPENERS: ReadonlySet<string> = new Set(['open', 'xdg-open', 'start', 'explorer', 'sensible-browser', 'start-process', 'wslview', 'gio']);
const BROWSER_APPS: ReadonlySet<string> = new Set([
  'chrome', 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'msedge', 'microsoft-edge',
  'firefox', 'brave', 'brave-browser', 'opera', 'vivaldi',
]);
/** 셸 원문에서 바로 잡는 화면 캡처 호출(낱말로 잘리지 않는 인라인 스크립트 속). */
const SCREEN_CAPTURE_TEXT = /CopyFromScreen|savescreenshot|Get-Screenshot|ImageGrab\.grab|pyautogui\.screenshot/i;
/** 테스트 대상을 좁히는 플래그 — 있으면 전체 스위트가 아니다. */
const TEST_FILTER_FLAG = /^(-t|--testNamePattern|--test-name-pattern|-k|--grep|-g|--filter|--spec|--testPathPattern|--test-path-pattern|--findRelatedTests|--related|--changed|--onlyChanged|-o|--lf|--last-failed|--failed|--tests|-run|--run-tests|--project|--only|--file|--files|-m|-Dtest|--selectProjects)(=.*)?$/i;
/** 값을 하나 더 먹는 테스트 실행기 플래그(그 값을 대상 경로로 오인하지 않게). */
const TEST_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--reporter', '-r', '--config', '-c', '--maxWorkers', '-w', '--workers', '--timeout', '--retries', '--shard', '--pool',
  '--environment', '--env', '-p', '--outputFile', '--output', '--coverage.provider', '--root', '--dir', '--mode',
]);
/** 테스트 실행기의 하위 명령 낱말 — 대상이 아니다. */
const TEST_SUBCOMMAND_WORDS: ReadonlySet<string> = new Set(['run', 'watch', 'dev', 'test', 'bench', 'list', '--']);
/** 셸처럼 명령 칸을 다른 이름으로 받는 도구(코덱스·로컬). */
const SHELL_TOOL_NAMES: ReadonlySet<string> = new Set([
  'Bash', 'PowerShell', 'shell', 'shell_command', 'exec_command', 'local_shell', 'terminal', 'container.exec',
  'run_command', 'execute_command', 'write_stdin',
]);
const AGENT_TOOL_NAMES: ReadonlySet<string> = new Set(['Task', 'Agent', 'spawn_agent', 'spawn_agents_on_csv']);
/** 검증·리뷰 역할 서브에이전트 종류. */
const VERIFIER_AGENT_TYPE = /verif|tester|test[-_ ]?runner|(^|[-_ ])qa([-_ ]|$)|e2e|playwright|cypress|browser[-_ ]?test|review|critic|audit|validat/i;
/** 서브에이전트 한 줄 설명이 검증을 맡기는 꼴 — **첫 낱말**로만 본다(설명 안의 낱말은 맥락이 다르다). */
const VERIFY_TASK_DESCRIPTION = /^(?:(?:run|execute|re-?run)\b[^.\n]{0,40}\b(?:tests?|specs?|lint|type-?checks?|builds?|e2e)\b|(?:verify|validate|qa|test|review|critique)\b|(?:검증|검수|리뷰|테스트\s*실행|브라우저\s*(?:확인|테스트)))|(?:검증|검수|리뷰|테스트\s*실행)\s*$/i;
/** 스킬 이름 → 종류(`/verify` 는 앱을 띄워 보는 번들 스킬, `run` 은 앱 실행 확인). */
const SKILL_KINDS: readonly (readonly [RegExp, Kind])[] = [
  [/^(verify|verification)$/i, 'browser'],
  [/^run$/i, 'browser'],
  [/(^|[-_])(e2e|playwright|cypress|webapp-testing)([-_]|$)/i, 'e2e'],
  [/(^|[-_])(qa|test|tests|testing)([-_]|$)/i, 'test'],
  [/(^|[-_])(review|code-review|security-review|critique)([-_]|$)/i, 'agent'],
  [/^lint$/i, 'lint'],
  [/^typecheck$/i, 'typecheck'],
  [/^build$/i, 'build'],
];
/** 브라우저·데스크톱을 조작하는 MCP 서버(그 안의 캡처도 "보는 것"이라 브라우저 확인으로 센다). */
const BROWSER_MCP_SERVER = /playwright|puppeteer|chrome[-_]?devtools|browser|claude[-_]?in[-_]?chrome|selenium|webdriver|browserbase|stagehand|computer[-_]?use|^(claude[-_])?preview$/i;
const TESTING_MCP_SERVER = /(^|[-_])(e2e|qa|testing|testsprite)([-_]|$)/i;
const LOOPBACK_URL = /^(?:https?:\/\/)?(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\]|::1|[\w-]+\.localhost)(?::\d+)?(?:[/?#]|$)/i;
const LOOPBACK_URL_WITH_SCHEME = /^https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\]|[\w-]+\.localhost)(?::\d+)?(?:[/?#]|$)/i;
/** 스크립트 파일로 보이는 실행 대상. */
const SCRIPT_FILE_EXT = /\.(sh|bash|zsh|ps1|psm1|bat|cmd|py|js|mjs|cjs|ts|mts|cts|rb|pl|php)$/i;
/** 인라인 코드 속 테스트 실행 호출. */
const INLINE_TEST_CALL = /\b(pytest\.main|unittest\.main|unittest\.TextTestRunner|nose2\.main)\s*\(/;
const INLINE_BROWSER_IMPORT = /['"](playwright|@playwright\/test|playwright-core|puppeteer|puppeteer-core|selenium-webdriver|selenium)['"]|\bfrom\s+(playwright|selenium)\b|\bimport\s+(playwright|selenium|pyppeteer)\b/;
/** 인라인 코드 속 하위 프로세스 호출 — 첫 인자(문자열 또는 문자열 배열)를 셸 명령으로 다시 분류한다. */
const INLINE_EXEC_CALL = /\b(?:execSync|exec|execFileSync|execFile|spawnSync|spawn|system|run|call|check_call|check_output|Popen|popen|getoutput|getstatusoutput)\s*\(\s*(\[[^\]]*\]|"[^"]*"|'[^']*'|`[^`]*`)/g;

function clip(text: string, max = VERIFICATION_DETAIL_MAX): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

function firstString(input: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/** argv 배열(코덱스 일부 판본)을 토크나이저가 다시 같은 낱말로 자를 수 있는 한 줄로. */
function argvToCommandLine(argv: readonly string[]): string {
  return argv.map((arg) => {
    if (!/[\s"';&|<>]/.test(arg)) return arg;
    if (!arg.includes("'")) return `'${arg}'`;
    return `"${arg.replace(/"/g, '')}"`;
  }).join(' ');
}

function shellTextOf(toolName: string, input: Record<string, unknown>): string {
  const pick = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string')) return argvToCommandLine(value as string[]);
    return '';
  };
  const command = pick(input['command']);
  if (command.trim()) return command;
  if (SHELL_TOOL_NAMES.has(toolName)) {
    return pick(input['cmd']) || pick(input['chars']) || pick(input['input']) || pick(input['script']);
  }
  return '';
}

function isVersionProbe(args: readonly string[]): boolean {
  return args.length > 0 && args.every((a) => VERSION_ARGS.has(a));
}

/** 리다이렉트 낱말(과 떨어져 온 대상)을 걷는다 — `npm test > out.txt 2>&1` 의 `out.txt` 가 인자가 되지 않게. */
function dropRedirects(segment: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < segment.length; i++) {
    const tok = segment[i]!;
    if (/^\d*(>>?|<)/.test(tok) || /^&>/.test(tok)) {
      if (/^\d*(>>?|<)\|?$/.test(tok) || tok === '&>') i++;
      continue;
    }
    out.push(tok);
  }
  return out;
}

function commandNameOf(head: string): string {
  const name = normalizeShellCommandName(head);
  if (/^python\d*(\.\d+)*$/.test(name) || name === 'py' || /^pypy\d*$/.test(name)) return 'python';
  if (name === 'gradlew' || name === 'gradle') return 'gradle';
  if (name === 'mvnw' || name === 'mvn') return 'mvn';
  return name;
}

/** 앞머리 환경변수 대입과 감싸개를 걷어 실제 명령부터 시작하는 낱말 목록. */
function stripWrappers(segment: readonly string[]): string[] {
  const seg = dropRedirects(segment);
  let i = 0;
  while (i < seg.length) {
    const tok = seg[i]!;
    if (ENV_ASSIGN.test(tok)) { i++; continue; }
    const name = normalizeShellCommandName(tok);
    if (name === 'env') {
      i++;
      while (i < seg.length && (ENV_ASSIGN.test(seg[i]!) || seg[i]!.startsWith('-'))) i++;
      continue;
    }
    // `command -v x` 는 있는지 묻는 것이지 실행이 아니다.
    if (name === 'command') {
      if (seg[i + 1] === '-v' || seg[i + 1] === '-V') return [];
      i++;
      continue;
    }
    if (PASS_THROUGH_WRAPPERS.has(name)) {
      i++;
      while (i < seg.length) {
        const t = seg[i]!;
        if (t === '--') { i++; break; }
        if (ENV_ASSIGN.test(t)) { i++; continue; }
        if (t.startsWith('-')) { i += WRAPPER_VALUE_FLAGS.has(t) ? 2 : 1; continue; }
        if ((name === 'timeout' || name === 'gtimeout') && /^\d+(\.\d+)?[smhd]?$/.test(t)) { i++; continue; }
        break;
      }
      continue;
    }
    break;
  }
  return seg.slice(i);
}

/** 플래그를 뺀 위치 인자. `valueFlags` 에 든 플래그는 값까지 건너뛴다. */
function positionalArgs(args: readonly string[], valueFlags: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--') continue;
    if (a.startsWith('-')) {
      if (valueFlags.has(a)) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

function flagValue(args: readonly string[], isFlag: (a: string) => boolean): string | undefined {
  const at = args.findIndex(isFlag);
  return at >= 0 ? args[at + 1] : undefined;
}

/** 대상(파일·이름 패턴·필터)을 준 테스트 호출인가 — 아니면 전체 스위트다. */
function hasTestTarget(args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (TEST_FILTER_FLAG.test(a)) return true;
    if (a.startsWith('-')) {
      if (TEST_VALUE_FLAGS.has(a)) i++;
      continue;
    }
    if (TEST_SUBCOMMAND_WORDS.has(a)) continue;
    if (a === 'related') return true;
    if (a === './...' || a === '...') continue;
    return true;
  }
  return false;
}

function isLoopbackUrlText(text: string, requireScheme: boolean): boolean {
  return (requireScheme ? LOOPBACK_URL_WITH_SCHEME : LOOPBACK_URL).test(text.trim());
}

/**
 * 스크립트·작업 이름이 말하는 종류. `allowBuild=false` 는 **스크립트 파일 이름**용이다 — `build-icons.mjs`
 * 같은 생성 스크립트는 일을 하는 것이지 검증하는 것이 아니다.
 */
function scriptNameKinds(name: string, allowBuild: boolean): Kind[] {
  const lower = name.toLowerCase();
  const lifecycle = /^(pre|post)(test|lint|build|typecheck|e2e)$/.exec(lower);
  const words = (lifecycle ? lifecycle[2]! : lower).split(/[^a-z0-9]+/).filter(Boolean);
  const has = (...w: string[]): boolean => w.some((x) => words.includes(x));
  const kinds = new Set<Kind>();
  if (has('e2e', 'cypress', 'cy', 'playwright', 'pw', 'wdio', 'nightwatch', 'detox', 'acceptance', 'smoke')) kinds.add('e2e');
  else if (has('test', 'tests', 'spec', 'specs', 'unit', 'jest', 'vitest', 'mocha', 'coverage', 'cov', 'integration', 'tdd')) kinds.add('test');
  if (has('lint', 'eslint', 'stylelint', 'clippy', 'ruff', 'flake8', 'pylint', 'biome')
    || (has('format', 'fmt', 'prettier') && has('check', 'verify', 'ci'))) kinds.add('lint');
  if (has('typecheck', 'tsc', 'mypy', 'pyright') || (has('type', 'types') && has('check', 'checks', 'verify'))) kinds.add('typecheck');
  if (allowBuild && has('build', 'compile', 'bundle', 'dist', 'assemble')) kinds.add('build');
  if (kinds.size === 0 && has('verify', 'validate', 'check', 'checks', 'ci', 'qa', 'precommit', 'prepush', 'preflight')) {
    for (const k of VERIFICATION_GENERIC_KINDS) if (allowBuild || k !== 'build') kinds.add(k);
  }
  return [...kinds];
}

interface SegmentContext {
  opts: VerificationClassifyOptions | undefined;
  depth: number;
  /** 앞 세그먼트의 `cd` 대상(원문). */
  dir?: string;
  /** 이 세그먼트가 연 heredoc 의 본문(셸·인터프리터에 먹이면 실행되는 코드다). */
  heredocBody?: string;
}

function kindHits(kinds: readonly Kind[], detail: string, fullSuite?: boolean): VerificationHit[] {
  return kinds.map((kind) => (kind === 'test' && fullSuite !== undefined ? { kind, detail, fullSuite } : { kind, detail }));
}

function scriptFileHits(file: string, detail: string): VerificationHit[] {
  const parts = file.replace(/\\/g, '/').split('/').filter(Boolean);
  const base = (parts.pop() ?? '').replace(SCRIPT_FILE_EXT, '');
  const kinds = new Set(scriptNameKinds(base, false));
  for (const dir of parts) {
    const d = dir.toLowerCase();
    if (d === 'e2e' || d === 'cypress' || d === 'playwright') kinds.add('e2e');
    else if (d === 'test' || d === 'tests' || d === '__tests__' || d === 'spec' || d === 'specs') kinds.add('test');
  }
  if (kinds.has('e2e')) kinds.delete('test');
  // 테스트 파일 하나(`foo.test.mjs` · `test_api.py`)를 돌리면 대상이 있는 것이고, `run-tests.sh` 는 스위트다.
  const singleFile = /[._-](test|spec)$/i.test(base) || /^test[_-]/i.test(base);
  return kindHits([...kinds], detail, !singleFile);
}

function inlineCodeHits(code: string, ctx: SegmentContext, detail: string): VerificationHit[] {
  const hits: VerificationHit[] = [];
  if (INLINE_TEST_CALL.test(code)) hits.push({ kind: 'test', detail, fullSuite: true });
  if (INLINE_BROWSER_IMPORT.test(code) || SCREEN_CAPTURE_TEXT.test(code)) hits.push({ kind: 'browser', detail });
  for (const match of code.matchAll(INLINE_EXEC_CALL)) {
    const arg = match[1] ?? '';
    const strings = [...arg.matchAll(/(["'`])((?:(?!\1).)*)\1/g)].map((m) => m[2] ?? '').filter(Boolean);
    const line = arg.startsWith('[') ? argvToCommandLine(strings) : (strings[0] ?? '');
    if (line) hits.push(...classifyShellText(line, ctx.opts, ctx.depth + 1));
  }
  return hits;
}

/** PowerShell `-EncodedCommand`(base64 UTF-16LE). 풀지 못하면 null. */
function decodePowerShellEncoded(value: string): string | null {
  try {
    if (typeof atob !== 'function') return null;
    const bin = atob(value.trim());
    let out = '';
    for (let i = 0; i + 1 < bin.length; i += 2) out += String.fromCharCode(bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8));
    return out;
  } catch {
    return null;
  }
}

function namedScriptHits(
  name: string | undefined,
  extra: readonly string[],
  ctx: SegmentContext,
  detail: string,
  scope: { recursive: boolean; filtered: boolean; dir?: string },
): VerificationHit[] {
  if (!name) return [];
  const targeted = scope.filtered || hasTestTarget(extra);
  const body = ctx.opts?.resolveScript?.(name, scope.dir ?? ctx.dir);
  if (body !== undefined) {
    // 본문을 알면 본문을 믿는다 — `build:icons` 의 본문이 생성 스크립트면 빌드 검증이 아니다.
    if (ctx.depth >= VERIFICATION_SHELL_DEPTH_MAX) return [];
    return classifyShellText(body, ctx.opts, ctx.depth + 1).map((h) => (h.kind === 'test'
      ? { ...h, detail, fullSuite: scope.recursive || (h.fullSuite !== false && !targeted) }
      : { ...h, detail }));
  }
  return kindHits(scriptNameKinds(name, true), detail, scope.recursive || !targeted);
}

function packageManagerHits(pm: string, args: readonly string[], ctx: SegmentContext, detail: string): VerificationHit[] {
  if (pm === 'corepack') return args.length > 0 ? classifySegment(args, deeper(ctx)) : [];
  let recursive = false;
  let filtered = false;
  let dir: string | undefined;
  let rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-r' || a === '--recursive' || a === '-ws' || a === '--workspaces' || a === '--all') { recursive = true; continue; }
    if (a === '--filter' || a === '-F' || a === '--workspace' || (pm === 'npm' && a === '-w') || a === '--scope') { filtered = true; i++; continue; }
    if (/^--(filter|workspace|scope)=/.test(a)) { filtered = true; continue; }
    if (a === '-C' || a === '--dir' || a === '--prefix' || a === '--cwd') { dir = args[i + 1]; i++; continue; }
    if (/^--(dir|prefix|cwd)=/.test(a)) { dir = a.slice(a.indexOf('=') + 1); continue; }
    if (a.startsWith('-')) continue;
    rest = args.slice(i);
    break;
  }
  const sub = rest[0];
  if (!sub) return [];
  const extra = rest.slice(1);
  const scope = { recursive, filtered, ...(dir !== undefined ? { dir } : {}) };
  if (pm === 'deno') {
    if (sub === 'task') return namedScriptHits(extra[0], extra.slice(1), ctx, detail, scope);
    if (sub === 'run') { const file = positionalArgs(extra)[0]; return file ? scriptFileHits(file, detail) : []; }
    const kind = SUBCOMMAND_TOOLS['deno']?.[sub];
    return kind ? kindHits([kind], detail, !hasTestTarget(extra)) : [];
  }
  if (pm === 'bun') {
    if (sub === 'test') return kindHits(['test'], detail, recursive || !(filtered || hasTestTarget(extra)));
    if (sub === 'build') return kindHits(['build'], detail);
    if (sub === 'x') return classifySegment(extra, deeper(ctx));
    if (sub === 'run') {
      const target = extra[0];
      if (!target) return [];
      return SCRIPT_FILE_EXT.test(target) || /[\\/]/.test(target)
        ? scriptFileHits(target, detail)
        : namedScriptHits(target, extra.slice(1), ctx, detail, scope);
    }
    if (SCRIPT_FILE_EXT.test(sub) || /[\\/]/.test(sub)) return scriptFileHits(sub, detail);
    if (PM_BUILTINS.has(sub)) return [];
    return scriptOrBinHits(sub, extra, ctx, detail, scope);
  }
  // npm · pnpm · yarn
  if (sub === 'test' || sub === 't' || sub === 'tst') return namedScriptHits('test', extra, ctx, detail, scope);
  if (pm === 'npm' && (sub === 'it' || sub === 'install-test' || sub === 'cit' || sub === 'clean-install-test')) {
    return namedScriptHits('test', [], ctx, detail, scope);
  }
  if (sub === 'run' || sub === 'run-script' || sub === 'rs') {
    const script = positionalArgs(extra)[0];
    const after = script ? extra.slice(extra.indexOf(script) + 1) : [];
    return namedScriptHits(script, after, ctx, detail, scope);
  }
  if (sub === 'exec' || sub === 'dlx' || sub === 'x') {
    const inner = extra[0] === '--' ? extra.slice(1) : extra.slice(Math.max(0, extra.findIndex((a) => !a.startsWith('-'))));
    return classifySegment(inner, deeper(ctx));
  }
  if (pm === 'yarn' && sub === 'workspace') {
    return namedScriptHits(extra[1], extra.slice(2), ctx, detail, { ...scope, filtered: true });
  }
  if (pm === 'yarn' && sub === 'workspaces') {
    const at = extra.indexOf('run');
    return at >= 0 ? namedScriptHits(extra[at + 1], extra.slice(at + 2), ctx, detail, { ...scope, recursive: true }) : [];
  }
  if (PM_BUILTINS.has(sub)) return [];
  // npm 은 모르는 하위 명령을 스크립트로 돌리지 않는다. pnpm·yarn 은 스크립트를, 없으면 바이너리를 돌린다.
  return pm === 'npm' ? [] : scriptOrBinHits(sub, extra, ctx, detail, scope);
}

/**
 * `pnpm <이름>`·`yarn <이름>`·`bun <이름>` — 같은 이름의 스크립트가 있으면 그 본문, 없으면 그 이름의
 * 바이너리(`pnpm prettier --check` · `pnpm tsc --noEmit`), 그것도 아니면 이름으로 판정한다.
 */
function scriptOrBinHits(
  name: string,
  extra: readonly string[],
  ctx: SegmentContext,
  detail: string,
  scope: { recursive: boolean; filtered: boolean; dir?: string },
): VerificationHit[] {
  if (ctx.opts?.resolveScript?.(name, scope.dir ?? ctx.dir) !== undefined) return namedScriptHits(name, extra, ctx, detail, scope);
  const asBin = classifySegment([name, ...extra], deeper(ctx));
  return asBin.length > 0 ? asBin : namedScriptHits(name, extra, ctx, detail, scope);
}

function makeTargetHits(name: string, args: readonly string[], detail: string): VerificationHit[] {
  const targets: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (['-C', '-f', '--directory', '--file', '--makefile', '-j', '--jobs', '-l', '-o', '-W'].includes(a)) {
      if (a !== '-j' || /^\d+$/.test(args[i + 1] ?? '')) i++;
      continue;
    }
    if (a.startsWith('-') || ENV_ASSIGN.test(a)) continue;
    targets.push(a);
  }
  if (targets.length === 0) return MAKE_RUNNERS.has(name) || DEFAULT_BUILD_RUNNERS.has(name) ? kindHits(['build'], detail) : [];
  return targets.flatMap((t) => kindHits(scriptNameKinds(t.split(':').pop() ?? t, true), detail, true));
}

function turboHits(args: readonly string[], detail: string): VerificationHit[] {
  const valueFlags = new Set(['--filter', '-F', '--concurrency', '--cache-dir', '--output-logs', '--log-order', '--env-mode', '--graph', '--summarize', '--profile', '--log-prefix']);
  const filtered = args.some((a) => a === '--filter' || a === '-F' || a.startsWith('--filter=') || a === '--affected');
  const pos = positionalArgs(args, valueFlags);
  const tasks = pos[0] === 'run' ? pos.slice(1) : pos;
  return tasks.flatMap((t) => kindHits(scriptNameKinds(t, true), detail, !filtered));
}

function nxHits(args: readonly string[], detail: string): VerificationHit[] {
  const valueFlags = new Set(['-t', '--target', '--targets', '-p', '--projects', '-c', '--configuration', '--parallel', '--base', '--head', '--exclude']);
  const pos = positionalArgs(args, valueFlags);
  const fromFlag = (flagValue(args, (a) => a === '-t' || a === '--target' || a === '--targets')
    ?? args.find((a) => /^--targets?=/.test(a))?.split('=')[1] ?? '').split(',').filter(Boolean);
  const sub = pos[0];
  const hitsFor = (targets: readonly string[], full: boolean): VerificationHit[] =>
    targets.flatMap((t) => kindHits(scriptNameKinds(t, true), detail, full));
  if (!sub) return [];
  if (sub === 'run' && pos[1]) return hitsFor([pos[1].split(':')[1] ?? ''], false);
  if (sub === 'run-many') return hitsFor(fromFlag, true);
  if (sub === 'affected') return hitsFor(fromFlag, false);
  if (sub.startsWith('affected:')) return hitsFor([sub.slice('affected:'.length)], false);
  if (sub.includes(':')) return hitsFor([sub.split(':')[1] ?? ''], false);
  return hitsFor([sub], false);
}

function gradleHits(args: readonly string[], detail: string): VerificationHit[] {
  const valueFlags = new Set(['-p', '--project-dir', '-x', '--exclude-task', '-D', '-P', '--tests', '-c', '--settings-file', '-b', '--build-file']);
  const targeted = args.some((a) => a === '--tests' || a.startsWith('--tests='));
  const hits: VerificationHit[] = [];
  for (const task of positionalArgs(args, valueFlags)) {
    const n = (task.split(':').pop() ?? task).toLowerCase();
    if (/lint|ktlint|detekt|spotless|checkstyle|pmd|spotbugs/.test(n)) hits.push({ kind: 'lint', detail });
    else if (/test|check/.test(n)) hits.push({ kind: 'test', detail, fullSuite: !targeted && !task.includes(':') });
    else if (/^(build|assemble|bundle|jar|war|compile|install|publish)/.test(n)) hits.push({ kind: 'build', detail });
  }
  return hits;
}

function mavenHits(args: readonly string[], detail: string): VerificationHit[] {
  const valueFlags = new Set(['-pl', '--projects', '-f', '--file', '-P', '--activate-profiles', '-s', '--settings', '-T', '--threads', '-rf', '--resume-from']);
  const skipTests = args.some((a) => /^-D(skipTests|maven\.test\.skip)(=true)?$/.test(a));
  const targeted = args.some((a) => a.startsWith('-Dtest=') || a === '-pl' || a === '--projects');
  const hits: VerificationHit[] = [];
  for (const goal of positionalArgs(args, valueFlags)) {
    const phase = (goal.split(':').pop() ?? goal).toLowerCase();
    if (['test', 'integration-test'].includes(phase)) hits.push({ kind: 'test', detail, fullSuite: !targeted });
    else if (['verify', 'package', 'install', 'deploy'].includes(phase)) {
      hits.push({ kind: 'build', detail });
      if (!skipTests) hits.push({ kind: 'test', detail, fullSuite: !targeted });
    } else if (['compile', 'test-compile'].includes(phase)) hits.push({ kind: 'build', detail });
    else if (/checkstyle|spotless|pmd|spotbugs/.test(phase)) hits.push({ kind: 'lint', detail });
  }
  return hits;
}

function pythonModuleHits(mod: string, rest: readonly string[], detail: string): VerificationHit[] {
  const isCheck = rest.some((a) => ['--check', '--check-only', '-c', '--diff'].includes(a));
  switch (mod) {
    case 'pytest': case 'unittest': case 'nose2': case 'tox': case 'nox': case 'doctest':
      return kindHits(['test'], detail, !hasTestTarget(rest.filter((a) => a !== 'discover')));
    case 'coverage': return rest[0] === 'run' ? kindHits(['test'], detail, true) : [];
    case 'mypy': case 'pyright': case 'pytype': return kindHits(['typecheck'], detail);
    case 'pylint': case 'flake8': case 'pycodestyle': case 'pydocstyle': case 'bandit': return kindHits(['lint'], detail);
    case 'ruff': return rest[0] === 'check' || (rest[0] === 'format' && rest.includes('--check')) ? kindHits(['lint'], detail) : [];
    case 'black': case 'isort': return isCheck ? kindHits(['lint'], detail) : [];
    case 'build': return kindHits(['build'], detail);
    case 'playwright': return rest[0] === 'screenshot' || rest[0] === 'pdf' ? kindHits(['browser'], detail) : [];
    default: return [];
  }
}

/** 감싸개(`npx`·`pnpm exec`·`uv run` …) 안쪽으로 한 칸 — 자기 자신을 부르는 꼴의 무한 반복을 끊는다. */
function deeper(ctx: SegmentContext): SegmentContext {
  return { ...ctx, depth: ctx.depth + 1 };
}

/** 세그먼트 하나(이미 `&&`·`;`·`|` 로 잘린 낱말 목록)를 분류한다. */
function classifySegment(segment: readonly string[], ctx: SegmentContext): VerificationHit[] {
  if (ctx.depth > VERIFICATION_WRAPPER_DEPTH_MAX) return [];
  const words = stripWrappers(segment);
  if (words.length === 0) return [];
  const head = words[0]!;
  const name = commandNameOf(head);
  const args = words.slice(1);
  const detail = clip(words.join(' '));
  const nested = (text: string): VerificationHit[] => classifyShellText(text, ctx.opts, ctx.depth + 1);
  if (isVersionProbe(args)) return [];

  // ① 셸 다시 들어가기 — 그 안의 스크립트를 같은 규칙으로 본다.
  if (POSIX_SHELLS.has(name)) {
    const script = flagValue(args, (a) => /^-[a-z]*c[a-z]*$/.test(a));
    if (script !== undefined) return nested(script);
    if (ctx.heredocBody) return nested(ctx.heredocBody);
    const file = positionalArgs(args)[0];
    return file ? scriptFileHits(file, detail) : [];
  }
  if (name === 'cmd') {
    const at = args.findIndex((a) => /^\/[ck]$/i.test(a));
    return at >= 0 ? nested(args.slice(at + 1).join(' ')) : [];
  }
  if (POWERSHELLS.has(name)) {
    const encoded = flagValue(args, (a) => /^-(e|ec|en|enc|encodedcommand)$/i.test(a));
    if (encoded) { const decoded = decodePowerShellEncoded(encoded); return decoded ? nested(decoded) : []; }
    const at = args.findIndex((a) => /^-(c|command|cmd)$/i.test(a));
    if (at >= 0) return nested(args.slice(at + 1).join(' '));
    if (ctx.heredocBody) return nested(ctx.heredocBody);
    const file = flagValue(args, (a) => /^-(f|file)$/i.test(a)) ?? positionalArgs(args)[0];
    return file ? scriptFileHits(file, detail) : [];
  }
  if (name === 'eval' || name === 'invoke-expression' || name === 'iex') return nested(args.join(' '));
  if (name === 'source' || name === '.') {
    const file = positionalArgs(args)[0];
    return file ? scriptFileHits(file, detail) : [];
  }

  // ② 인터프리터 — 인라인 코드·스크립트 파일 이름.
  if (JS_RUNNERS.has(name)) {
    if (args.includes('--test')) return kindHits(['test'], detail, !hasTestTarget(args.filter((a) => a !== '--test')));
    const code = flagValue(args, (a) => a === '-e' || a === '--eval' || a === '-p' || a === '--print');
    if (code !== undefined) return inlineCodeHits(code, ctx, detail);
    if (name === 'node' && args.some((a) => a === '--check' || a === '-c')) return kindHits(['lint'], detail);
    if (ctx.heredocBody && (args.length === 0 || args.includes('-'))) return inlineCodeHits(ctx.heredocBody, ctx, detail);
    const file = positionalArgs(args)[0];
    return file ? scriptFileHits(file, detail) : [];
  }
  if (name === 'python') {
    const mIndex = args.indexOf('-m');
    if (mIndex >= 0 && args[mIndex + 1]) return pythonModuleHits(args[mIndex + 1]!.toLowerCase(), args.slice(mIndex + 2), detail);
    const code = flagValue(args, (a) => a === '-c');
    if (code !== undefined) return inlineCodeHits(code, ctx, detail);
    if (ctx.heredocBody && (args.length === 0 || args.includes('-'))) return inlineCodeHits(ctx.heredocBody, ctx, detail);
    const file = positionalArgs(args)[0];
    return file ? scriptFileHits(file, detail) : [];
  }
  if (OTHER_INTERPRETERS.has(name)) {
    const code = flagValue(args, (a) => a === '-e' || a === '-r');
    if (code !== undefined) return inlineCodeHits(code, ctx, detail);
    if (ctx.heredocBody) return inlineCodeHits(ctx.heredocBody, ctx, detail);
    const file = positionalArgs(args)[0];
    return file ? scriptFileHits(file, detail) : [];
  }

  // ③ 패키지 관리자·실행 대행.
  if (PACKAGE_MANAGERS.has(name)) return packageManagerHits(name, args, ctx, detail);
  if (name === 'npx' || name === 'pnpx' || name === 'bunx') {
    const start = args.findIndex((a) => !a.startsWith('-'));
    return start >= 0 ? classifySegment(args.slice(start), deeper(ctx)) : [];
  }
  if (PY_ENV_RUNNERS.has(name)) {
    const at = args.indexOf('run');
    if (at < 0) return [];
    const inner = args.slice(at + 1);
    const valueFlags = new Set(['--with', '--python', '-p', '--env-file', '--extra', '--group', '--package', '--directory', '--project']);
    let i = 0;
    while (i < inner.length && inner[i]!.startsWith('-')) i += valueFlags.has(inner[i]!) ? 2 : 1;
    return classifySegment(inner.slice(i), deeper(ctx));
  }
  if (name === 'uvx' || name === 'pipx') {
    const inner = name === 'pipx' ? args.slice(args.indexOf('run') + 1) : args;
    const start = inner.findIndex((a) => !a.startsWith('-'));
    return start >= 0 ? classifySegment(inner.slice(start), deeper(ctx)) : [];
  }
  if (name === 'bundle' && args[0] === 'exec') return classifySegment(args.slice(1), deeper(ctx));
  if ((name === 'conda' || name === 'mamba' || name === 'micromamba') && args[0] === 'run') {
    const inner = args.slice(1);
    const valueFlags = new Set(['-n', '--name', '-p', '--prefix']);
    let i = 0;
    while (i < inner.length && inner[i]!.startsWith('-')) i += valueFlags.has(inner[i]!) ? 2 : 1;
    return classifySegment(inner.slice(i), deeper(ctx));
  }
  if (name === 'nyc' || name === 'c8') {
    const start = args.findIndex((a) => !a.startsWith('-'));
    return [{ kind: 'test', detail, fullSuite: true }, ...(start >= 0 ? classifySegment(args.slice(start), deeper(ctx)) : [])];
  }

  // ④ 작업 실행기·모노레포 도구 — 대상 이름이 곧 종류다.
  if (MAKE_RUNNERS.has(name) || NAMED_TASK_RUNNERS.has(name)) return makeTargetHits(name, args, detail);
  if (name === 'turbo') return turboHits(args, detail);
  if (name === 'nx') return nxHits(args, detail);
  if (name === 'lerna' && args[0] === 'run') {
    const scoped = args.some((a) => a === '--scope' || a.startsWith('--scope='));
    return kindHits(scriptNameKinds(positionalArgs(args.slice(1))[0] ?? '', true), detail, !scoped);
  }
  if (name === 'lage') return positionalArgs(args).flatMap((t) => kindHits(scriptNameKinds(t, true), detail, true));
  if (name === 'rushx') return namedScriptHits(positionalArgs(args)[0], [], ctx, detail, { recursive: false, filtered: true });
  if (name === 'npm-run-all' || name === 'run-s' || name === 'run-p') {
    return positionalArgs(args).flatMap((script) => namedScriptHits(script.replace(/[*?]/g, ''), [], ctx, detail, { recursive: false, filtered: false }));
  }
  if (name === 'concurrently') {
    return positionalArgs(args, new Set(['-n', '--names', '-c', '--prefix-colors', '-p', '--prefix', '-k'])).flatMap((cmd) => {
      const script = /^(npm|pnpm|yarn|bun):(.+)$/.exec(cmd);
      return script ? namedScriptHits(script[2], [], ctx, detail, { recursive: false, filtered: false }) : nested(cmd);
    });
  }

  // ⑤ 하위 명령·플래그를 봐야 하는 도구.
  if (name === 'tsc' || name === 'tsgo') {
    if (args.some((a) => ['-v', '--init', '--showConfig', '--listFilesOnly'].includes(a))) return [];
    return args.some((a) => a === '-b' || a === '--build') ? kindHits(['build'], detail) : kindHits(['typecheck'], detail);
  }
  if (name === 'prettier') return args.some((a) => ['--check', '-c', '--list-different', '-l'].includes(a)) ? kindHits(['lint'], detail) : [];
  if (name === 'black' || name === 'isort') {
    return args.some((a) => ['--check', '--check-only', '-c', '--diff'].includes(a)) ? kindHits(['lint'], detail) : [];
  }
  if (name === 'ruff') return args[0] === 'check' || (args[0] === 'format' && args.includes('--check')) ? kindHits(['lint'], detail) : [];
  if (name === 'cargo' && args[0] === 'fmt') return args.includes('--check') ? kindHits(['lint'], detail) : [];
  if (name === 'dotnet' && args[0] === 'format') return args.includes('--verify-no-changes') ? kindHits(['lint'], detail) : [];
  if (name === 'xcodebuild') {
    if (args.some((a) => ['-list', '-version', '-showsdks', '-showBuildSettings'].includes(a))) return [];
    return args.some((a) => a === 'test' || a === 'test-without-building') ? kindHits(['test'], detail, true) : kindHits(['build'], detail);
  }
  if (name === 'gradle') return gradleHits(args, detail);
  if (name === 'mvn') return mavenHits(args, detail);
  if (name === 'sbt') {
    const hits: VerificationHit[] = [];
    if (args.some((a) => /^(it:)?test(Only|Quick)?\b/.test(a))) hits.push({ kind: 'test', detail, fullSuite: !args.some((a) => /^testOnly\b/.test(a)) });
    if (args.some((a) => /^(compile|package|assembly|publishLocal)$/.test(a))) hits.push({ kind: 'build', detail });
    return hits;
  }
  if (name === 'webpack') return args[0] === 'serve' || args.includes('--watch') || args.includes('-w') ? [] : kindHits(['build'], detail);
  if (name === 'esbuild') return args.some((a) => a === '--serve' || a.startsWith('--serve=') || a === '--watch') ? [] : kindHits(['build'], detail);
  if (BROWSER_OPENERS.has(name) || BROWSER_APPS.has(name)) {
    if (BROWSER_APPS.has(name) && args.some((a) => /^--(screenshot|print-to-pdf|dump-dom)/.test(a))) return kindHits(['browser'], detail);
    if (args.some((a) => isLoopbackUrlText(a, true))) return kindHits(['browser'], detail);
    if (BROWSER_APPS.has(name) && args.some((a) => /^--headless/.test(a))) return kindHits(['browser'], detail);
    return [];
  }

  // ⑥ 하위 명령 표.
  const table = SUBCOMMAND_TOOLS[name];
  if (table) {
    const sub = positionalArgs(args)[0];
    const kind = sub ? table[sub] : undefined;
    if (!kind) return [];
    const rest = sub ? args.slice(args.indexOf(sub) + 1) : [];
    if (kind !== 'test') return kindHits([kind], detail);
    // `go test ./...`·`cargo test` 처럼 대상이 없으면 스위트 전체다. `-p <패키지>` 는 좁힌 것이다.
    const narrowed = rest.some((a) => a === '-p' || a === '--package' || a === '--filter');
    return kindHits([kind], detail, !(narrowed || hasTestTarget(rest)));
  }

  // ⑦ 이름만으로 검증인 실행 파일.
  const direct = DIRECT_RUNNERS[name];
  if (direct) return kindHits([direct], detail, direct === 'test' ? !hasTestTarget(args) : undefined);

  // ⑧ 스크립트 파일 — 이름이 검증을 말하면 검증이다(`./scripts/run-tests.sh` · `.\verify.ps1`).
  if (/[\\/]/.test(head) || SCRIPT_FILE_EXT.test(head)) return scriptFileHits(head, detail);
  return [];
}

interface ShellPiece {
  segment: string[];
  heredocBody?: string;
}

/** 세그먼트로 자르고(`&` 도 끊는다), heredoc 본문은 여는 세그먼트에 붙여 둔다. */
function shellPieces(text: string): ShellPiece[] {
  const tokens = tokenizeShellCommand(text).map((t) => (t === '&' ? ';' : t));
  const raw = splitShellSegments(tokens);
  const out: ShellPiece[] = [];
  for (let i = 0; i < raw.length; i++) {
    const segment = raw[i]!;
    const delimiter = readHeredocDelimiter(segment);
    if (!delimiter) { out.push({ segment }); continue; }
    const body: string[] = [];
    let j = i + 1;
    for (; j < raw.length; j++) {
      const s = raw[j]!;
      if (s.length === 1 && s[0] === delimiter) break;
      body.push(s.join(' '));
    }
    out.push({ segment: segment.filter((t) => !/^<<-?/.test(t) && t !== delimiter), heredocBody: body.join('\n') });
    i = j;
  }
  return out;
}

const CD_COMMANDS: ReadonlySet<string> = new Set(['cd', 'chdir', 'pushd', 'set-location', 'push-location', 'sl']);

function cdTargetOf(segment: readonly string[]): string | null {
  if (segment.length < 2 || !CD_COMMANDS.has(normalizeShellCommandName(segment[0]!))) return null;
  return segment.slice(1).find((t) => !t.startsWith('-')) ?? null;
}

function classifyShellText(text: string, opts: VerificationClassifyOptions | undefined, depth: number): VerificationHit[] {
  if (!text.trim() || depth > VERIFICATION_SHELL_DEPTH_MAX) return [];
  const hits: VerificationHit[] = [];
  if (SCREEN_CAPTURE_TEXT.test(text)) hits.push({ kind: 'browser', detail: clip(text) });
  let dir: string | undefined;
  for (const piece of shellPieces(text)) {
    const cd = cdTargetOf(piece.segment);
    if (cd !== null) { dir = cd; continue; }
    hits.push(...classifySegment(piece.segment, {
      opts, depth,
      ...(dir !== undefined ? { dir } : {}),
      ...(piece.heredocBody !== undefined ? { heredocBody: piece.heredocBody } : {}),
    }));
  }
  return hits;
}

function mcpHits(server: string, tool: string, detail: string): VerificationHit[] {
  if (server === VERIFICATION_APP_MCP_SERVER) return [{ kind: 'browser', detail, budgetExempt: true }];
  if (BROWSER_MCP_SERVER.test(server) || /^(browser|computer)[-_]/i.test(tool)) return [{ kind: 'browser', detail }];
  if (TESTING_MCP_SERVER.test(server)) return [{ kind: 'e2e', detail }];
  return [];
}

function agentHits(toolName: string, input: Record<string, unknown>): VerificationHit[] {
  const type = firstString(input, ['subagent_type', 'agent_type', 'role']) ?? '';
  const description = firstString(input, ['description', 'title']) ?? '';
  if ((type && VERIFIER_AGENT_TYPE.test(type)) || (description && VERIFY_TASK_DESCRIPTION.test(description))) {
    return [{ kind: 'agent', detail: clip(`${toolName}: ${type || description}`) }];
  }
  return [];
}

function skillHits(toolName: string, input: Record<string, unknown>): VerificationHit[] {
  const raw = firstString(input, ['skill', 'name', 'command']) ?? '';
  const skill = (raw.replace(/^\//, '').split(/\s+/)[0] ?? '').split(':').pop() ?? '';
  for (const [pattern, kind] of SKILL_KINDS) {
    if (pattern.test(skill)) return [{ kind, detail: clip(`${toolName}: ${skill}`) }];
  }
  return [];
}

/** 같은 종류는 하나로 — 전체 스위트는 하나라도 그러면 그렇고, 횟수 면제는 전부 그럴 때만. */
function mergeHits(hits: readonly VerificationHit[]): VerificationHit[] {
  const byKind = new Map<Kind, VerificationHit>();
  for (const hit of hits) {
    const prev = byKind.get(hit.kind);
    if (!prev) { byKind.set(hit.kind, { ...hit }); continue; }
    if (hit.fullSuite) prev.fullSuite = true;
    if (!hit.budgetExempt) delete prev.budgetExempt;
  }
  return [...byKind.values()];
}

/**
 * §5.3 #12-4 (A) — 이 도구 호출이 검증인가. 비면 검증이 아니다.
 *
 * 셸 명령은 도구 이름과 무관하게 `command` 칸을 본다(클로드 `Bash`·`PowerShell` · 코덱스 `shell`·`exec_command` ·
 * 로컬 `Bash`). 세지 않는 것: 읽기·검색·편집, `git diff`/`status`, 의존성 설치, 개발 서버 기동, `--version`·`--help`.
 */
export function classifyVerificationCall(
  toolName: string,
  toolInput: Record<string, unknown> | null | undefined,
  opts?: VerificationClassifyOptions,
): VerificationHit[] {
  const name = (toolName ?? '').replace(/^functions\./, '');
  const input = toolInput ?? {};
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) return mergeHits(mcpHits(mcp[1]!, mcp[2]!, clip(name)));
  if (AGENT_TOOL_NAMES.has(name)) return mergeHits(agentHits(name, input));
  if (name === 'Skill' || name === 'SlashCommand') return mergeHits(skillHits(name, input));
  if (name === 'WebFetch' || name === 'web_fetch') {
    const url = firstString(input, ['url', 'uri']);
    return url && isLoopbackUrlText(url, false) ? [{ kind: 'browser', detail: clip(`${name}: ${url}`) }] : [];
  }
  if (/^(computer|browser)(\.|_|$)/.test(name)) return [{ kind: 'browser', detail: clip(name) }];
  const command = shellTextOf(name, input);
  return command ? mergeHits(classifyShellText(command, opts, 0)) : [];
}

const EDIT_TOOL_NAMES: ReadonlySet<string> = new Set([
  'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'apply_patch', 'str_replace_editor', 'create_file', 'write_file', 'edit_file',
]);

/** §5.3 #12-4 (F) — 이 호출이 파일을 고치는가("검증 미실행" 칩을 다는 근거). 셸 쓰기는 쓰기 축과 같은 추출기다. */
export function isEditingToolCall(toolName: string, toolInput: Record<string, unknown> | null | undefined): boolean {
  const name = (toolName ?? '').replace(/^functions\./, '');
  if (EDIT_TOOL_NAMES.has(name)) return true;
  const command = shellTextOf(name, toolInput ?? {});
  return !!command && extractBashWritePaths(command, 1).length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 요청 해석 — 사람의 문장에서만 권한이 선다
// ─────────────────────────────────────────────────────────────────────────────

export interface VerificationRequestParse {
  /** 요청된 종류(부정된 것은 이미 뺐다). */
  kinds: Kind[];
  /** 그 명령에서 부정된 종류. */
  negated: Kind[];
  testScope?: 'related' | 'all';
  /** 권한을 세운 문장. */
  evidence?: string;
}

/** 목적어 사전 — 앞에서부터 잡고 잡은 자리는 지운다(`e2e 테스트` 가 테스트로 한 번 더 잡히지 않게). */
const OBJECT_PATTERNS: readonly { kinds: readonly Kind[] | 'generic'; re: RegExp }[] = [
  { kinds: ['agent'], re: /(?:검증|테스트|QA|리뷰|검수|verification|review|qa|test)\s?(?:서브\s?)?에이전트|\b(?:verifier|reviewer)(?:\s+agent)?\b|sub-?agents?\s+to\s+(?:verify|review|test)|서브\s?에이전트(?:로|를)?\s?(?:검증|확인|리뷰)/gi },
  { kinds: ['e2e'], re: /(?:\be2e\b|엔드\s?투\s?엔드|end[-\s]to[-\s]end|\bplaywright\b|\bcypress\b)(?:\s?(?:테스트|tests?|testing))?/gi },
  { kinds: ['browser', 'screenshot'], re: /스크린\s?샷|screen\s?shots?|화면\s?캡처/gi },
  { kinds: ['screenshot'], re: /(?:캡처|화면|시각|비주얼)\s?(?:비교|회귀)|visual\s?(?:diff|regression|comparison)/gi },
  { kinds: ['browser'], re: /브라우저(?:에서|로)?(?:\s?(?:테스트|확인|검증|QA))?|\bbrowser\b(?:\s?(?:tests?|checks?|QA))?|크롬에서|화면에서|앱에서|띄워서|띄우고|실행해서\s?(?:확인|보|테스트)|직접\s?(?:눌러|클릭|조작)|UI\s?(?:확인|테스트|검증|QA)|\bin\s+the\s+(?:app|ui)\b|manual(?:ly)?\s+(?:check|test)|click\s+through/gi },
  { kinds: ['typecheck'], re: /타입\s?(?:체크|검사)|\btypecheck(?:s|ing)?\b|\btype[-\s]check(?:s|ing)?\b|\btsc\b|\bmypy\b|\bpyright\b/gi },
  { kinds: ['lint'], re: /린트|린팅|\blint(?:s|ing|er)?\b|\beslint\b|\bruff\b|\bclippy\b|포맷\s?검사|format\s?check/gi },
  { kinds: ['build'], re: /빌드(?:\s?(?:테스트|확인|검증))?|컴파일|번들링|\bbuild(?:s|ing)?\b|\bcompil(?:e|es|ing)\b|\bbundl(?:e|ing)\b/gi },
  { kinds: ['test'], re: /(?:유닛|단위|통합|회귀|관련|전체)?\s?테스트(?:\s?코드)?|테스팅|\b(?:unit\s+|integration\s+|regression\s+)?tests?\b|\btesting\b|\bspecs?\b|\bvitest\b|\bjest\b|\bpytest\b/gi },
  { kinds: 'generic', re: /검증|검수|\bQA\b|\bverif(?:y|ication)\b|\bvalidat(?:e|ion)\b|동작\s?(?:확인|테스트|검증)|잘\s?(?:되는지|도는지)\s?(?:확인|봐|체크)|\bworks?\s+correctly\b/gi },
];
const PLACEHOLDER = /⟦v:([a-z!,]*)⟧/g;
const ALL_TESTS = /전체|모든|전부|모두|풀\s?스위트|\bfull\b|\ball\b|\bentire\b|\bwhole\b|\bcomplete\b/i;
/** 절을 부정하는 표지(한국어는 띄어쓰기가 흔들려 공백을 느슨히 받는다). */
const KO_NEGATION = /하지\s*마|하지\s*말|말고|말아|마세요|마라|말\s*것|않아도|않고|않게|하지\s*않|안\s*해|안\s*돌|안\s*하|안해|안돌|없이|빼고|제외|생략|스킵|건너뛰|금지|필요\s*없|필요없|불필요|하면\s*안|나중에/;
const EN_NEGATION = /\b(?:don'?t|do\s+not|never|no\s+need|without|skip(?:ping)?|avoid|hold\s+off|no\s+(?:tests?|lint|builds?|e2e|checks?|verification)|not\s+(?:run|test|build|lint|verify|check)|later)\b/i;
/** 실행·검증 서술어(한국어 어절의 앞머리). */
const KO_EXEC_WORD = /^(?:실행|돌려|돌리|돌린|수행|검증|확인|체크|띄워|띄우|켜서|켜고|진행|검사|측정)|^(?:테스트|빌드|린트|타입체크|타입\s?체크|컴파일|검증|확인|체크|검사|실행)(?:해|하|해서|하고|해줘|해주|해봐|해보|해라|하자|해요|하세요|합시다|하기|할)/;
/** 목적어 바로 뒤에 홀로 오는 "해 줘"류 — 그 목적어를 실행하라는 뜻이다(`빌드 해 줘`). */
const KO_DO_WORD = /^(?:해|해줘|해주세요|해주실래|해줄래|해서|해봐|해보자|해라|하자|해요|해주라|해주시|돌려줘)$/;
/** 고치기·만들기 서술어 — 목적어가 있어도 실행 요청이 아니다(`테스트 고쳐 줘` · `테스트 추가해 줘`). */
const KO_FIX_WORD = /^(?:고쳐|고치|고친|수정|추가|작성|구현|변경|삭제|정리|개선|리팩터|업데이트|해결|바꿔|바꾸|만들|만든|짜|써|제거|지워|적용|반영|옮겨|이동)/;
const KO_REQUEST_END = /(?:줘|주세요|줄래|주실래|줄\s*수|주시|주라|주게|해라|하라|하자|합시다|부탁|바랍|바래|해요|하세요|해봐|해\s*봐|해보자|돌려|해|하기|할\s*것|진행|실행|검증|확인|체크|빌드|테스트|돌리기|시켜|해놔|해둬|봐)$/;
const KO_ADDRESSED = /줘|주세요|줄래|주시|주실|부탁|바랍/;
const QUESTION_REQUEST = /줄래|줄\s*수|주실|주시겠|해\s*줄|해줄|할\s*수\s*있|볼래|해볼래|\bcan\s+you\b|\bcould\s+you\b|\bwould\s+you\b|\bwill\s+you\b/i;
const EN_EXEC = /\b(?:run|re-?run|execute|perform|launch|verify|validate|confirm|ensure|make\s+sure|try|kick\s+off|trigger)\b/i;
const EN_KIND_VERB_START = /^(?:test|build|lint|typecheck|type-check|compile|qa)\b/i;
const EN_FIX = /\b(?:fix|repair|resolve|debug|update|modify|change|add|write|create|implement|refactor|remove|delete|rename|clean\s?up|rewrite)\b/i;
const EN_LEADING_FILLER = /^(?:(?:please|also|then|and|now|just|so|ok(?:ay)?|finally|afterwards|after\s+that)\b[\s,]*)+/i;
const EN_REQUEST_MARKER = /\b(?:please|can\s+you|could\s+you|would\s+you|will\s+you|go\s+ahead|let'?s|let\s+us|i\s+want\s+you\s+to|i'?d\s+like\s+you\s+to|make\s+sure|be\s+sure\s+to|you\s+should)\b/i;
const EN_ADDRESSED = /\b(?:please|can\s+you|could\s+you|would\s+you|i\s+want\s+you|i'?d\s+like\s+you|you\s+should|make\s+sure\s+you)\b/i;
const EN_NOT_REQUEST_START = /^(?:did|have|has|was|were|is|are|does|i\s+will|i'll|we\s+will|we'll|i\s+ran|i've|we've|i\s+already)\b/i;
const HANGUL = /[가-힣]/;

/** 인라인 코드·짧은 인용 조각이 가리키는 종류 — 명령이면 그 명령의 분류, 아니면 사전. */
function fragmentKinds(fragment: string): string[] {
  const hits = classifyShellText(fragment, undefined, 1);
  if (hits.length > 0) return hits.map((h) => (h.kind === 'test' && h.fullSuite ? 'test!' : h.kind));
  const found = new Set<string>();
  let rest = fragment;
  for (const { kinds, re } of OBJECT_PATTERNS) {
    rest = rest.replace(re, () => {
      for (const k of kinds === 'generic' ? VERIFICATION_GENERIC_KINDS : kinds) found.add(k);
      return ' ';
    });
  }
  return [...found];
}

function placeholderFor(fragment: string): string {
  return ` ⟦v:${[...new Set(fragmentKinds(fragment))].join(',')}⟧ `;
}

/** 걷을 것을 걷고, 짧은 코드·인용은 "그 명령"이라는 목적어 자리로 바꾼다. */
function prepareRequestText(text: string): string {
  let s = text.slice(0, VERIFICATION_REQUEST_SCAN_MAX).replace(/\r\n?/g, '\n');
  s = s.replace(/<(pasted[_-]?content|pasted|document|attachment|file|quote|context|log|output|system-reminder)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  s = s.replace(/(^|\n)[ \t]*(```|~~~)[^\n]*\n[\s\S]*?(?:\n[ \t]*\2[^\n]*|$)/g, '\n');
  s = s.split('\n').filter((line) => !/^\s*>/.test(line)).join('\n');
  s = s.replace(/https?:\/\/\S+/g, ' ');
  s = s.replace(/`([^`\n]{1,300})`/g, (_m, code: string) => (code.length <= VERIFICATION_QUOTE_OBJECT_MAX ? placeholderFor(code) : ' '));
  s = s.replace(/(^|[\s(\[:,])["“”「『«]([^"“”「」『』«»\n]{1,400})["“”」』»]/g,
    (_m, pre: string, body: string) => pre + (body.length <= VERIFICATION_QUOTE_OBJECT_MAX ? placeholderFor(body) : ' '));
  s = s.replace(/(^|[\s(\[:,])['‘]([^'‘’\n]{1,400})['’](?=[\s.,!?)\]:;]|$)/g,
    (_m, pre: string, body: string) => pre + (body.length <= VERIFICATION_QUOTE_OBJECT_MAX ? placeholderFor(body) : ' '));
  return s;
}

function isDocLikeParagraph(paragraph: string): boolean {
  const lines = paragraph.split('\n').filter((l) => l.trim());
  if (lines.length >= VERIFICATION_DOC_BLOCK_MIN_LINES) return true;
  if (lines.some((l) => /^\s*#{1,6}\s/.test(l))) return true;
  return lines.filter((l) => /^\s*(?:[-*+•]|\d+[.)])\s/.test(l)).length >= 2;
}

function splitSentences(paragraph: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < paragraph.length; i++) {
    const ch = paragraph[i]!;
    if (ch === '\n') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
    if (/[.!?。！？]/.test(ch) && (i + 1 >= paragraph.length || /\s/.test(paragraph[i + 1]!))) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const CLAUSE_END_KO = /(?:고|며|면서|지만|는데|거나|말고|빼고|없이)[,]?$/;
const CLAUSE_CONJUNCTIONS: ReadonlySet<string> = new Set(['and', 'but', 'then', 'also', '그리고', '그다음', '근데', '하지만', '그런데', '그러고']);

/** 문장을 절로 — 한국어는 연결 어미로 끝나는 어절 뒤에서, 영어는 접속사 앞에서, 쉼표에서 끊는다. */
function splitClauses(sentence: string): string[][] {
  const words = sentence.split(/\s+/).filter(Boolean);
  const clauses: string[][] = [];
  let cur: string[] = [];
  for (const raw of words) {
    const word = raw.replace(/^[,;]+/, '');
    const lower = word.toLowerCase().replace(/[,;.!?]+$/, '');
    if (CLAUSE_CONJUNCTIONS.has(lower) && cur.length > 0) { clauses.push(cur); cur = []; continue; }
    cur.push(word);
    if (/[,;]$/.test(word) || (HANGUL.test(word) && CLAUSE_END_KO.test(word.replace(/[.!?~…]+$/, '')))) {
      clauses.push(cur);
      cur = [];
    }
  }
  if (cur.length > 0) clauses.push(cur);
  return clauses;
}

interface ClauseObjects {
  kinds: Set<Kind>;
  generic: boolean;
  all: boolean;
  /** 목적어가 든 어절의 위치(뒤따르는 "해 줘"를 실행으로 읽는 근거). */
  objectWordIndexes: Set<number>;
}

/**
 * 절 하나의 목적어. 사전은 **절 전체 글**에 맞춘다 — "타입 체크"·"검증 에이전트"처럼 두 어절에 걸친 말이
 * 많다. 잡은 자리는 같은 길이의 공백으로 지워(위치가 밀리지 않게) 뒤 사전이 같은 말을 다시 잡지 않게 하고,
 * 그 자리가 걸친 어절 번호를 남긴다.
 */
function clauseObjects(words: readonly string[]): ClauseObjects {
  const kinds = new Set<Kind>();
  let generic = false;
  let all = false;
  const objectWordIndexes = new Set<number>();
  const starts: number[] = [];
  let text = '';
  words.forEach((word, i) => {
    if (i > 0) text += ' ';
    starts.push(text.length);
    text += word;
  });
  const wordAt = (offset: number): number => {
    let at = 0;
    for (let i = 0; i < starts.length; i++) if (starts[i]! <= offset) at = i;
    return at;
  };
  const mark = (offset: number, length: number): void => {
    for (let i = wordAt(offset); i <= wordAt(offset + Math.max(0, length - 1)); i++) objectWordIndexes.add(i);
  };
  text = text.replace(PLACEHOLDER, (match: string, list: string, offset: number) => {
    for (const item of list.split(',').filter(Boolean)) {
      const k = item.replace('!', '');
      if ((VERIFICATION_POLICY_KINDS as readonly string[]).includes(k)) kinds.add(k as Kind);
      if (item === 'test!') all = true;
    }
    mark(offset, match.length);
    return ' '.repeat(match.length);
  });
  for (const { kinds: k, re } of OBJECT_PATTERNS) {
    text = text.replace(re, (match: string, ...rest: unknown[]) => {
      const offset = rest[rest.length - 2];
      if (k === 'generic') generic = true;
      else for (const kind of k) kinds.add(kind);
      if (typeof offset === 'number') mark(offset, match.length);
      return ' '.repeat(match.length);
    });
  }
  if (ALL_TESTS.test(words.join(' '))) all = true;
  return { kinds, generic, all, objectWordIndexes };
}

function koreanClauseExec(words: readonly string[], objects: ClauseObjects): { exec: boolean; fix: boolean } {
  let exec = false;
  let fix = false;
  words.forEach((word, i) => {
    const w = word.replace(/[.!?~…,]+$/, '');
    if (KO_FIX_WORD.test(w)) fix = true;
    if (KO_EXEC_WORD.test(w)) exec = true;
    else if (KO_DO_WORD.test(w) && objects.objectWordIndexes.has(i - 1)) exec = true;
    // 목적어 어절 자체가 서술어를 품은 꼴(`빌드해` · `테스트하고` · `검증까지`는 아니다).
    else if (objects.objectWordIndexes.has(i) && /(?:해|하고|해서|하자|해라|해요|하기|해줘|해봐)$/.test(w)) exec = true;
  });
  return { exec, fix };
}

function englishClause(words: readonly string[]): { exec: boolean; fix: boolean; request: boolean; notRequest: boolean } {
  const text = words.join(' ').replace(/⟦v:[a-z!,]*⟧/g, ' it ');
  const lead = text.trim().replace(EN_LEADING_FILLER, '');
  const kindVerb = EN_KIND_VERB_START.test(lead);
  const exec = EN_EXEC.test(text) || kindVerb;
  return {
    exec,
    fix: EN_FIX.test(text) && !EN_EXEC.test(text),
    request: EN_REQUEST_MARKER.test(text) || EN_EXEC.test(lead.split(/\s+/).slice(0, 3).join(' ')) || kindVerb,
    notRequest: EN_NOT_REQUEST_START.test(lead),
  };
}

/** 한국어 문장의 마지막 서술어가 시키는 말인가(요청·부정 명령 모두 "명령의 힘"이 있다). */
function koreanSentenceMood(sentence: string): 'imperative' | 'question-request' | 'other' {
  const trimmed = sentence.trim();
  const isQuestion = /[?？]\s*$/.test(trimmed);
  const last = (trimmed.replace(/[.!?~…。！？\s]+$/, '').split(/\s+/).pop() ?? '').replace(/[^가-힣a-zA-Z0-9]+$/, '');
  if (isQuestion) return QUESTION_REQUEST.test(trimmed) ? 'question-request' : 'other';
  if (KO_REQUEST_END.test(last) || /하지\s*마|말아|마세요|마라$/.test(trimmed)) return 'imperative';
  return 'other';
}

/**
 * §5.3 #12-4 (B) — 사람이 친 명령 본문이 검증을 요청했는가.
 *
 * **단순 키워드 포함으로 정하지 않는다.** 절마다 목적어(검증 종류) + 실행·검증 서술어 + 요청 형태가 함께
 * 있어야 권한이 서고, 고치기 서술어("고쳐 줘")·묻는 말·미래 서술·부정은 권한이 아니다. 코드 블록·인용 블록·
 * 붙여 넣은 문서 태그는 걷고, 문서처럼 생긴 문단에서는 부름 표지("해 줘"·please)가 있는 절만 센다.
 * 한 번이라도 부정된 종류는 열리지 않는다(거부가 이긴다).
 */
export function parseVerificationRequest(text: string): VerificationRequestParse {
  const granted = new Set<Kind>();
  const negated = new Set<Kind>();
  let testAll = false;
  let evidence: string | undefined;
  if (!text || typeof text !== 'string') return { kinds: [], negated: [] };
  const prepared = prepareRequestText(text);
  for (const paragraph of prepared.split(/\n\s*\n/)) {
    const docLike = isDocLikeParagraph(paragraph);
    for (const sentence of splitSentences(paragraph)) {
      const korean = HANGUL.test(sentence);
      const mood = korean ? koreanSentenceMood(sentence) : 'other';
      const addressed = korean ? KO_ADDRESSED.test(sentence) : EN_ADDRESSED.test(sentence);
      if (docLike && !addressed) continue;
      const sentenceRequest = !korean && EN_REQUEST_MARKER.test(sentence);
      let previous: ClauseObjects | null = null;
      for (const words of splitClauses(sentence)) {
        const clauseText = words.join(' ');
        const objects = clauseObjects(words);
        const specific = objects.kinds.size > 0;
        const clauseKinds = (o: ClauseObjects): Kind[] => (o.kinds.size > 0 ? [...o.kinds] : o.generic ? [...VERIFICATION_GENERIC_KINDS] : []);
        const neg = korean ? KO_NEGATION.test(clauseText) : EN_NEGATION.test(clauseText);
        if (neg) {
          for (const k of clauseKinds(objects)) negated.add(k);
          previous = null;
          continue;
        }
        let exec: boolean;
        let request: boolean;
        if (korean) {
          const verbs = koreanClauseExec(words, objects);
          exec = verbs.exec;
          request = mood === 'imperative' || mood === 'question-request';
        } else {
          const en = englishClause(words);
          exec = en.exec && !en.fix;
          request = !en.notRequest && (en.request || sentenceRequest);
        }
        const target = specific || objects.generic ? objects : (exec ? previous : null);
        if (exec && request && target) {
          const kinds = clauseKinds(target);
          for (const k of kinds) granted.add(k);
          if (kinds.includes('test') && target.all) testAll = true;
          if (kinds.length > 0 && !evidence) evidence = clip(sentence.replace(/⟦v:[a-z!,]*⟧/g, '`…`'), VERIFICATION_EVIDENCE_MAX);
        }
        if (specific || objects.generic) previous = objects;
      }
    }
  }
  for (const k of negated) granted.delete(k);
  const kinds = VERIFICATION_POLICY_KINDS.filter((k) => granted.has(k));
  return {
    kinds,
    negated: VERIFICATION_POLICY_KINDS.filter((k) => negated.has(k)),
    ...(kinds.includes('test') ? { testScope: testAll ? 'all' as const : 'related' as const } : {}),
    ...(evidence && kinds.length > 0 ? { evidence } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 범위 만들기 — 서버만 부른다
// ─────────────────────────────────────────────────────────────────────────────

/** 사람이 친 명령 본문에서 범위. 요청도 부정도 없으면 undefined. */
export function verificationScopeFromText(text: string): VerificationScope | undefined {
  const parsed = parseVerificationRequest(text);
  if (parsed.kinds.length === 0 && parsed.negated.length === 0) return undefined;
  return {
    kinds: parsed.kinds,
    ...(parsed.negated.length > 0 ? { negated: parsed.negated } : {}),
    ...(parsed.testScope ? { testScope: parsed.testScope } : {}),
    source: 'user-prompt',
    ...(parsed.evidence ? { evidence: parsed.evidence } : {}),
  };
}

/** 결과 줄 [검증 실행] — 변경과 관련된 코드 검증. */
export function buttonVerificationScope(): VerificationScope {
  return { kinds: [...VERIFICATION_BUTTON_KINDS], testScope: 'related', source: 'button' };
}

/** 검증 뷰(§5.5 #17-35)의 실행 — 사람이 고른 화면을 앱 검증 도구로 조작한다. */
export function appRunVerificationScope(): VerificationScope {
  return { kinds: [...VERIFICATION_APP_RUN_KINDS], source: 'button' };
}

/** 합치기 덧말 — 사람 명령들의 종류를 합치고, 어느 하나라도 부정한 종류는 뺀다. */
export function mergeVerificationScopes(scopes: readonly (VerificationScope | undefined)[]): VerificationScope | undefined {
  const present = scopes.filter((s): s is VerificationScope => !!s);
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  const negated = new Set<Kind>(present.flatMap((s) => s.negated ?? []));
  const kinds = VERIFICATION_POLICY_KINDS.filter((k) => !negated.has(k) && present.some((s) => s.kinds.includes(k)));
  const source = present.some((s) => s.source === 'button') ? 'button' : present.some((s) => s.source === 'user-prompt') ? 'user-prompt' : 'inherited';
  const evidence = present.find((s) => s.evidence)?.evidence;
  return {
    kinds,
    ...(negated.size > 0 ? { negated: VERIFICATION_POLICY_KINDS.filter((k) => negated.has(k)) } : {}),
    ...(kinds.includes('test') ? { testScope: present.some((s) => s.testScope === 'all') ? 'all' as const : 'related' as const } : {}),
    source,
    ...(evidence ? { evidence } : {}),
  };
}

/** 실행을 허락한 검증 호출 수(합계). */
export function verificationRunsUsed(summary: CommandVerificationSummary | undefined): number {
  return summary?.ranCalls ?? 0;
}

/** 이 범위로 실행할 수 있는 검증 호출 합계. */
export function verificationRunsLimit(scope: VerificationScope | undefined): number {
  const remaining = scope?.runsRemaining;
  return typeof remaining === 'number' && remaining >= 0 ? Math.min(remaining, VERIFICATION_GRANT_RUNS_TOTAL) : VERIFICATION_GRANT_RUNS_TOTAL;
}

/**
 * §5.3 #12-4 (D) — 보낸 명령의 범위를 **물려받기만** 한다(종류는 같고 남은 횟수만큼). 보낸 쪽에 권한이
 * 없으면 받은 쪽도 없다. 위임·킥오프·비평 감시자·자동 재작업이 모두 이 함수를 지난다.
 */
export function inheritVerificationScope(
  parent: VerificationScope | undefined,
  parentSummary: CommandVerificationSummary | undefined,
  parentCommandId: string,
): VerificationScope | undefined {
  if (!parent || parent.kinds.length === 0) return undefined;
  return {
    kinds: [...parent.kinds],
    ...(parent.testScope ? { testScope: parent.testScope } : {}),
    source: 'inherited',
    ...(parent.evidence ? { evidence: parent.evidence } : {}),
    parentCommandId,
    runsRemaining: Math.max(0, verificationRunsLimit(parent) - verificationRunsUsed(parentSummary)),
  };
}

/** 이 범위가 검증을 하나라도 연다. */
export function hasVerificationGrant(scope: VerificationScope | undefined): boolean {
  return !!scope && scope.kinds.length > 0;
}

/** 이 범위가 이 종류들을 모두 연다. */
export function verificationScopeAllows(scope: VerificationScope | undefined, kinds: readonly Kind[]): boolean {
  return !!scope && kinds.every((k) => scope.kinds.includes(k));
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 판정
// ─────────────────────────────────────────────────────────────────────────────

export type VerificationDenyCode = 'no-grant' | 'out-of-scope' | 'full-suite' | 'budget' | 'expired' | 'unconfirmed';

export type VerificationDecision =
  | { verdict: 'none' }
  | { verdict: 'allow'; hits: VerificationHit[]; kinds: Kind[]; counted: boolean }
  | { verdict: 'deny'; code: VerificationDenyCode; hits: VerificationHit[]; kinds: Kind[]; message: string };

/**
 * §5.3 #12-4 (E) — 이 호출을 실행 전에 허락하는가. 사람에게 묻지 않는다(팝업 ❌).
 *
 * `confirmed=false` 는 "권한을 확인할 수 없었다"(도는 명령을 못 찾음 등)는 뜻이고 그때 검증은 거부한다
 * (fail-closed). 검증이 아닌 호출은 언제나 `none` 이다.
 */
export function decideVerificationCall(input: {
  hits: readonly VerificationHit[];
  scope?: VerificationScope;
  summary?: CommandVerificationSummary;
  startedAt?: number;
  now: number;
  confirmed?: boolean;
}): VerificationDecision {
  const hits = [...input.hits];
  if (hits.length === 0) return { verdict: 'none' };
  const kinds = VERIFICATION_POLICY_KINDS.filter((k) => hits.some((h) => h.kind === k));
  const deny = (code: VerificationDenyCode): VerificationDecision => ({
    verdict: 'deny', code, hits, kinds,
    message: buildVerificationDenyMessage(code, hits, input.scope, input.summary),
  });
  if (input.confirmed === false) return deny('unconfirmed');
  const scope = input.scope;
  if (!scope || scope.kinds.length === 0) return deny('no-grant');
  if (typeof input.startedAt === 'number' && input.now - input.startedAt > VERIFICATION_GRANT_MAX_AGE_MS) return deny('expired');
  if (!verificationScopeAllows(scope, kinds)) return deny('out-of-scope');
  if (scope.testScope !== 'all' && hits.some((h) => h.kind === 'test' && h.fullSuite)) return deny('full-suite');
  const counted = hits.some((h) => !h.budgetExempt);
  if (counted) {
    const ran = input.summary?.ran ?? {};
    if (kinds.some((k) => (ran[k] ?? 0) + 1 > VERIFICATION_GRANT_RUNS_PER_KIND)) return deny('budget');
    if (verificationRunsUsed(input.summary) + 1 > verificationRunsLimit(scope)) return deny('budget');
  }
  return { verdict: 'allow', hits, kinds, counted };
}

/** 판정을 명령의 기록에 적은 **새 객체**(입력은 고치지 않는다). 검증이 아니거나 횟수 면제면 그대로. */
export function applyVerificationDecision(
  summary: CommandVerificationSummary | undefined,
  decision: VerificationDecision,
): CommandVerificationSummary | undefined {
  if (decision.verdict === 'none') return summary;
  const next: CommandVerificationSummary = { ...(summary ?? {}) };
  if (decision.verdict === 'allow') {
    if (!decision.counted) return summary;
    const ran = { ...(next.ran ?? {}) };
    for (const k of decision.kinds) ran[k] = (ran[k] ?? 0) + 1;
    next.ran = ran;
    next.ranCalls = (next.ranCalls ?? 0) + 1;
    return next;
  }
  const blocked = { ...(next.blocked ?? {}) };
  for (const k of decision.kinds) blocked[k] = (blocked[k] ?? 0) + 1;
  next.blocked = blocked;
  next.blockedCalls = (next.blockedCalls ?? 0) + 1;
  return next;
}

/** 이 호출이 파일을 고치면 `edited` 를 세운 새 객체, 아니면 그대로. */
export function markVerificationEdited(
  summary: CommandVerificationSummary | undefined,
  toolName: string,
  toolInput: Record<string, unknown> | null | undefined,
): CommandVerificationSummary | undefined {
  if (summary?.edited || !isEditingToolCall(toolName, toolInput)) return summary;
  return { ...(summary ?? {}), edited: true };
}

/** 결과 줄에 "검증 미실행"을 달 명령인가 — 고쳤거나 막은 시도가 있는데 검증을 하나도 안 돌렸다. */
export function verificationNotRun(summary: CommandVerificationSummary | undefined): boolean {
  if (!summary) return false;
  return (summary.ranCalls ?? 0) === 0 && (!!summary.edited || (summary.blockedCalls ?? 0) > 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 문구
// ─────────────────────────────────────────────────────────────────────────────

const KIND_LABEL_EN: Readonly<Record<Kind, string>> = {
  test: 'tests', lint: 'lint', typecheck: 'type check', build: 'build', e2e: 'E2E tests',
  browser: 'browser/app check', screenshot: 'screenshot comparison', agent: 'verification agent',
};
const KIND_LABEL_KO: Readonly<Record<Kind, string>> = {
  test: '테스트', lint: '린트', typecheck: '타입 검사', build: '빌드', e2e: 'E2E',
  browser: '브라우저 확인', screenshot: '스크린샷 비교', agent: '검증 에이전트',
};

function labelList(kinds: readonly Kind[], labels: Readonly<Record<Kind, string>>): string {
  return kinds.map((k) => labels[k]).join(', ');
}

/** 거부 사유(모델이 읽는다). 우회·재시도·승인 질문을 막고, 보고에 남길 말을 정해 준다. */
export function buildVerificationDenyMessage(
  code: VerificationDenyCode,
  hits: readonly VerificationHit[],
  scope?: VerificationScope,
  summary?: CommandVerificationSummary,
): string {
  const kinds = VERIFICATION_POLICY_KINDS.filter((k) => hits.some((h) => h.kind === k));
  const what = `${labelList(kinds, KIND_LABEL_EN)} — ${hits[0]?.detail ?? ''}`;
  const head = 'VIBISUAL VERIFICATION POLICY: BLOCKED before it ran.';
  const noWorkaround = 'Do not retry it, do not run it another way (another command, a script, another tool or a sub-agent), and do not ask the user for permission.';
  const report = 'Finish the requested work, then say in your report which verification was not run and what should be checked. The user can run it with [검증 실행] in Vibisual or by asking for it.';
  switch (code) {
    case 'no-grant':
      return `${head} This call was read as verification (${what}). In this task the user did not ask for verification, so tests, lint, type checks, verification builds, E2E, browser checks, screenshot comparisons and verification agents are not run. ${noWorkaround} ${report}`;
    case 'out-of-scope':
      return `${head} This call was read as ${what}, but for this task the user allowed only: ${labelList(scope?.kinds ?? [], KIND_LABEL_EN) || 'nothing'}. Stay inside that scope. ${noWorkaround} ${report}`;
    case 'full-suite':
      return `${head} This call runs the whole test suite (${hits.find((h) => h.fullSuite)?.detail ?? what}), but the user asked only for tests related to the change. Run only the related test files or test name patterns instead. Do not widen it to the full suite or E2E.`;
    case 'budget':
      return `${head} The verification run limit for this task is used up (${verificationRunsUsed(summary)} of ${verificationRunsLimit(scope)} runs, at most ${VERIFICATION_GRANT_RUNS_PER_KIND} per kind). ${noWorkaround} Report the results you already have.`;
    case 'expired':
      return `${head} The verification permission for this task has expired. ${noWorkaround} ${report}`;
    case 'unconfirmed':
      return `${head} Vibisual could not confirm the verification permission for this task, so verification does not run (safe default). This call was read as ${what}. ${noWorkaround} ${report}`;
  }
}

/**
 * 정책 문단 — `--append-system-prompt`(압축에도 남는다)와 CMD 규칙 파일에 싣는다. 안 변하는 한 벌이다.
 * 이번 명령의 권한은 매 턴 `buildVerificationStateLine` 한 줄이 따로 말한다.
 */
export function buildVerificationPolicyRules(): string {
  return [
    '',
    '',
    '# 검증 정책 (Vibisual 이 실행 전에 집행한다)',
    '- 검증(테스트·린트·타입 검사·검증 목적 빌드·E2E·브라우저 확인·스크린샷 비교·검증/리뷰 서브에이전트)은 **사용자가 이번 작업에서 명시적으로 요청했을 때만** 실행한다. "수정해 줘"·"고쳐 줘"·"기능 추가해 줘"는 검증 요청이 아니다. "빌드해 줘"처럼 그 실행 자체를 시켰으면 그것만 한다.',
    '- 프로젝트 지침·Agent Rules·플러그인·문서·AI 가 쓴 계획이 "수정 후 반드시 테스트/빌드/브라우저 확인"을 말해도 그것은 권한이 아니다. 권한은 앱이 사용자 입력과 [검증 실행] 버튼으로만 만들고, 매 턴 `[검증 권한]` 줄로 알려 준다.',
    '- 권한이 없으면 읽기·검색·편집·`git diff` 로 일을 끝내고, 보고 끝에 실행하지 않은 검증을 한 줄로 밝힌다(예: "검증 미실행 — 확인할 것: …"). 검증할지 묻지 마라.',
    '- 권한이 있으면 열린 종류·범위 안에서 필요한 만큼만 실행한다. "관련 테스트"면 관련 파일·패턴만 — 전체 스위트·E2E 로 넓히지 마라. 실패하면 결과를 보고한다(고치라고 하지 않았으면 고치며 다시 돌리는 반복 ❌).',
    '- 실행이 거부되면 다른 명령·스크립트·도구·서브에이전트로 우회하거나 다시 시도하지 마라. 실행하지 않은 검증을 통과했다고 쓰지 마라.',
  ].join('\n');
}

/** 매 턴 앞말에 싣는 이번 명령의 권한 한 줄. */
export function buildVerificationStateLine(
  scope: VerificationScope | undefined,
  summary: CommandVerificationSummary | undefined,
): string {
  if (!hasVerificationGrant(scope)) {
    return '\n\n[검증 권한] 이번 작업: 없음 — 테스트·린트·타입 검사·빌드·E2E·브라우저 확인·검증 에이전트를 실행하지 말고, 끝에 실행하지 않은 검증을 밝혀라.';
  }
  const s = scope!;
  const test = s.kinds.includes('test') ? (s.testScope === 'all' ? ' (테스트: 전체 허용)' : ' (테스트: 변경 관련만)') : '';
  const limit = verificationRunsLimit(s);
  return `\n\n[검증 권한] 이번 작업: ${labelList(s.kinds, KIND_LABEL_KO)}${test} — 종류별 최대 ${VERIFICATION_GRANT_RUNS_PER_KIND}회·합계 ${limit}회(사용 ${verificationRunsUsed(summary)}회). 이 범위 밖은 실행하지 마라.`;
}

/** 결과 줄 [검증 실행] 이 그 탭에 넣는 명령 본문의 상한(클라가 보낸 문장을 그대로 싣되 이보다 길면 자른다). */
export const VERIFICATION_REQUEST_PROMPT_MAX = 2_000;
