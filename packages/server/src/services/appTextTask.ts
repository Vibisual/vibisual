import os from 'node:os';
import { claudeAuthService } from './claudeAuthService.js';
import { runClaudeCli } from './claudeCliRun.js';

const TEXT_TASK = { timeoutMs: 120_000, promptMax: 100_000, outputMax: 200_000 } as const;
export interface AppTextTaskStatus { state: 'available' | 'connection' | 'unknown'; provider: string; subscription?: string }
export interface AppTextTaskResult {
  state: 'completed' | 'limited' | 'failed' | 'checking' | 'connection';
  text: string;
  hostTaskId?: string;
  usage?: Record<string, unknown>;
}

export async function textTaskStatus(provider = 'claude'): Promise<AppTextTaskStatus> {
  if (provider === 'codex') {
    const { codexAuthService } = await import('./codexAuthService.js');
    const auth = await codexAuthService.refresh();
    return { state: auth.error ? 'unknown' : auth.loggedIn && auth.authMethod === 'chatgpt' ? 'available' : 'connection', provider: 'Codex' };
  }
  const auth = await claudeAuthService.refresh();
  if (auth.error) return { state: 'unknown', provider: 'Claude' };
  const subscription = auth.loggedIn && auth.authMethod === 'claude.ai' && auth.apiProvider === 'firstParty' && !!auth.subscriptionType;
  return { state: subscription ? 'available' : 'connection', provider: 'Claude',
    ...(subscription ? { subscription: auth.subscriptionType } : {}) };
}

/** Text-only apps reuse the host CLI and subscription; notes cannot grant tool/file access. */
export async function runTextTask(prompt: string, provider = 'claude'): Promise<AppTextTaskResult> {
  const status = await textTaskStatus(provider);
  if (status.state !== 'available') return { state: 'connection', text: '' };
  if (prompt.length > TEXT_TASK.promptMax) return { state: 'failed', text: '' };
  if (provider === 'codex') return (await import('./appCodexTextTask.js')).runCodexTextTask(prompt, TEXT_TASK.timeoutMs);
  // One-line JSON survives Windows .cmd shims. No tools/MCP/settings means no descendants or project instructions.
  const result = await runClaudeCli(['-p', prompt, '--output-format', 'json', '--tools', '',
    '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence'],
  TEXT_TASK.timeoutMs, { cwd: os.tmpdir() });
  if (result.failure === 'timeout') return { state: 'checking', text: '' };
  if (result.failure) return { state: 'failed', text: '' };
  const lines = result.out.split('\n');
  let response: Record<string, unknown> | null = null;
  for (const line of lines) {
    try {
      const value: unknown = JSON.parse(line);
      if (value && typeof value === 'object' && !Array.isArray(value) && 'result' in value) response = value as Record<string, unknown>;
    } catch { /* CLI diagnostics are not task output. */ }
  }
  const raw = typeof response?.['result'] === 'string' ? response['result'] : '';
  const errorText = `${String(response?.['subtype'] ?? '')} ${String(response?.['api_error'] ?? '')} ${raw || result.out}`;
  if (response?.['api_error_status'] === 429 || /rate.limit|usage.limit|limit.reached|hit your.*limit|out of.*usage/i.test(errorText)) return { state: 'limited', text: '', ...taskMetadata(response) };
  if (result.code !== 0 || response?.['is_error'] === true || !raw || raw.length > TEXT_TASK.outputMax) return { state: 'failed', text: '' };
  return { state: 'completed', text: raw, ...taskMetadata(response) };
}
function taskMetadata(response: Record<string, unknown> | null): Pick<AppTextTaskResult, 'hostTaskId' | 'usage'> {
  const usage = response?.['usage'];
  return {
    ...(typeof response?.['session_id'] === 'string' ? { hostTaskId: response['session_id'] } : {}),
    ...(usage && typeof usage === 'object' && !Array.isArray(usage) ? { usage: usage as Record<string, unknown> } : {}) };
}
