import type { PlatformName } from './pathCase.js';

/** Claude uses Git Bash on Windows; Codex uses Windows PowerShell 5.1. */
export type AgentRuleShell = 'posix' | 'powershell';
export function agentRuleShell(engine: 'claude' | 'codex' | 'local', platform: PlatformName): AgentRuleShell {
  return engine === 'codex' && platform === 'win32' ? 'powershell' : 'posix';
}

// The alias carries only our per-launch credential through Codex's default TOKEN-name filter.
// Explicit user include/exclude filters still apply. Never put its value in prompts or CLI args.
export const AGENT_CARD_ENV_AUTH = 'VIBISUAL_HOOK_AUTH';
export const AGENT_AUTH_POSIX = '${VIBISUAL_TOKEN:-$VIBISUAL_HOOK_AUTH}';

/** Every tool invocation starts a fresh shell, so every snippet needs this header. */
export function agentPowershellHead(serverBase: string): string[] {
  return [
    "$ErrorActionPreference = 'Stop'; [Console]::OutputEncoding = [Text.Encoding]::UTF8",
    `$B = if ($env:VIBISUAL_BASE) { $env:VIBISUAL_BASE } else { '${serverBase.replace(/'/g, "''")}' }`,
    `$H = @{ 'x-vibisual-hook-token' = $(if ($env:VIBISUAL_TOKEN) { "$env:VIBISUAL_TOKEN" } else { "$env:${AGENT_CARD_ENV_AUTH}" }) }`,
    'function Send($Method, $Uri, $Type, $Text) { $a = @{ Method = $Method; Uri = $Uri; Headers = $H }; if ($null -ne $Text) { $a.ContentType = "$Type; charset=utf-8"; $a.Body = [Text.Encoding]::UTF8.GetBytes($Text) }; try { Invoke-RestMethod @a } catch { $r = $_.Exception.Response; if (-not $r) { throw }; $d = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { (New-Object IO.StreamReader $r.GetResponseStream()).ReadToEnd() }; throw "HTTP $([int]$r.StatusCode) $d" } }',
  ];
}

/** JSON/text stays literal; UTF-8 bytes preserve Korean on Windows PowerShell 5.1. */
export function agentPowershellRequest(args: {
  serverBase: string;
  endpoint: string;
  body: string;
  method?: 'Post' | 'Put';
  contentType?: string;
  before?: string[];
  after?: string[];
}): string {
  return ['```powershell', ...agentPowershellHead(args.serverBase), ...(args.before ?? []),
    "$Body = @'", args.body, "'@",
    `$Response = Send ${args.method ?? 'Post'} "$B${args.endpoint}" '${args.contentType ?? 'application/json'}' $Body`,
    ...(args.after ?? ['$Response | ConvertTo-Json -Depth 32']), '```'].join('\n');
}
