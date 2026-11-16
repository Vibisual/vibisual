/**
 * §5.4 #36 (C) 연결 강제 — 앱 노드에 이어진 세션이 그 앱을 비켜 결과물을 굽는지 판정한다(순수 — 파일은 호출부가 읽어 넘긴다).
 * 규칙은 앱이 선언한다(§5.13 (P-4)). 셸 해석은 `bashCommandPaths` 한 벌을 쓴다.
 */

import {
  forEachShellSegment,
  isShellToolName,
  joinShellPath,
  normalizeShellCommandName,
  readHeredocDelimiter,
  shellCommandIndex,
  shellDialectOfTool,
} from './bashCommandPaths.js';

export interface AppToolRule {
  /** 명령 자리에 서기만 해도 위반인 실행 파일(소문자·확장자 없음). */
  readonly commands: readonly string[];
  /** 출력이 `outputPattern` 에 맞을 때만 위반인 실행 파일 — 입력(`-i`)은 보지 않아 분석·소리 처리는 통과한다. */
  readonly outputCommands: readonly string[];
  /** `g` 플래그 ❌ — 공유 객체라 `lastIndex` 가 남는다. */
  readonly outputPattern: RegExp;
  /** 스크립트 본문에 있으면 위반인 표지(라이브러리 등). `g` 플래그 ❌. */
  readonly scriptMarkers: readonly RegExp[];
  readonly matchesInvocation?: (name: string, args: readonly string[]) => boolean;
  /** 실행 증거가 필요한 규칙은 기본 문자열 검사 대신 이 판정을 쓴다. */
  readonly findScriptEvidence?: (code: string) => string | null;
}

/** 앱 서버 몫이 내는 연결 강제 선언 — `H` 는 코어가 건네는 호스트(앱은 코어를 import 하지 않는다). */
export interface AppAgentLink<H> {
  readonly rule: AppToolRule;
  /** 노드에 작업 문서가 없으면 만들어 열쇠를 돌려준다(코어가 노드에 묶는다). 못 만들면 null. */
  ensureRef(host: H, projectName: string, node: AppLinkNode): string | null | Promise<string | null>;
  /** 세션의 첫 도구 호출에 한 번 싣는 안내 한 줄. */
  pointer(target: AppLinkTarget): string;
  /** 모델이 읽는 거부 사유. */
  denyReason(target: AppLinkTarget, evidence: string): string;
}

export interface AppLinkNode {
  readonly id: string;
  readonly title?: string | undefined;
  readonly ref?: string | undefined;
}

export interface AppLinkTarget extends AppLinkNode {
  readonly projectName: string;
}

/** 패키지를 내려받아 실행하는 러너 — 첫 비-플래그 인자가 실행 대상이다. */
const PACKAGE_RUNNERS: ReadonlySet<string> = new Set(['npx', 'pnpx', 'bunx']);
/** 패키지 매니저 — 이 하위 명령 다음 낱말이 실행 대상이다. */
const PACKAGE_MANAGERS: ReadonlySet<string> = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const PACKAGE_EXEC_VERBS: ReadonlySet<string> = new Set(['exec', 'dlx', 'x']);
/** 스크립트 파일을 돌리는 인터프리터. */
const SCRIPT_INTERPRETERS: ReadonlySet<string> = new Set([
  'python', 'python3', 'py', 'pypy', 'pypy3', 'node', 'bun', 'deno', 'tsx', 'ts-node', 'bash', 'sh', 'zsh', 'dash', 'pwsh', 'powershell',
]);
/** 인터프리터의 인라인 코드 플래그. */
const INLINE_CODE_FLAG = /^(?:-c|-e|--eval|-p|--print|-command|-encodedcommand)$/i;
const SCRIPT_FILE = /\.(?:py|pyw|js|mjs|cjs|ts|mts|cts|sh|bash|zsh|ps1)$/i;
/** `S=a/b` · PowerShell `$S=a/b`. */
const VARIABLE_ASSIGNMENT = /^\$?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
const POSIX_BODY_START = new Set(['do', 'then', 'else']);

