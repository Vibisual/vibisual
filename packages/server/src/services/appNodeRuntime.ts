import { resolveBinary } from './binLocator.js';

/** A helper runtime only; these variables must never be added to the whole agent environment. */
export interface AppNodeRuntime {
  nodeBin: string;
  nodeEnv?: { ELECTRON_RUN_AS_NODE: '1' };
}

export function appNodeRuntimeIn(nodeBin: string | null, execPath: string, electron: boolean): AppNodeRuntime {
  if (nodeBin) return { nodeBin };
  return { nodeBin: execPath, ...(electron ? { nodeEnv: { ELECTRON_RUN_AS_NODE: '1' as const } } : {}) };
}

/**
 * A packaged app already ships Node inside Electron; fresh users need no second Node install.
 * Electron documents ELECTRON_RUN_AS_NODE and enables its runAsNode fuse by default.
 * https://www.electronjs.org/docs/latest/api/environment-variables#electron_run_as_node
 */
export function getAppNodeRuntime(): AppNodeRuntime {
  return appNodeRuntimeIn(resolveBinary('node'), process.execPath, !!process.versions['electron']);
}

export function quoteAppNodeArgument(value: string, platform: NodeJS.Platform): string {
  // Codex Windows hooks use PowerShell, POSIX hooks use sh. Neither may expand path text.
  return platform === 'win32'
    ? `"${value.replace(/[`$"\r\n]/g, (char) => char === '\r' ? '`r' : char === '\n' ? '`n' : '`' + char)}"`
    : `"${value.replace(/[\\$`"]/g, (char) => '\\' + char)}"`;
}

export function buildAppNodeCommand(
  runtime: AppNodeRuntime,
  scriptPath: string,
  args: readonly string[],
  platform: NodeJS.Platform,
): string {
  const mode = runtime.nodeEnv?.ELECTRON_RUN_AS_NODE === '1'
    ? platform === 'win32' ? "$env:ELECTRON_RUN_AS_NODE='1'; " : 'ELECTRON_RUN_AS_NODE=1 '
    : '';
  const command = [quoteAppNodeArgument(runtime.nodeBin, platform), quoteAppNodeArgument(scriptPath, platform),
    ...args.map(arg => /^[A-Za-z0-9_./:\-]+$/.test(arg) ? arg : quoteAppNodeArgument(arg, platform))].join(' ');
  return mode + (platform === 'win32' ? '& ' : '') + command;
}

/** Explicit per-MCP environment overrides survive Codex's inherited-environment filter. */
export function codexAppNodeEnvOverrides(server: string, runtime: AppNodeRuntime): string[] {
  return runtime.nodeEnv?.ELECTRON_RUN_AS_NODE === '1'
    ? ['-c', `mcp_servers.${server}.env.ELECTRON_RUN_AS_NODE="1"`]
    : [];
}
