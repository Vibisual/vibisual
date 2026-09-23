import type { Express, Request, Response } from 'express';
import {
  AUTO_GOAL_COMMAND_MAX, AUTO_GOAL_SEQUENCE_MAX, AUTO_GOAL_EVIDENCE_FILE_MAX,
  LOOPBACK_INGRESS_HEADER, LOOPBACK_INGRESS_VALUE, resolveAutoGoalEnabled,
  type AutoGoalSettings,
} from '@vibisual/shared';
import {
  AutoGoalLifecycleError, approveAutoGoalSkill, assessAutoGoalSkill, recordAutoGoalOutcome,
  requestAutoGoalReview, reviewAutoGoalSkill, suspendAutoGoalSkill,
  type AutoGoalActor, type AutoGoalReviewInput,
} from './autoGoalLifecycle.js';
import { getAutoGoalState, type AutoGoalAnalyzeInput } from './autoGoalService.js';
import { logger } from '../logger.js';
import { validAutoGoalCapability } from './autoGoalActorAuth.js';

export interface AutoGoalRouteDependencies {
  resolveRoot: (requested: string) => string | null;
  rootForAgent: (agentId: string) => string | null;
  ownsSession: (agentId: string, subAgentId: string) => boolean;
  settings: (root: string) => AutoGoalSettings | undefined;
  material: (root: string) => AutoGoalAnalyzeInput;
  changed: () => void;
}

type Body = Record<string, unknown>;
const TEXT_LIMIT = AUTO_GOAL_COMMAND_MAX;
function objectBody(req: Request): Body {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new AutoGoalLifecycleError(400, 'invalid-body');
  return req.body as Body;
}
function requiredText(body: Body, key: string, max = TEXT_LIMIT): string {
  const value = body[key];
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new AutoGoalLifecycleError(400, `invalid-${key}`);
  return value;
}
function optionalText(body: Body, key: string, max = TEXT_LIMIT): string | undefined {
  return body[key] === undefined ? undefined : requiredText(body, key, max);
}
function files(body: Body, key: string, required = false): string[] | undefined {
  const value = body[key];
  if (value === undefined && !required) return undefined;
  if (!Array.isArray(value) || value.length > AUTO_GOAL_EVIDENCE_FILE_MAX
      || value.some((v) => typeof v !== 'string' || !v.trim() || v.length > TEXT_LIMIT)) {
    throw new AutoGoalLifecycleError(400, `invalid-${key}`);
  }
  return value as string[];
}