/** 호출 하나에서 뽑은 판정 재료. */
export interface AppToolInvocation {
  /** 즉시 위반의 증거(실행 파일 이름). 없으면 null. */
  readonly direct: string | null;
  /** 내용을 읽어 봐야 하는 스크립트 파일(기준 폴더를 이은 경로 — 상대면 호출부가 cwd 에 잇는다). */
  readonly scripts: readonly string[];
  /** `npm run x` 꼴 — `dir` 의 package.json 에서 `name` 스크립트를 찾아 다시 판정한다. */
  readonly packageScripts: readonly { readonly dir: string | null; readonly name: string }[];
  /** 인라인·heredoc 코드가 돈다 — 명령 글 전체를 코드로 본다. */
  readonly inlineCode: boolean;
}

const EMPTY_INVOCATION: AppToolInvocation = { direct: null, scripts: [], packageScripts: [], inlineCode: false };

function expandVariables(arg: string, vars: ReadonlyMap<string, string>): string {
  if (!arg.includes('$')) return arg;
  return arg.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (whole, a?: string, b?: string) => vars.get((a ?? b)!) ?? whole);
}

/** `-i <입력>` 을 뺀 인자 — 영상을 입력으로만 읽는 분석·소리 추출을 위반으로 보지 않게. */
function withoutInputs(args: readonly string[]): string {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-i') { i++; continue; }
    out.push(args[i]!);
  }
  return out.join(' ');
}

function firstOperand(args: readonly string[]): string | null {
  return args.find((a) => !a.startsWith('-')) ?? null;
}

/** 패키지 지정(`@remotion/cli@4`)은 이름 일부로 견준다 — 러너를 거친 자리에서만. */
function packageSpecHit(spec: string | null, rule: AppToolRule): string | null {
  if (!spec) return null;
  const lower = spec.toLowerCase();
  return [...rule.commands, ...rule.outputCommands].find((name) => lower.includes(name)) ?? null;
}

/** 도구 호출을 판정 재료로 푼다. 셸 도구가 아니면 빈 재료. */
export function readAppToolInvocation(
  toolName: string,
  toolInput: Readonly<Record<string, unknown>> | null | undefined,
  rule: AppToolRule,
): AppToolInvocation {
  const command = toolInput?.['command'];
  if (!isShellToolName(toolName) || typeof command !== 'string' || command.trim() === '') return EMPTY_INVOCATION;

  const vars = new Map<string, string>();
  const scripts: string[] = [];
  const packageScripts: { dir: string | null; name: string }[] = [];
  let direct: string | null = null;
  let inlineCode = false;

  forEachShellSegment(command, (segment, ctx) => {
    const raw = ctx.dialect === 'posix' && POSIX_BODY_START.has(segment[0] ?? '') ? segment.slice(1) : segment;
    // PowerShell 의 `$S = x` 는 세 낱말로 온다.
    if (raw.length >= 3 && raw[0]!.startsWith('$') && raw[1] === '=') {
      vars.set(raw[0]!.slice(1), expandVariables(raw.slice(2).join(' '), vars));
      return;
    }
    for (const token of raw) {
      const assigned = token.match(VARIABLE_ASSIGNMENT);
      if (!assigned) break;
      vars.set(assigned[1]!, expandVariables(assigned[2]!, vars));
    }
    if (ctx.wrapper) return;
    const at = shellCommandIndex(raw);
    if (at < 0) return;
    const name = normalizeShellCommandName(expandVariables(raw[at]!, vars));
    const args = raw.slice(at + 1).map((a) => expandVariables(a, vars));

    if (rule.commands.includes(name) || rule.matchesInvocation?.(name, args)) { direct = name; return true; }
    if (rule.outputCommands.includes(name)) {
      if (rule.outputPattern.test(withoutInputs(args))) { direct = name; return true; }
      return;
    }
    if (PACKAGE_RUNNERS.has(name)) {
      const hit = packageSpecHit(firstOperand(args), rule);
      if (hit) { direct = hit; return true; }
      return;
    }
    if (PACKAGE_MANAGERS.has(name)) {
      const verb = firstOperand(args);
      if (verb && PACKAGE_EXEC_VERBS.has(verb)) {
        const hit = packageSpecHit(firstOperand(args.slice(args.indexOf(verb) + 1)), rule);
        if (hit) { direct = hit; return true; }
        return;
      }
      if (verb === 'run' || verb === 'run-script') {
        const script = firstOperand(args.slice(args.indexOf(verb) + 1));
        if (script && SCRIPT_FILE.test(script)) scripts.push(joinShellPath(ctx.base, script)); // `bun run x.ts`
        else if (script) packageScripts.push({ dir: ctx.base, name: script });
        return;
      }
      if (verb && name !== 'npm') packageScripts.push({ dir: ctx.base, name: verb }); // `pnpm build`·`yarn build` 꼴
    }
    if (SCRIPT_INTERPRETERS.has(name)) {
      if (readHeredocDelimiter(raw) !== null || args.includes('-') || args.some((a) => INLINE_CODE_FLAG.test(a))) inlineCode = true;
      const script = args.find((a) => !a.startsWith('-') && SCRIPT_FILE.test(a));
      if (script) scripts.push(joinShellPath(ctx.base, script));
    }
    return;
  }, { dialect: shellDialectOfTool(toolName) });

  return { direct, scripts, packageScripts, inlineCode };
}

