export interface CodexEdgeConfig {
  helperPath: string;
  nodeBin: string;
  edgeIds: string[];
  restrictedTools: string[];
}

export function codexEdgeHookCommand(config: CodexEdgeConfig, platform: NodeJS.Platform = process.platform): string {
  // Codex runs Windows hooks through PowerShell; quoted executables need &.
  return `${platform === 'win32' ? '& ' : ''}"${config.nodeBin}" "${config.helperPath}" gate`;
}

/** Session overrides only. The MCP subprocess retains loopback access even when
 * Codex shell execution is disabled; no sandbox/network permission is widened. */
export function codexEdgeOverrides(config: CodexEdgeConfig): string[] {
  const quote = JSON.stringify;
  const out = [
    '-c', `mcp_servers.vibisual_edges.command=${quote(config.nodeBin)}`,
    '-c', `mcp_servers.vibisual_edges.args=${quote([config.helperPath, 'mcp'])}`,
    '-c', 'mcp_servers.vibisual_edges.enabled=true',
    '-c', 'mcp_servers.vibisual_edges.required=true',
    '-c', 'mcp_servers.vibisual_edges.tools.dispatch.approval_mode="approve"',
    '-c', 'mcp_servers.vibisual_edges.tool_timeout_sec=3600',
    '-c', `mcp_servers.vibisual_edges.env_vars=${quote(['VIBISUAL_BASE', 'VIBISUAL_TOKEN', 'VIBISUAL_OWNER_AGENT_ID', 'VIBISUAL_CODEX_EDGE_IDS'])}`,
  ];
  if (config.restrictedTools.length) {
    const command = codexEdgeHookCommand(config);
    out.push('-c', 'features.hooks=true', '-c', `hooks.PreToolUse=[{hooks=[{type="command",command=${quote(command)},timeout=10}]}]`);
    // Hosted tools do not pass through PreToolUse. Disable their entry points,
    // plus shell and agent spawning, for a turn with mandatory tool delegation.
    for (const feature of ['shell_tool', 'unified_exec', 'multi_agent', 'image_generation', 'browser_use', 'computer_use', 'apps', 'code_mode', 'code_mode_only']) {
      out.push('-c', `features.${feature}=false`);
    }
    out.push('-c', 'web_search="disabled"');
  }
  return out;
}

export function codexEdgeInstructions(config: CodexEdgeConfig): string {
  return '\n# Codex edge tools\nUse mcp__vibisual_edges__dispatch to call connected agents; do not use curl or shell for delegation.\n'
    + (config.restrictedTools.length
      ? `Tool delegation is enforced for this turn (${config.restrictedTools.join(', ')}). All direct executable tools are blocked because Codex shell/code tools can perform the delegated operations. Delegate executable work to connected agents; planning and final responses remain available.\n`
      : 'Shared/AUTO edges retain normal direct tools.\n');
}
