/**
 * Command-derived application hints, not proof that a process ran. Pure/bounded:
 * no PATH lookup, filesystem access, process enumeration or command execution.
 * Unknown syntax stays in the original command history without an invented app.
 */
import { normalizeShellCommandName, toNativeDriveShellPath } from './bashCommandPaths.js';
import { normalizePathShape, pathKey, type PlatformName } from './pathCase.js';

export interface CommandAppTarget {
  id: string;
  name: string;
  executable?: string;
  /** Grounded managed app path for icon lookup; executable stays the real runtime. */
  iconSource?: string;
  projectPath?: string;
  detection: 'command';
}

interface DetectOptions {
  cwd?: string;
  platform?: PlatformName;
}

/** Shared storage/render bounds; command/output history reuses existing Bash entries. */
export const COMMAND_ACTIVITY_LIMITS = {
  appsPerProject: 24,
  historyEntries: 500,
  historySessions: 128,
  historyBytes: 4 * 1024 * 1024,
  commandChars: 16_384,
  outputChars: 16_384,
  pathChars: 4096,
  targetsPerCommand: 4,
} as const;

// Limits bound both malicious input and routine commands embedding large scripts.
const LIMITS = {
  chars: 65_536, segments: 128, tokens: 256, depth: 4, cwdStates: 8, directoryStack: 8,
  targets: COMMAND_ACTIVITY_LIMITS.targetsPerCommand, path: COMMAND_ACTIVITY_LIMITS.pathChars,
} as const;
type Shell = 'generic' | 'posix' | 'cmd' | 'powershell';
interface Token { value: string; start: number; end: number; quoted: boolean }
type Separator = '&&' | '||' | '|' | '&' | ';' | 'end';
interface Segment { tokens: Token[]; end: number; separator: Separator }
interface DirectoryState { cwd: string | undefined; stack: Array<string | undefined>; success: boolean }

const SHELLS: Readonly<Record<string, Shell>> = {
  cmd: 'cmd', powershell: 'powershell', pwsh: 'powershell',
  bash: 'posix', sh: 'posix', zsh: 'posix', dash: 'posix', ksh: 'posix',
};

const APP_NAMES: Readonly<Record<string, string>> = {
  blender: 'Blender', unity: 'Unity', unityhub: 'Unity Hub', godot: 'Godot',
  photoshop: 'Adobe Photoshop', illustrator: 'Adobe Illustrator', afterfx: 'Adobe After Effects',
  ffmpeg: 'FFmpeg', ffprobe: 'FFmpeg', magick: 'ImageMagick', inkscape: 'Inkscape',
  code: 'Visual Studio Code', cursor: 'Cursor', rider: 'Rider', devenv: 'Visual Studio',
  git: 'Git', node: 'Node.js', nodejs: 'Node.js', npm: 'npm', npx: 'npm', pnpm: 'pnpm', yarn: 'Yarn',
  bun: 'Bun', deno: 'Deno', dotnet: '.NET', java: 'Java', javac: 'Java', cargo: 'Cargo',
  rustc: 'Rust', go: 'Go', cmake: 'CMake', ninja: 'Ninja', make: 'Make', msbuild: 'MSBuild',
  docker: 'Docker', podman: 'Podman', curl: 'curl', wget: 'wget', python: 'Python', py: 'Python',
  ruby: 'Ruby', perl: 'Perl', php: 'PHP', sqlite3: 'SQLite', psql: 'PostgreSQL',
};

// File utilities already feed file bubbles; shell syntax/cmdlets are not apps.
const NON_APPS: ReadonlySet<string> = new Set([
  'echo', 'printf', 'cat', 'head', 'tail', 'less', 'more', 'nl', 'wc', 'rg', 'grep', 'egrep', 'fgrep',
  'find', 'fd', 'ls', 'dir', 'pwd', 'cd', 'chdir', 'pushd', 'popd', 'type', 'which', 'where', 'whereis',
  'sed', 'awk', 'gawk', 'cut', 'sort', 'uniq', 'tr', 'tee', 'touch', 'cp', 'copy', 'mv', 'move', 'rm',
  'del', 'erase', 'mkdir', 'md', 'rmdir', 'rd', 'ln', 'readlink', 'realpath', 'stat', 'test', '[',
  'true', 'false', 'exit', 'return', 'break', 'continue', 'set', 'unset', 'export', 'source', '.',
  'alias', 'unalias', 'read', 'readarray', 'mapfile', 'rem', 'if', 'then', 'else', 'elif', 'fi',
  'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'function', 'select', 'switch', 'foreach',
  'try', 'catch', 'finally', 'trap', 'wait', 'sleep', 'timeout', 'ping', 'clear', 'cls', 'pause',
]);

