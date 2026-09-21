import { buildAppNodeCommand, codexAppNodeEnvOverrides, type AppNodeRuntime } from './appNodeRuntime.js';

export interface CodexEdgeConfig extends AppNodeRuntime {
  helperPath: string;
  edgeIds: string[];
  restrictedTools: string[];
  /**
   * §5.3 #10-2 delegated status — jobs the parent let this delegated turn read. The server grants and checks them;
   * this list only tells the model. With no edgeIds the bridge still loads so `status` is reachable.
   */
  statusCmdIds?: string[];
  /**
   * §5.3 #10-2 — jobs this session dispatched earlier whose finished result it has not received. The turn resumes them
   * with `status` instead of dispatching again, and cannot finish as completed until they arrive (server turn-end guard).
   * With no edgeIds the bridge still loads for this.
   */
  pendingResults?: { cmdId: string; status: string }[];
}

/**
 * §5.25 (H) — per-turn permission bridge: `codex-edges.mjs permission <event>` sends Codex tool
 * calls to the Vibisual approval broker and audit ledger.
 */
export interface CodexPermissionHookConfig extends AppNodeRuntime {
  helperPath: string;
  /** Refuse the turn when the hooks cannot be attached (approval mode or audit boundary depends on them). */
  required: boolean;
}

export interface CodexToolHookConfig extends AppNodeRuntime {
  helperPath: string;
  policy: import('@vibisual/shared').CodexToolPolicy;
}

export type CodexAppHookEvent = 'PreToolUse' | 'PermissionRequest';

/** A hook this app expects `hooks/list` to report, used to trust exactly these hooks and no others. */
export interface CodexExpectedHook {
  command: string;
  eventName: 'preToolUse' | 'permissionRequest';
}

/** Above the broker's 60s wait and the helper's own 150s abort, so Codex never times the hook out first. */
export const CODEX_PERMISSION_HOOK_TIMEOUT_SEC = 180;
const CODEX_EDGE_GATE_TIMEOUT_SEC = 10;

function codexHelperHookCommand(runtime: AppNodeRuntime, helperPath: string, args: readonly string[], platform: NodeJS.Platform): string {
  return buildAppNodeCommand(runtime, helperPath, args, platform);
}

export function codexEdgeHookCommand(config: CodexEdgeConfig, platform: NodeJS.Platform = process.platform): string {
  return codexHelperHookCommand(config, config.helperPath, ['gate'], platform);
}

export function codexPermissionHookCommand(
  hook: CodexPermissionHookConfig,
  event: CodexAppHookEvent,
  platform: NodeJS.Platform = process.platform,
): string {
  return codexHelperHookCommand(hook, hook.helperPath, ['permission', event], platform);
}

/**
 * §5.25 (H) — every app-owned hook for one turn, as session overrides plus the list to trust.
 *
 * `hooks.PreToolUse` is a single array, so the edge gate and the permission bridge share it: two
 * separate `-c hooks.PreToolUse=` overrides would let the later one replace the earlier. A turn
 * with mandatory delegation blocks every direct executable tool, so its PreToolUse carries only the
 * gate (no approval card for a call that is about to be blocked anyway).
 */
export function codexTurnHooks(
  edge: CodexEdgeConfig | undefined,
  permission: CodexPermissionHookConfig | undefined,
  platform: NodeJS.Platform = process.platform,
  tools?: CodexToolHookConfig,
): { overrides: string[]; expected: CodexExpectedHook[] } {
  const quote = JSON.stringify;
  const preToolUse: { command: string; timeout: number }[] = [];
  const permissionRequest: { command: string; timeout: number }[] = [];
  const restricted = !!edge?.restrictedTools.length;
  if (tools) preToolUse.push({ command: codexHelperHookCommand(tools, tools.helperPath, restricted ? ['tool-permission', 'delegation'] : ['tool-permission'], platform), timeout: CODEX_PERMISSION_HOOK_TIMEOUT_SEC });
  if (edge && restricted) preToolUse.push({ command: codexEdgeHookCommand(edge, platform), timeout: CODEX_EDGE_GATE_TIMEOUT_SEC });
  if (permission) {
    if (!restricted) {
      preToolUse.push({ command: codexPermissionHookCommand(permission, 'PreToolUse', platform), timeout: CODEX_PERMISSION_HOOK_TIMEOUT_SEC });
    }
    permissionRequest.push({ command: codexPermissionHookCommand(permission, 'PermissionRequest', platform), timeout: CODEX_PERMISSION_HOOK_TIMEOUT_SEC });
  }
  const expected: CodexExpectedHook[] = [
    ...preToolUse.map(({ command }) => ({ command, eventName: 'preToolUse' as const })),
    ...permissionRequest.map(({ command }) => ({ command, eventName: 'permissionRequest' as const })),
  ];
  if (!expected.length) return { overrides: [], expected };
  const group = (hooks: { command: string; timeout: number }[]) =>
    `[{hooks=[${hooks.map((h) => `{type="command",command=${quote(h.command)},timeout=${h.timeout}}`).join(',')}]}]`;
  const overrides = ['-c', 'features.hooks=true'];
  if (preToolUse.length) overrides.push('-c', `hooks.PreToolUse=${group(preToolUse)}`);
  if (permissionRequest.length) overrides.push('-c', `hooks.PermissionRequest=${group(permissionRequest)}`);
  return { overrides, expected };
}

