import type { Express, Response } from 'express';
import type { AgentConfig } from '@vibisual/shared';
import { logger } from '../logger.js';
import { SkillSharingError, type SkillSharingContext, type SkillSharingService } from './skillSharingService.js';

interface SkillSharingRouteDependencies {
  service: Pick<SkillSharingService, 'list' | 'share'>;
  rootForAgent: (agentId: string) => string | null;
  configForAgent: (agentId: string) => AgentConfig | undefined;
  changed: () => void;
}

class SkillSharingRequestError extends Error {
  constructor(readonly statusCode: number, readonly code: string) { super(code); }
}

/** The receiving engine and folder belong to the agent, never to caller-supplied paths. */
export function mountSkillSharingRoutes(app: Express, deps: SkillSharingRouteDependencies): void {
  const contextFor = (value: unknown): SkillSharingContext => {
    if (typeof value !== 'string' || !value.trim()) throw new SkillSharingRequestError(400, 'invalid-agent');
    const agentId = value.trim();
    const projectCwd = deps.rootForAgent(agentId);
    if (!projectCwd) throw new SkillSharingRequestError(404, 'agent-not-found');
    const config = deps.configForAgent(agentId);
    const kind = config?.provider?.kind;
    if (kind && kind !== 'codex-cli') throw new SkillSharingRequestError(400, 'unsupported-provider');
    return { projectCwd, targetProvider: kind === 'codex-cli' || config?.cliKind === 'codex' ? 'codex' : 'claude' };
  };
  const fail = (res: Response, error: unknown): void => {
    if (error instanceof SkillSharingRequestError) {
      res.status(error.statusCode).json({ ok: false, error: error.code });
    } else if (error instanceof SkillSharingError) {
      res.status(error.code === 'source-not-found' ? 404 : 400).json({ ok: false, error: error.code });
    } else {
      logger.warn('[skill-sharing] request failed', { error: String(error) });
      res.status(500).json({ ok: false, error: 'skill-sharing-failed' });
    }
  };
  app.get('/api/skill-sharing', (req, res) => {
    try {
      const context = contextFor(req.query['agentId']);
      res.json({ ok: true, provider: context.targetProvider, skills: deps.service.list(context) });
    } catch (error) { fail(res, error); }
  });
  app.post('/api/skill-sharing', (req, res) => {
    try {
      const body: unknown = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SkillSharingRequestError(400, 'invalid-body');
      const fields = body as Record<string, unknown>;
      const context = contextFor(fields['agentId']);
      const sourceId = fields['sourceId'];
      if (typeof sourceId !== 'string' || !sourceId.trim()) throw new SkillSharingRequestError(400, 'invalid-source');
      const result = deps.service.share(context, sourceId);
      if (result.status === 'shared') deps.changed();
      res.json({ ok: true, result });
    } catch (error) { fail(res, error); }
  });
}
