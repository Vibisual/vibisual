import path from 'node:path';
import type { AppNodeRuntime } from './appNodeRuntime.js';

/** Claude's command-hook schema supports exec args, but no per-hook env field. */
export function claudeHookInvocation(
  runtime: AppNodeRuntime,
  args: readonly string[],
  platform: NodeJS.Platform,
  systemRoot = 'C:\\Windows',
): { command: string; args: string[] } {
  if (!runtime.nodeEnv) return { command: runtime.nodeBin, args: [...args] };
  if (platform !== 'win32') {
    return { command: '/usr/bin/env', args: ['ELECTRON_RUN_AS_NODE=1', runtime.nodeBin, ...args] };
  }

  // Use the Windows-provided interpreter directly: Claude may have neither Git Bash nor pwsh.
  // Single-quoted literals + EncodedCommand keep $, backticks and apostrophes out of shell expansion.
  const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`;
  const script = [
    "$env:ELECTRON_RUN_AS_NODE='1'",
    '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)',
    `& ${[runtime.nodeBin, ...args].map(quote).join(' ')}`,
    'exit $LASTEXITCODE',
  ].join('; ');
  return {
    command: path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64')],
  };
}
