/** Codex tool families, shared by the settings UI and the execution gate.
 * These are tool permissions, not an OS security boundary: shell and MCP tools
 * can also read/write files. Hosted tools have no PreToolUse approval callback. */
export const CODEX_TOOL_GROUPS = [
  { id: 'shell', ask: true },
  { id: 'edit', ask: true },
  { id: 'read', ask: true },
  { id: 'mcp', ask: true },
  { id: 'web', ask: false },
  { id: 'image', ask: false },
  { id: 'computer', ask: false },
  { id: 'agents', ask: false },
] as const;
export type CodexToolGroup = typeof CODEX_TOOL_GROUPS[number]['id'];
export type CodexToolDecision = 'allow' | 'deny' | 'ask';
export type CodexToolPolicy = Partial<Record<CodexToolGroup, CodexToolDecision>>;

export function normalizeCodexToolPolicy(value: unknown): CodexToolPolicy | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const out: CodexToolPolicy = {};
  for (const group of CODEX_TOOL_GROUPS) {
    const v = raw[group.id];
    if (v === 'allow' || v === 'deny') out[group.id] = v;
    // An unsupported persisted ask must never silently become allow.
    else if (v === 'ask') out[group.id] = group.ask ? 'ask' : 'deny';
    else if (v !== undefined) out[group.id] = 'deny';
  }
  return out;
}

export function hasCodexToolRestrictions(policy: CodexToolPolicy | undefined): boolean {
  return CODEX_TOOL_GROUPS.some(({ id }) => policy?.[id] === 'deny' || policy?.[id] === 'ask');
}

export function codexToolGroup(name: string): CodexToolGroup | undefined {
  const tool = name.replace(/^functions\./, '');
  if (/^mcp__/.test(tool) || ['list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource'].includes(tool)) return 'mcp';
  if (['shell', 'shell_command', 'exec_command', 'write_stdin', 'terminal', 'Bash', 'PowerShell'].includes(tool)) return 'shell';
  if (['apply_patch', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) return 'edit';
  if (['view_image', 'read_file', 'list_dir', 'grep_files', 'Read', 'Glob', 'Grep'].includes(tool)) return 'read';
  if (['spawn_agent', 'send_input', 'wait', 'close_agent', 'resume_agent', 'spawn_agents_on_csv'].includes(tool)) return 'agents';
  if (/^(web|web_search)(\.|$)/.test(tool)) return 'web';
  if (/^(image_gen|image_generation)(\.|$)/.test(tool)) return 'image';
  if (/^(computer|browser)(\.|_|$)/.test(tool)) return 'computer';
  return undefined;
}

export function decideCodexTool(policy: CodexToolPolicy | undefined, toolName: string): CodexToolDecision {
  if (!hasCodexToolRestrictions(policy)) return 'allow';
  // Native children do not carry the app's agent identity reliably. Connected
  // Vibisual agents remain available through MCP and enforce their own policy.
  const group = codexToolGroup(toolName);
  if (group === 'agents') return 'deny';
  if (group) return policy?.[group] ?? 'allow';
  if (['update_plan', 'request_user_input'].includes(toolName.replace(/^functions\./, ''))) return 'allow';
  return 'deny';
}