/** Session overrides only. The MCP subprocess retains loopback access even when
 * Codex shell execution is disabled; no sandbox/network permission is widened.
 * `hooks: false` leaves the gate hook to {@link codexTurnHooks}, which merges it with the permission bridge. */
export function codexEdgeOverrides(config: CodexEdgeConfig, options: { hooks?: boolean } = {}): string[] {
  const quote = JSON.stringify;
  const out = [
    '-c', `mcp_servers.vibisual_edges.command=${quote(config.nodeBin)}`,
    '-c', `mcp_servers.vibisual_edges.args=${quote([config.helperPath, 'mcp'])}`,
    '-c', 'mcp_servers.vibisual_edges.enabled=true',
    '-c', 'mcp_servers.vibisual_edges.required=true',
    '-c', 'mcp_servers.vibisual_edges.tools.dispatch.approval_mode="approve"',
    // §5.25 (H) — an on-request turn asks before every MCP call; polling our own status never runs work.
    '-c', 'mcp_servers.vibisual_edges.tools.status.approval_mode="approve"',
    '-c', 'mcp_servers.vibisual_edges.tool_timeout_sec=3600',
    '-c', `mcp_servers.vibisual_edges.env_vars=${quote(['VIBISUAL_BASE', 'VIBISUAL_TOKEN', 'VIBISUAL_OWNER_AGENT_ID', 'VIBISUAL_CODEX_EDGE_IDS', 'VIBISUAL_SUBAGENT_ID'])}`,
    ...codexAppNodeEnvOverrides('vibisual_edges', config),
  ];
  if (config.restrictedTools.length) {
    if (options.hooks !== false) out.push(...codexTurnHooks(config, undefined).overrides);
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
  const grants = config.statusCmdIds?.length
    ? `This delegated task may read these existing dispatch jobs with mcp__vibisual_edges__status while it runs: ${config.statusCmdIds.join(', ')}. Other jobs, cancelling, and reads after this task ends are refused.\n`
    : '';
  // §5.3 #10-2 — results this session started earlier but never received. Same list and shape as the turn failure reason.
  const pending = config.pendingResults?.length
    ? `Dispatch jobs you started have not handed their finished result to you yet: ${config.pendingResults.map((job) => `${job.cmdId} (${job.status})`).join(', ')}. `
      + 'Call mcp__vibisual_edges__status with each cmdId until it is completed, error or cancelled; do not dispatch the same work again. '
      + 'This turn cannot finish as completed until each result is received; if a lookup is refused or fails, tell the user with its cmdId.\n'
    : '';
  // §5.3 #10-2 delegated status — a turn with grants or pending results but no connected edge has no dispatch tool to describe.
  if (!config.edgeIds.length) return grants || pending ? `\n# Codex edge tools\n${grants}${pending}` : '';
  return '\n# Codex edge tools\nUse mcp__vibisual_edges__dispatch to call connected agents; do not use curl or shell for delegation.\n'
    + 'To have a connected agent check a job you already started, pass its cmdId in dispatch statusCmdIds; without it the target is refused (403).\n'
    + grants
    + pending
    // §5.3 #10-2 ⑨ — each call already waits for the result, so a pending reply means "call once more", not "poll and narrate".
    + 'dispatch and mcp__vibisual_edges__status wait inside the call until the delegated task finishes (up to 30 minutes per call). Only when a reply is still pending, call status again with its cmdId; do not send the user another progress update unless something changed. Do not dispatch the same work again. If acknowledgement was lost, reuse the returned requestKey with the exact original instruction.\n'
    + (config.restrictedTools.length
      ? `Tool delegation is enforced for this turn (${config.restrictedTools.join(', ')}). All direct executable tools are blocked because Codex shell/code tools can perform the delegated operations. Delegate executable work to connected agents; planning and final responses remain available.\n`
      : 'Shared/AUTO edges retain normal direct tools.\n');
}
