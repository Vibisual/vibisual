// The public `claude` CLI contract the fake engine enforces. Source: code.claude.com/docs/en/cli-reference
// ("CLI flags" table) and /headless (stream-json). When the official table changes, change it here — a flag the
// server passes that is not listed makes the fake fail exactly like an unknown option on the real CLI.

/** Flags that take one value (`--flag v` or `--flag=v`). */
export const VALUE_FLAGS = new Set([
  '--advisor', '--agent', '--agents', '--append-subagent-system-prompt', '--append-subagent-system-prompt-file',
  '--append-system-prompt', '--append-system-prompt-file', '--autocompact', '--channels', '--debug-file',
  '--dangerously-load-development-channels', '--effort', '--environment', '--exec', '--fallback-model', '--from-pr',
  '--input-format', '--json-schema', '--max-budget-usd', '--max-turns', '--model', '--name', '--output-format',
  '--permission-mode', '--permission-prompt-tool', '--permission-prompts', '--plugin-dir', '--plugin-url', '--ref',
  '--remote-control-session-name-prefix', '--session-id', '--setting-sources', '--settings', '--system-prompt',
  '--system-prompt-file', '--system-prompt-snapshot', '--teammate-mode',
]);

/** Flags that take one or more values until the next dash argument (commander variadic). */
export const VARIADIC_FLAGS = new Set([
  '--add-dir', '--allowedTools', '--allowed-tools', '--betas', '--disallowedTools', '--disallowed-tools',
  '--mcp-config', '--tools',
]);

/** Flags whose value is optional (`--resume` alone opens a picker; `--debug=mcp`). */
export const OPTIONAL_VALUE_FLAGS = new Set(['--debug', '--resume', '--remote-control', '--rc', '--worktree', '--cloud', '--remote']);

export const BOOLEAN_FLAGS = new Set([
  '--allow-dangerously-skip-permissions', '--ax-screen-reader', '--bare', '--bg', '--background', '--chrome',
  '--continue', '--dangerously-skip-permissions', '--desktop', '--disable-slash-commands', '--enable-auto-mode',
  '--exclude-dynamic-system-prompt-sections', '--fork-session', '--forward-subagent-text', '--ide', '--init',
  '--init-only', '--include-hook-events', '--include-partial-messages', '--maintenance', '--no-chrome',
  '--no-session-persistence', '--print', '--prompt-suggestions', '--replay-user-messages', '--restricted',
  '--safe-mode', '--strict-mcp-config', '--teleport', '--tmux', '--verbose', '--version', '--help',
]);

export const SHORT_ALIASES = {
  '-p': '--print', '-c': '--continue', '-r': '--resume', '-v': '--version', '-h': '--help', '-n': '--name',
  '-w': '--worktree',
};

/** Subcommands in the "CLI commands" table. The fake answers the ones the app probes and refuses the rest. */
export const SUBCOMMANDS = new Set([
  'update', 'gateway', 'install', 'auth', 'agents', 'attach', 'auto-mode', 'daemon', 'doctor', 'import', 'logs',
  'mcp', 'plugin', 'plugins', 'purge', 'remote-control', 'respawn', 'rm', 'self-hosted-runner', 'setup-token',
  'stop', 'kill', 'ultrareview',
]);

/** `claude auth status` → `authMethod` values from the commands table. */
export const AUTH_METHODS = new Set(['none', 'claude.ai', 'oauth_token', 'api_key', 'api_key_helper', 'third_party']);

/**
 * Parses argv the way the real CLI's option parser does. Unknown options are collected, not thrown, so the caller
 * can log them before failing.
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  /** @type {Record<string, string | string[] | true>} */
  const flags = {};
  /** @type {string[]} */
  const positionals = [];
  /** @type {string[]} */
  const unknown = [];
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (raw === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!raw.startsWith('-') || raw === '-') {
      positionals.push(raw);
      continue;
    }
    const eq = raw.startsWith('--') ? raw.indexOf('=') : -1;
    const name0 = eq > 0 ? raw.slice(0, eq) : raw;
    const name = SHORT_ALIASES[name0] ?? name0;
    const inline = eq > 0 ? raw.slice(eq + 1) : undefined;
    const next = () => {
      if (inline !== undefined) return inline;
      const value = argv[i + 1];
      if (value === undefined) return undefined;
      i += 1;
      return value;
    };
    if (VALUE_FLAGS.has(name)) {
      const value = next();
      if (value === undefined) unknown.push(`${name} (missing value)`);
      else if (name === '--plugin-dir') flags[name] = [...(/** @type {string[]} */ (flags[name] ?? [])), value];
      else flags[name] = value;
    } else if (VARIADIC_FLAGS.has(name)) {
      const values = inline !== undefined ? [inline] : [];
      while (inline === undefined && i + 1 < argv.length && !argv[i + 1].startsWith('-')) values.push(argv[(i += 1)]);
      if (values.length === 0) unknown.push(`${name} (missing value)`);
      flags[name] = [...(/** @type {string[]} */ (flags[name] ?? [])), ...values];
    } else if (OPTIONAL_VALUE_FLAGS.has(name)) {
      if (inline !== undefined) flags[name] = inline;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('-') && name === '--resume') flags[name] = argv[(i += 1)];
      else flags[name] = true;
    } else if (BOOLEAN_FLAGS.has(name)) {
      flags[name] = true;
    } else {
      unknown.push(name);
    }
  }
  return { flags, positionals, unknown };
}

/** A `--help` body in the real CLI's layout, generated from the tables above so it cannot drift from them. */
export function helpText() {
  const rows = [];
  const alias = Object.fromEntries(Object.entries(SHORT_ALIASES).map(([s, l]) => [l, s]));
  const all = [...BOOLEAN_FLAGS, ...VALUE_FLAGS, ...VARIADIC_FLAGS, ...OPTIONAL_VALUE_FLAGS].sort();
  for (const flag of all) {
    const short = alias[flag] ? `${alias[flag]}, ` : '';
    const arg = VALUE_FLAGS.has(flag) ? ' <value>' : VARIADIC_FLAGS.has(flag) ? ' <values...>'
      : OPTIONAL_VALUE_FLAGS.has(flag) ? ' [value]' : '';
    rows.push(`  ${`${short}${flag}${arg}`.padEnd(48)} ${flag.slice(2)}`);
  }
  return [
    'Usage: claude [options] [command] [prompt]',
    '',
    'Claude Code - starts an interactive session by default, use -p/--print for non-interactive output',
    '',
    'Arguments:',
    '  prompt                                           Your prompt',
    '',
    'Options:',
    ...rows,
    '',
    'Commands:',
    ...[...SUBCOMMANDS].sort().map((c) => `  ${c}`),
    '',
  ].join('\n');
}
