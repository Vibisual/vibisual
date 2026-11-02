import type { Express } from 'express';

/** Metadata only: the hook must never forward tool arguments or conversation text. */
export interface CodexProgressNotice {
  parentAgentId: string;
  subAgentId: string;
  commandId: string;
  sessionId: string;
  hookEventName: 'PreCompact' | 'PostCompact' | 'PreToolUse' | 'PostToolUse';
  toolName?: string;
  toolUseId?: string;
}

export const CODEX_PROGRESS_WAIT_MAX = 64;
const EVENTS = new Set(['PreCompact', 'PostCompact', 'PreToolUse', 'PostToolUse']);
// The installed CLI reports collaborationwait_agent; retain the namespaced form too.
export function isCodexAgentWait(toolName: string | undefined): boolean {
  return toolName === 'collaborationwait_agent' || toolName === 'collaboration.wait_agent'
    || toolName === 'wait_agent';
}

export function readCodexProgressNotice(value: unknown): CodexProgressNotice | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const identifier = (key: string): string | undefined => {
    const v = o[key];
    return typeof v === 'string' && v.length > 0 && v.length <= 256 && !/[\x00-\x1f]/.test(v) ? v : undefined;
  };
  const parentAgentId = identifier('parentAgentId');
  const subAgentId = identifier('subAgentId');
  const commandId = identifier('commandId');
  const sessionId = identifier('sessionId');
  const event = identifier('hookEventName');
  if (!parentAgentId || !subAgentId || !commandId || !sessionId || !event || !EVENTS.has(event)) return null;
  const toolName = identifier('toolName');
  const toolUseId = identifier('toolUseId');
  if ((event === 'PreToolUse' || event === 'PostToolUse') && (!toolName || !toolUseId)) return null;
  return { parentAgentId, subAgentId, commandId, sessionId,
    hookEventName: event as CodexProgressNotice['hookEventName'],
    ...(toolName ? { toolName } : {}), ...(toolUseId ? { toolUseId } : {}) };
}

/** The desktop loopback ingress authenticates this route with its per-launch hook token. */
export function mountCodexProgressRoute(app: Express, accept: (notice: CodexProgressNotice) => boolean): void {
  app.post('/api/codex-progress', (req, res) => {
    const notice = readCodexProgressNotice(req.body);
    if (!notice) { res.status(400).json({ ok: false }); return; }
    res.json({ ok: true, accepted: accept(notice) });
  });
}