/** 주석·문서 문자열을 걷는다 — 사용법 안내의 `<film.mp4>` 가 분석 도구를 위반으로 만들지 않게. */
export function stripScriptComments(text: string): string {
  return text
    .replace(/"""[\s\S]*?"""|'''[\s\S]*?'''|\/\*[\s\S]*?\*\//g, ' ')
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:#|\/\/)/.test(line))
    .join('\n');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 스크립트·인라인 코드가 규칙을 어기는가 — 어기면 증거, 아니면 null. */
export function findAppToolScriptEvidence(text: string, rule: AppToolRule): string | null {
  const code = stripScriptComments(text);
  if (rule.findScriptEvidence) return rule.findScriptEvidence(code);
  for (const marker of rule.scriptMarkers) {
    const hit = code.match(marker);
    if (hit) return hit[0];
  }
  for (const name of rule.commands) {
    // 코드에서 실행 파일 이름은 따옴표 안에 있거나 명령 줄의 첫 낱말이다 — 낱말 하나만 스쳐도 막으면 변수명에 걸린다.
    if (new RegExp(`['"\`]${escapeRegExp(name)}(?:\\.exe)?['"\`\\s]`, 'i').test(code)) return name;
  }
  for (const name of rule.outputCommands) {
    if (new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(code) && rule.outputPattern.test(code)) return name;
  }
  return null;
}

/** 이 스크립트가 불러오는 로컬 파일 후보(같은 폴더 기준 상대 경로). 없는 후보는 호출부의 읽기가 버린다. */
export function scriptLocalImports(text: string, file: string): string[] {
  const code = stripScriptComments(text);
  const out = new Set<string>();
  if (/\.pyw?$/i.test(file)) {
    for (const m of code.matchAll(/^\s*(?:from\s+([\w.]+)\s+import\b|import\s+([\w.]+))/gm)) {
      const moduleName = (m[1] ?? m[2])!.replace(/^\.+/, '');
      if (moduleName) out.add(`${moduleName.replace(/\./g, '/')}.py`);
    }
    return [...out];
  }
  for (const m of code.matchAll(/(?:from\s+|require\(\s*|import\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const spec = m[1]!;
    if (/\.[A-Za-z0-9]+$/.test(spec)) { out.add(spec); continue; }
    for (const ext of ['.js', '.mjs', '.cjs', '.ts']) out.add(`${spec}${ext}`);
  }
  return [...out];
}