/** A small lexer rather than a shell evaluator. Retain raw offsets for wrappers.
 * Unlike file-path tokenization, quoted separators must never become commands.
 * Heredoc/here-string bodies and comments are skipped before command splitting.
 */
function lex(source: string, shell: Shell): Segment[] {
  const segments: Segment[] = [];
  let tokens: Token[] = [];
  let value = '';
  let start = -1;
  let quoted = false;
  let quote = '';
  let overflow = false;
  let expectHeredoc = false;
  let stripTabs = false;
  const heredocs: { delimiter: string; stripTabs: boolean }[] = [];
  const push = (end: number): void => {
    if (start < 0) return;
    if (tokens.length < LIMITS.tokens) tokens.push({ value, start, end, quoted });
    else overflow = true;
    if (expectHeredoc) {
      heredocs.push({ delimiter: value, stripTabs });
      expectHeredoc = false;
    } else if (!quoted && (value === '<<' || value === '<<-')) {
      expectHeredoc = true;
      stripTabs = value === '<<-';
    }
    start = -1;
    value = '';
    quoted = false;
  };
  const finish = (end: number, separator: Separator): void => {
    push(end);
    if (!overflow && tokens.length) segments.push({ tokens, end, separator });
    tokens = [];
    overflow = false;
  };

  for (let i = 0; i < source.length && segments.length < LIMITS.segments; i++) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (quote) {
      if (ch === quote) {
        if (shell === 'powershell' && quote === "'" && next === "'") { value += "'"; i++; }
        else quote = '';
      } else if (quote === '"' && ((ch === '\\' && shell === 'posix' && /["\\$`\n]/.test(next ?? ''))
        || (ch === '`' && shell === 'powershell'))) {
        if (next && next !== '\n') value += next;
        i++;
      } else value += ch;
      continue;
    }
    if (ch === '#' && start < 0 && shell !== 'cmd') {
      while (i < source.length && source[i] !== '\n') i++;
      i--;
      continue;
    }
    if (ch === '<' && next === '#' && shell !== 'posix' && shell !== 'cmd') {
      const end = source.indexOf('#>', i + 2);
      if (end < 0) break;
      i = end + 1;
      continue;
    }
    // PowerShell here-strings are literal data, even if they contain shell operators.
    if (ch === '@' && (next === "'" || next === '"') && /[\r\n]/.test(source[i + 2] ?? '')) {
      if (start < 0) start = i;
      quoted = true;
      const terminator = `${next}@`;
      let lineStart = source.indexOf('\n', i + 2) + 1;
      let end = -1;
      while (lineStart > 0 && lineStart < source.length) {
        if (source.startsWith(terminator, lineStart)) { end = lineStart + 2; break; }
        lineStart = source.indexOf('\n', lineStart) + 1;
      }
      if (end < 0) break;
      i = end - 1;
      continue;
    }
    // Do not interpret script blocks, subshells or substitutions as top-level commands.
    if (ch === '(' || ch === '{') {
      if (start < 0) start = i;
      const close = ch === '(' ? ')' : '}';
      let nesting = 1;
      let innerQuote = '';
      value += ch;
      while (++i < source.length && nesting) {
        const inner = source[i]!;
        value += inner;
        if (innerQuote) { if (inner === innerQuote && source[i - 1] !== '\\') innerQuote = ''; }
        else if (inner === '"' || inner === "'") innerQuote = inner;
        else if (inner === ch) nesting++;
        else if (inner === close) nesting--;
      }
      i--;
      continue;
    }
    if (ch === '`' && shell === 'posix') {
      if (start < 0) start = i;
      value += '`';
      while (++i < source.length) {
        value += source[i];
        if (source[i] === '`' && source[i - 1] !== '\\') break;
      }
      continue;
    }
    const escape = (ch === '\\' && shell === 'posix') || (ch === '^' && shell === 'cmd')
      || (ch === '`' && (shell === 'powershell' || shell === 'generic'));
    if (escape && next) {
      if (start < 0) start = i;
      if (next !== '\n') value += next;
      i++;
      continue;
    }
    if (ch === '"' || (ch === "'" && shell !== 'cmd')) {
      if (start < 0) start = i;
      quote = ch;
      quoted = true;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') { push(i); continue; }
    if (ch === '<' || ch === '>') {
      push(i);
      start = i;
      value = ch;
      while (source[i + 1] === ch) value += source[++i];
      if (value === '<<' && source[i + 1] === '-') value += source[++i];
      if (ch === '>' && source[i + 1] === '&') {
        value += source[++i];
        if (/\d/.test(source[i + 1] ?? '')) value += source[++i];
      } else if (ch === '>' && source[i + 1] === '|') value += source[++i];
      push(i + 1);
      continue;
    }
    if (ch === '\n' || ch === '|' || ch === '&' || (ch === ';' && shell !== 'cmd')) {
      // PowerShell's leading & invokes the following quoted executable.
      if (ch === '&' && start < 0 && !tokens.length && next !== '&') continue;
      const separator: Separator = ch === '&' ? (next === '&' ? '&&' : '&')
        : ch === '|' ? (next === '|' ? '||' : '|') : ';';
      finish(i, separator);
      if ((ch === '&' || ch === '|') && next === ch) i++;
      if (ch === '\n') {
        for (const doc of heredocs.splice(0)) {
          let found = false;
          while (i < source.length) {
            const lineStart = i + 1;
            const lineEnd = source.indexOf('\n', lineStart);
            const end = lineEnd < 0 ? source.length : lineEnd;
            let line = source.slice(lineStart, end).replace(/\r$/, '');
            if (doc.stripTabs) line = line.replace(/^\t+/, '');
            i = end;
            if (line === doc.delimiter) { found = true; break; }
          }
          if (!found) break;
        }
      }
      continue;
    }
    if (start < 0) start = i;
    value += ch;
  }
  // An unterminated quote is incomplete input; do not invent an executable from it.
  if (!quote && segments.length < LIMITS.segments) finish(source.length, 'end');
  return segments;
}

function absolutePath(value: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|[\\/]{2}|\/)/.test(value);
}

function literalPath(value: string): boolean {
  return value.length > 0 && value.length <= LIMITS.path && !/[\x00-\x1f$%*?`<>|]/.test(value)
    && !value.startsWith('~') && !/^[A-Za-z]:[^\\/]/.test(value);
}

/** Forward slashes match the project's shared path convention; no OS I/O needed. */
function resolvePath(value: string, cwd: string | undefined, platform: NonNullable<DetectOptions['platform']>): string | undefined {
  if (!literalPath(value)) return undefined;
  let path = platform === 'win32' ? toNativeDriveShellPath(value) : value;
  if (platform === 'win32' && /^\\(?!\\)/.test(value)) {
    // A single leading backslash is rooted on cwd's drive/share, not in cwd.
    const root = cwd && normalizePathShape(cwd).match(/^(?:[A-Za-z]:|\/\/[^/]+\/[^/]+)(?=\/|$)/)?.[0];
    if (!root) return undefined;
    path = `${root}/${value.slice(1)}`;
  }
  if (!absolutePath(path)) {
    if (!cwd || !absolutePath(cwd) || !literalPath(cwd)) return undefined;
    path = `${cwd}/${path}`;
  }
  path = normalizePathShape(path);
  const root = path.match(/^(?:[A-Za-z]:\/|\/\/[^/]+\/[^/]+\/?|\/)/)?.[0] ?? '';
  const parts: string[] = [];
  for (const part of path.slice(root.length).split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return root.replace(/\/?$/, '/') + parts.join('/');
}

function projectArgument(args: readonly Token[], cwd: string | undefined, platform: NonNullable<DetectOptions['platform']>): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (/^[<>]/.test(arg.value)) { i++; continue; }
    const match = arg.value.match(/^(?:-{1,2}(?:project|uproject)=)?(.+\.uproject)$/i);
    if (match?.[1] && !match[1].startsWith('-')) return resolvePath(match[1], cwd, platform);
  }
  return undefined;
}

function stableId(identity: string): string {
  // Two independent 32-bit lanes keep IDs short without retaining raw path text.
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < identity.length; i++) {
    a = Math.imul(a ^ identity.charCodeAt(i), 0x01000193);
    b = Math.imul(b ^ identity.charCodeAt(i), 0x85ebca6b);
  }
  return `command-app-${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}

function identify(exe: string, args: readonly Token[], options: DetectOptions): CommandAppTarget | undefined {
  if (!literalPath(exe) || exe.startsWith('-') || /^[:@()[\]{}]/.test(exe)) return undefined;
  const platform = options.platform ?? 'win32';
  const base = normalizeShellCommandName(exe);
  if (!base || NON_APPS.has(base) || SHELLS[base]) return undefined;
  const hasPath = /[\\/]/.test(exe);
  const executable = hasPath ? resolvePath(exe, options.cwd, platform) : exe;
  // An unresolved relative path cannot safely be handed to an icon resolver.
  if (!executable) return undefined;
  const projectPath = projectArgument(args, options.cwd, platform);
  // dotnet runs a managed program. Only the explicit assembly position, with an
  // Engine installation path, grounds Unreal; a DLL mentioned later is just data.
  const assemblyArg = base === 'dotnet' ? args[args[0]?.value === 'exec' ? 1 : 0]?.value : undefined;
  const assembly = assemblyArg && /(?:^|[\\/])(?:AutomationTool|UnrealBuildTool)\.dll$/i.test(assemblyArg)
    ? resolvePath(assemblyArg, options.cwd, platform) : undefined;
  const engineRoot = (assembly ?? executable).match(/^(.*?\/Engine)\/(?:Binaries|Build)\//i)?.[1];
  const unreal = /^(?:unrealeditor(?:-cmd)?|ue4editor(?:-cmd)?|unrealbuildtool)$/.test(base)
    || (/^(?:runuat|build)$/.test(base) && !!(engineRoot || projectPath))
    || !!(assembly && engineRoot);
  const knownName = APP_NAMES[base] ?? (/^python(?:\d+(?:\.\d+)*)?$/.test(base) ? 'Python' : undefined)
    ?? (/^godot(?:_v\d[^\\/]*)?$/.test(base) ? 'Godot' : undefined);
  // Only explicit executable/script filenames or recognized CLI names. Arbitrary
  // PowerShell cmdlets and strings are not guessed to be installed applications.
  if (!unreal && !knownName && !/\.(?:exe|com|cmd|bat|sh|ps1)$/i.test(exe)) return undefined;
  const name = unreal ? 'Unreal Engine' : knownName ?? exe.split(/[\\/]/).pop()!.replace(/\.(exe|com|cmd|bat|sh|ps1)$/i, '');
  const appIdentity = unreal ? `unreal:${engineRoot ?? (hasPath ? executable : 'path')}` : `app:${hasPath ? executable : name}`;
  const id = stableId(`${pathKey(appIdentity, platform)}\n${unreal && projectPath ? pathKey(projectPath, platform) : ''}`);
  return {
    id, name, executable,
    ...(unreal && assembly ? { iconSource: assembly } : {}),
    ...(unreal && projectPath ? { projectPath } : {}),
    detection: 'command',
  };
}

/** Detect at most four app targets from executable positions in a shell command.
 * Wrappers are unwrapped to depth four; compound-command work shares one budget.
 */
export function detectCommandApps(command: string, options: DetectOptions = {}): CommandAppTarget[] {
  if (!command || command.length > LIMITS.chars) return [];
  const targets = new Map<string, CommandAppTarget>();
  const platform = options.platform ?? 'win32';
  let budget = LIMITS.segments;

  const compactStates = (states: readonly DirectoryState[]): DirectoryState[] => {
    const unique = new Map<string, DirectoryState>();
    for (const state of states) {
      const key = JSON.stringify([state.success, state.cwd === undefined ? null : pathKey(state.cwd, platform),
        state.stack.map((dir) => dir === undefined ? null : pathKey(dir, platform))]);
      unique.set(key, state);
      if (unique.size > LIMITS.cwdStates) {
        // Exceeding the state budget loses only path inference, never command history.
        return [{ cwd: undefined, stack: [], success: true }, { cwd: undefined, stack: [], success: false }];
      }
    }
    return [...unique.values()];
  };
  const commonCwd = (states: readonly DirectoryState[]): string | undefined => {
    const cwd = states[0]?.cwd;
    return cwd !== undefined && states.every((state) => state.cwd !== undefined
      && pathKey(state.cwd, platform) === pathKey(cwd, platform)) ? cwd : undefined;
  };
  const outcomes = (states: readonly DirectoryState[], status?: boolean): DirectoryState[] => compactStates(
    states.flatMap((state) => status === undefined
      ? [{ ...state, success: true }, { ...state, success: false }] : [{ ...state, success: status }]),
  );

  const visit = (source: string, shell: Shell, depth: number, cwd: string | undefined): void => {
    if (depth > LIMITS.depth || budget <= 0 || targets.size >= LIMITS.targets) return;
    const segments = lex(source, shell);
    const runSegment = (segment: Segment, states: readonly DirectoryState[]): DirectoryState[] => {
      if (--budget < 0 || targets.size >= LIMITS.targets) return outcomes(states);
      const cwd = commonCwd(states);
      let args = segment.tokens;
      while (args[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0].value)) args = args.slice(1);
      let token = args[0];
      if (!token) return outcomes(states);
      let exe = token.value.replace(/^@(?=[A-Za-z])/, '');
      let base = normalizeShellCommandName(exe);
      if (base === 'env' || base === 'command' || base === 'exec' || base === 'nohup' || base === 'call') {
        args = args.slice(1);
        while (args[0] && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0].value)
          || ['--', '-i', '--ignore-environment'].includes(args[0].value))) args = args.slice(1);
        token = args[0];
        if (!token || token.value.startsWith('-')) return outcomes(states);
        exe = token.value;
        base = normalizeShellCommandName(exe);
      }
      if (['cd', 'chdir', 'set-location', 'pushd', 'push-location', 'popd', 'pop-location'].includes(base)) {
        const dir = args.slice(1).find((arg) => !['/d', '-literalpath', '-path', '--'].includes(arg.value.toLowerCase()));
        const popping = base === 'popd' || base === 'pop-location';
        const pushing = base === 'pushd' || base === 'push-location';
        return compactStates(states.flatMap((state): DirectoryState[] => {
          const nextCwd = popping ? state.stack[0] : dir ? resolvePath(dir.value, state.cwd, platform) : undefined;
          const nextStack = popping ? state.stack.slice(1)
            : pushing ? [state.cwd, ...state.stack].slice(0, LIMITS.directoryStack) : state.stack;
          // Only the success arm adopts the new directory. || executes the failure
          // arm; ; may execute either. An unknown/pre-existing directory stack is
          // deliberately not guessed when popd has no locally observed frame.
          return [{ cwd: nextCwd, stack: nextStack, success: true }, { ...state, success: false }];
        }));
      }
      const nestedShell = SHELLS[base];
      if (nestedShell) {
        const flag = args.findIndex((arg, index) => index > 0 && (nestedShell === 'cmd'
          ? /^\/[ck]$/i.test(arg.value)
          : nestedShell === 'powershell' ? /^-(?:command|c)$/i.test(arg.value) : /^-[a-z]*c[a-z]*$/.test(arg.value)));
        if (flag < 0 || !args[flag + 1]) return outcomes(states);
        const payload = args.slice(flag + 1);
        let script = payload.length === 1 && payload[0]!.quoted ? payload[0]!.value
          : source.slice(args[flag]!.end, segment.end).trim();
        if (nestedShell === 'posix') script = payload[0]!.value; // remaining args are $0/$1, not more code
        if (nestedShell === 'cmd' && payload.length === 1 && payload[0]!.quoted
          && /^(?:[A-Za-z]:[\\/]|[\\/]|\.{1,2}[\\/])/.test(payload[0]!.value)
          && !/[&|<>\r\n]/.test(payload[0]!.value) && /\.(?:exe|com|bat|cmd)$/i.test(payload[0]!.value)) {
          script = source.slice(args[flag]!.end, segment.end).trim();
        }
        if (nestedShell === 'cmd' && script.startsWith('""') && script.endsWith('"')) script = script.slice(1, -1);
        visit(script, nestedShell, depth + 1, cwd);
        return outcomes(states);
      }
      if (base === 'start-process') {
        const fileFlag = args.findIndex((arg) => /^-filepath$/i.test(arg.value));
        const file = args[fileFlag >= 0 ? fileFlag + 1 : 1];
        if (!file || file.value.startsWith('-')) return outcomes(states);
        exe = file.value;
        const workFlag = args.findIndex((arg) => /^-workingdirectory$/i.test(arg.value));
        const workDir = args[workFlag + 1];
        const targetCwd = workFlag >= 0 && workDir ? resolvePath(workDir.value, cwd, platform) : cwd;
        const target = identify(exe, [], { ...options, cwd: targetCwd });
        if (target) targets.set(target.id, target);
        return outcomes(states);
      }
      if (base === 'start' && shell !== 'posix') {
        args = args.slice(1);
        if (args[0]?.quoted) args = args.slice(1); // cmd START's first quoted arg is the window title
        while (args[0] && ['/wait', '/b', '/min', '/max'].includes(args[0].value.toLowerCase())) args = args.slice(1);
        if (!args[0]) return outcomes(states);
        exe = args[0].value;
      }
      const target = identify(exe, args.slice(1), { ...options, cwd });
      if (target) targets.set(target.id, target);
      return outcomes(states, base === 'true' ? true : base === 'false' ? false : undefined);
    };

    let states: DirectoryState[] = [{ cwd, stack: [], success: true }];
    for (let index = 0; index < segments.length;) {
      if (budget <= 0 || targets.size >= LIMITS.targets) return;
      // Backgrounding applies to the whole AND/OR list, e.g. `cd dir && app &`.
      let listEnd = index;
      while (listEnd < segments.length - 1 && ['&&', '||', '|'].includes(segments[listEnd]!.separator)) listEnd++;
      const background = segments[listEnd]!.separator === '&' && shell !== 'cmd';
      const beforeList = states;
      let connector: Separator = ';';
      while (index <= listEnd) {
        if (budget <= 0 || targets.size >= LIMITS.targets) return;
        let pipeEnd = index;
        while (pipeEnd < listEnd && segments[pipeEnd]!.separator === '|') pipeEnd++;
        const executes = (state: DirectoryState): boolean => connector === '&&' ? state.success
          : connector === '||' ? !state.success : true;
        const input = states.filter(executes);
        const bypass = states.filter((state) => !executes(state));
        let output = input;
        for (let stage = index; stage <= pipeEnd && input.length; stage++) {
          if (budget <= 0 || targets.size >= LIMITS.targets) return;
          // POSIX/CMD pipeline stages do not share cwd changes. PowerShell and an
          // unspecified Windows shell have different pipeline rules: carry both
          // possibilities rather than asserting a directory in later stages.
          const stageInput = shell === 'posix' || shell === 'cmd' ? input : compactStates([...input, ...output]);
          output = runSegment(segments[stage]!, stageInput);
        }
        if (pipeEnd > index) {
          output = shell === 'posix' || shell === 'cmd'
            ? compactStates(input.flatMap((state) => output.map((last) => ({ ...state, success: last.success }))))
            : compactStates([...input, ...output]);
        }
        states = compactStates([...bypass, ...output]);
        connector = segments[pipeEnd]!.separator;
        index = pipeEnd + 1;
      }
      if (background) states = shell === 'generic' ? compactStates([...beforeList, ...states]) : beforeList;
    }
  };
  visit(command, options.platform === 'win32' || !options.platform ? 'generic' : 'posix', 0, options.cwd);
  return [...targets.values()];
}
