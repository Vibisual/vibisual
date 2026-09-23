import type { RequestHandler } from 'express';

export function hasForeignSubAgent(
  getSub: (id: string) => { parentAgentId: string } | undefined,
  agentId: string | undefined,
  ids: readonly string[],
): boolean {
  return ids.some((id) => {
    const sub = getSub(id);
    return !!sub && sub.parentAgentId !== agentId;
  });
}

/** Check the URL's owner before a session mutation can stop work in another bubble/project. */
export function subAgentOwnerGuard<Params extends { agentId: string; subId: string } = { agentId: string; subId: string }>(
  getSub: (id: string) => { parentAgentId: string } | undefined,
): RequestHandler<Params> {
  return (req, res, next): void => {
    const subId = req.params.subId;
    const agentId = req.params.agentId;
    if (hasForeignSubAgent(getSub, agentId, [subId])) {
      res.status(404).json({ ok: false, error: 'session not found for agent' });
      return;
    }
    // A missing session retains the route's existing idempotent stop behavior.
    next();
  };
}

/** Display cards may name historical sessions, but cannot claim a live session owned by another agent. */
export function subAgentBodyOwnerGuard(
  getSub: (id: string) => { parentAgentId: string } | undefined,
): RequestHandler {
  return (req, res, next): void => {
    const body = req.body as { agentId?: unknown; subAgentId?: unknown } | undefined;
    if (typeof body?.agentId === 'string' && typeof body.subAgentId === 'string'
      && hasForeignSubAgent(getSub, body.agentId, [body.subAgentId])) {
      res.status(404).json({ ok: false, error: 'session not found for agent' }); return;
    }
    next();
  };
}
