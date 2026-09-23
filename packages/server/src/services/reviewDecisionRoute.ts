import type { RequestHandler } from 'express';
import type { ReviewDecision, ReviewRequest } from '@vibisual/shared';
import { REVIEW_REASON_MAX } from '@vibisual/shared';

interface ReviewDecisionDependencies {
  getReview: (id: string) => ReviewRequest | undefined;
  recordDecision: (id: string, decision: Omit<ReviewDecision, 'id' | 'decidedAt'>) => ReviewRequest | null;
  enqueue: (agentId: string, prompt: string, tag: string, subAgentId?: string) => boolean;
  merge: (nodeId: string) => Promise<
    { ok: true; branch: string } |
    { ok: false; httpStatus: number; error: string; conflicts?: string[] }
  >;
  publish: () => void;
  logInfo: (message: string) => void;
  logError: (message: string, error: unknown) => void;
}

/** §5.16 — Each review owns one decision operation; different reviews may proceed independently. */
export function createReviewDecisionHandler(deps: ReviewDecisionDependencies): RequestHandler {
  const inFlight = new Set<string>();
  return (req, res): void => {
    void (async () => {
      const id = String(req.params.id);
      let acquired = false;
      try {
        const record = deps.getReview(id);
        if (!record) { res.status(404).json({ ok: false, error: 'review not found' }); return; }
        if (inFlight.has(id) || (record.status !== 'pending' && record.status !== 'held')) {
          res.status(409).json({ ok: false, error: 'review already decided or deciding' }); return;
        }
        const body = (req.body ?? {}) as { kind?: unknown; reason?: unknown; reworkPrompt?: unknown };
        const kind = body.kind;
        if (kind !== 'approve' && kind !== 'reject' && kind !== 'hold') {
          res.status(400).json({ ok: false, error: 'kind must be approve|reject|hold' }); return;
        }
        const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, REVIEW_REASON_MAX) : '';
        if (kind === 'reject' && reason === '') {
          res.status(400).json({ ok: false, error: 'reason required' }); return;
        }
        inFlight.add(id);
        acquired = true;
        if (kind === 'hold') {
          // Repeated delivery of the same hold does not append a second decision.
          if (record.status === 'held' && (record.decisions.at(-1)?.reason ?? '') === reason) {
            res.json({ ok: true, status: 'held' }); return;
          }
          const updated = deps.recordDecision(id, { kind, ...(reason !== '' ? { reason } : {}) });
          deps.publish();
          res.json({ ok: true, status: updated?.status ?? 'held' }); return;
        }
        if (kind === 'reject') {
          const prompt = typeof body.reworkPrompt === 'string' && body.reworkPrompt.trim() !== '' ? body.reworkPrompt.trim() : reason;
          const dispatched = deps.enqueue(record.agentId, prompt, 'rvw', record.subAgentId);
          const updated = deps.recordDecision(id, { kind, reason, reworkDispatched: dispatched });
          deps.publish();
          deps.logInfo(`[review-lane] rejected review=${id} agent=${record.agentId} dispatched=${dispatched}`);
          res.json({ ok: true, status: updated?.status ?? 'rejected', reworkDispatched: dispatched }); return;
        }
        if (!record.worktreeNodeId) {
          deps.recordDecision(id, { kind, mergeOk: false, mergeError: 'worktree-node-missing' });
          deps.publish();
          res.status(409).json({ ok: false, error: 'worktree-node-missing' }); return;
        }
        const outcome = await deps.merge(record.worktreeNodeId);
        if (outcome.ok) {
          const updated = deps.recordDecision(id, { kind, mergeOk: true });
          deps.publish();
          deps.logInfo(`[review-lane] approved+merged review=${id} branch=${outcome.branch}`);
          res.json({ ok: true, status: updated?.status ?? 'approved', branch: outcome.branch }); return;
        }
        deps.recordDecision(id, { kind, mergeOk: false, mergeError: outcome.error,
          ...(outcome.conflicts && outcome.conflicts.length > 0 ? { conflicts: outcome.conflicts } : {}) });
        deps.publish();
        const { httpStatus, ...rest } = outcome;
        res.status(httpStatus).json(rest);
      } catch (error) {
        deps.logError('POST /api/review-requests/:id/decision failed', error);
        res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Internal server error' });
      } finally {
        if (acquired) inFlight.delete(id);
      }
    })();
  };
}