/** All three writes are root/session scoped; a hook token cannot select another loaded project. */
export function mountAutoGoalLifecycleRoutes(app: Express, deps: AutoGoalRouteDependencies): void {
  const agentContext = (body: Body): { root: string; actor: AutoGoalActor } => {
    const actor = { agentId: requiredText(body, 'agentId'), subAgentId: requiredText(body, 'subAgentId') };
    const root = deps.rootForAgent(actor.agentId);
    if (!root || !deps.ownsSession(actor.agentId, actor.subAgentId)) throw new AutoGoalLifecycleError(403, 'procedure-session-mismatch');
    if (!validAutoGoalCapability(body['procedureToken'], root, actor)) throw new AutoGoalLifecycleError(403, 'procedure-capability-mismatch');
    if (!resolveAutoGoalEnabled(deps.settings(root), actor)) throw new AutoGoalLifecycleError(403, 'procedures-disabled');
    // Do not accept a caller-supplied root as authority, even when that project is also open.
    if (body['projectPath'] !== undefined && deps.resolveRoot(requiredText(body, 'projectPath')) !== root) {
      throw new AutoGoalLifecycleError(403, 'procedure-project-mismatch');
    }
    return { root, actor };
  };
  const endpoint = (route: string, action: (req: Request) => unknown, changes = true) => {
    app.post(route, (req: Request, res: Response) => {
      try {
        const result = action(req);
        if (changes) deps.changed();
        res.json({ ok: true, ...result as object });
      } catch (error) {
        if (error instanceof AutoGoalLifecycleError) {
          res.status(error.statusCode).json({ ok: false, error: error.code });
        } else {
          logger.warn('[auto-goal] lifecycle request failed', { route, error: String(error) });
          res.status(500).json({ ok: false, error: 'procedure-request-failed' });
        }
      }
    });
  };

  endpoint('/api/auto-goal/context', (req) => {
    const body = objectBody(req);
    const { root, actor } = agentContext(body);
    return { state: getAutoGoalState(root, deps.settings(root), actor, deps.material(root)) };
  });
  endpoint('/api/auto-goal/review', (req) => {
    const body = objectBody(req);
    const { root, actor } = agentContext(body);
    const decision = requiredText(body, 'decision');
    if (!['approve', 'revise', 'retire', 'supersede'].includes(decision)) throw new AutoGoalLifecycleError(400, 'invalid-decision');
    const input: AutoGoalReviewInput = {
      skillId: requiredText(body, 'skillId'), revision: requiredText(body, 'revision'),
      decision: decision as AutoGoalReviewInput['decision'], reason: requiredText(body, 'reason'),
      ...(body['applicability'] !== undefined ? { applicability: optionalText(body, 'applicability') } : {}),
      ...(body['body'] !== undefined ? { body: optionalText(body, 'body', AUTO_GOAL_COMMAND_MAX * AUTO_GOAL_SEQUENCE_MAX) } : {}),
      ...(body['files'] !== undefined ? { files: files(body, 'files') } : {}),
      ...(body['supersededBy'] !== undefined ? { supersededBy: optionalText(body, 'supersededBy') } : {}),
    };
    return { skill: reviewAutoGoalSkill(root, input, actor) };
  });
  endpoint('/api/auto-goal/assess', (req) => {
    const body = objectBody(req);
    const { root, actor } = agentContext(body);
    return { assessment: assessAutoGoalSkill(root, {
      skillId: requiredText(body, 'skillId'), taskKey: requiredText(body, 'taskKey'), inputFiles: files(body, 'inputFiles', true) ?? [],
    }, actor) };
  });
  endpoint('/api/auto-goal/outcome', (req) => {
    const body = objectBody(req);
    const { root, actor } = agentContext(body);
    const outcome = requiredText(body, 'outcome');
    if (!['completed', 'reused', 'skipped', 'failed'].includes(outcome)) throw new AutoGoalLifecycleError(400, 'invalid-outcome');
    return recordAutoGoalOutcome(root, {
      skillId: requiredText(body, 'skillId'), assessmentId: requiredText(body, 'assessmentId'),
      outcome: outcome as 'completed' | 'reused' | 'skipped' | 'failed', evidence: requiredText(body, 'evidence'),
      ...(body['outputFiles'] !== undefined ? { outputFiles: files(body, 'outputFiles') } : {}),
    }, actor);
  });

  /*
   * 사용자 전용 고리 — §5.10 (R)ⓔ 의 [승인] 이 여기 붙는다. 자율 운영이 기본이고 이 셋은 부가 경로다.
   * 훅으로 들어온 요청은 여기 닿지 못한다(아래 loopback 표식 차단) — 에이전트는 근거를 갖춘
   * /api/auto-goal/review 로만 상태를 바꾼다.
   */
  for (const action of ['approve', 'retire', 'request-review'] as const) {
    endpoint(`/api/auto-goal/skills/:id/${action}`, (req) => {
      if (req.get(LOOPBACK_INGRESS_HEADER) === LOOPBACK_INGRESS_VALUE) throw new AutoGoalLifecycleError(403, 'procedure-user-action-only');
      const body = objectBody(req);
      const root = deps.resolveRoot(requiredText(body, 'projectPath'));
      if (!root) throw new AutoGoalLifecycleError(404, 'project-not-loaded');
      const skillId = req.params['id'];
      if (typeof skillId !== 'string') throw new AutoGoalLifecycleError(400, 'invalid-skillId');
      const input = { skillId, revision: requiredText(body, 'revision') };
      const actor = { agentId: 'user', subAgentId: 'user' };
      if (action === 'approve') return { skill: approveAutoGoalSkill(root, input, actor) };
      if (action === 'retire') return { skill: suspendAutoGoalSkill(root, { ...input, reason: 'user-paused' }, actor) };
      return { skill: requestAutoGoalReview(root, { ...input, reason: 'user-requested-review' }, actor) };
    });
  }
}
