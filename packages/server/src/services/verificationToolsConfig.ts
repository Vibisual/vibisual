import { existsSync } from 'node:fs';
import type { StdioMcpServer } from './mcpConfigService.js';
import { codexAppNodeEnvOverrides, type AppNodeRuntime } from './appNodeRuntime.js';

/** Runtime connection only. The run identity belongs in each tool call, never in a persistent child. */
export interface VerificationToolsConfig extends AppNodeRuntime {
  helperPath: string;
}

export const VERIFICATION_MCP_SERVER = 'vibisual_verify';
const VERIFICATION_MCP_ENV = ['VIBISUAL_BASE', 'VIBISUAL_TOKEN', 'VIBISUAL_HOOK_AUTH', 'VIBISUAL_OWNER_AGENT_ID', 'VIBISUAL_SUBAGENT_ID'];
const VERIFICATION_TOOLS = ['observe', 'act', 'check', 'replay', 'finalize'];

export function verificationToolsAvailable(config: VerificationToolsConfig): boolean {
  return !!config.nodeBin && !!config.helperPath && existsSync(config.helperPath);
}

export function verificationMcpServer(config: VerificationToolsConfig): Record<string, StdioMcpServer> {
  // Claude's subprocess inherits its parent's env. There are no credentials to persist in this file.
  return { [VERIFICATION_MCP_SERVER]: { command: config.nodeBin, args: [config.helperPath], ...(config.nodeEnv ? { env: config.nodeEnv } : {}) } };
}

export function codexVerificationOverrides(config: VerificationToolsConfig): string[] {
  const prefix = `mcp_servers.${VERIFICATION_MCP_SERVER}`;
  const out = ['-c', `${prefix}.command=${JSON.stringify(config.nodeBin)}`,
    '-c', `${prefix}.args=${JSON.stringify([config.helperPath])}`,
    '-c', `${prefix}.enabled=true`, '-c', `${prefix}.required=true`,
    '-c', `${prefix}.tool_timeout_sec=360`,
    '-c', `${prefix}.env_vars=${JSON.stringify(VERIFICATION_MCP_ENV)}`,
    ...codexAppNodeEnvOverrides(VERIFICATION_MCP_SERVER, config)];
  // These calls stay scoped to a user-started run by the server. Existing named-tool and
  // mandatory-delegation hooks still apply; no sandbox or user/global configuration is widened.
  for (const tool of VERIFICATION_TOOLS) out.push('-c', `${prefix}.tools.${tool}.approval_mode="approve"`);
  return out;
}

/** Only requested connections participate; a normal turn may retain an already loaded bridge. */
export function verificationMcpKeyOf(args: readonly string[]): string | undefined {
  const allowedIndex = args.indexOf('--allowedTools');
  if (allowedIndex < 0 || !args[allowedIndex + 1]?.split(',').includes(`mcp__${VERIFICATION_MCP_SERVER}`)) return undefined;
  const configIndex = args.indexOf('--mcp-config');
  return configIndex >= 0 ? args[configIndex + 1] : undefined;
}

export function decideVerificationReuse(spawnedKey: string | undefined, wantKey: string | undefined, hasBackgroundWork: boolean): 'reuse' | 'respawn' | 'blocked' {
  if (wantKey === undefined || wantKey === spawnedKey) return 'reuse';
  return hasBackgroundWork ? 'blocked' : 'respawn';
}
