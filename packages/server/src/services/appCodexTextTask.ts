import os from 'node:os';
import { runCodexCli } from './codexCli.js';
import type { AppTextTaskResult } from './appTextTask.js';

/** Public config-reference: shell_tool controls execution; forced_login_method prevents API-key billing. */
export function codexTextArgs(prompt: string): string[] {
  const disabled = ['shell_tool', 'apps', 'plugins', 'multi_agent', 'computer_use', 'view_image', 'request_permissions_tool',
    'skill_search', 'hooks', 'artifact', 'workspace_dependencies', 'in_app_browser', 'in_app_local_automation', 'image_generation', 'goals'];
  return ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only',
    ...disabled.flatMap(name => ['--disable', name]),
    '-c', 'forced_login_method="chatgpt"', '-c', 'model_provider="openai"', '-c', 'web_search="disabled"',
    '-c', 'skills.bundled.enabled=false', '-c', 'skills.include_instructions=false', '-c', 'mcp_servers={}',
    '-c', 'project_doc_max_bytes=0', prompt];
}
export function parseCodexTextTask(raw: string, code: number | null): AppTextTaskResult {
  let text = ''; let id: string | undefined; let usage: Record<string, unknown> | undefined; let failed = code !== 0; let errors = '';
  for (const line of raw.split('\n')) {
    let event: Record<string, unknown>;
    try { const parsed: unknown = JSON.parse(line); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue; event = parsed as Record<string, unknown>; }
    catch { continue; }
    if (event['type'] === 'thread.started' && typeof event['thread_id'] === 'string') id = event['thread_id'];
    if (event['type'] === 'turn.completed' && event['usage'] && typeof event['usage'] === 'object') usage = event['usage'] as Record<string, unknown>;
    if (event['type'] === 'turn.failed' || event['type'] === 'error') { failed = true; errors += JSON.stringify(event); }
    if (event['type'] === 'item.completed' && event['item'] && typeof event['item'] === 'object') {
      const item = event['item'] as Record<string, unknown>;
      if (item['type'] === 'agent_message' && typeof item['text'] === 'string') text = item['text'];
      if (['command_execution', 'mcp_tool_call', 'web_search', 'file_change'].includes(String(item['type']))) failed = true;
    }
  }
  const state = /usage.limit|rate.limit|limit.reached|exceeded.*quota/i.test(errors) ? 'limited' : failed || !text ? 'failed' : 'completed';
  return { state, text: state === 'completed' ? text : '', ...(id ? { hostTaskId: id } : {}), ...(usage ? { usage } : {}) };
}
export async function runCodexTextTask(prompt: string, timeoutMs: number): Promise<AppTextTaskResult> {
  const result = await runCodexCli(codexTextArgs(prompt), timeoutMs, { cwd: os.tmpdir() });
  if (result.failure) return { state: result.failure === 'timeout' ? 'checking' : 'failed', text: '' };
  return parseCodexTextTask(result.out, result.code);
}
