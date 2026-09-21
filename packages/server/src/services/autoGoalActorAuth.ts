import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import type { AutoGoalActor } from './autoGoalLifecycle.js';

// The common hook token admits a local caller; this server-only key binds procedure writes to its session.
// Restarting invalidates old capabilities. The next task receives a fresh one in its scoped context.
const secret = randomBytes(32);
export function issueAutoGoalCapability(root: string, actor: AutoGoalActor): string {
  return createHmac('sha256', secret).update(JSON.stringify([
    fs.realpathSync(root), actor.agentId, actor.subAgentId,
  ])).digest('hex');
}
export function validAutoGoalCapability(value: unknown, root: string, actor: AutoGoalActor): boolean {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return false;
  try {
    return timingSafeEqual(Buffer.from(value, 'hex'), Buffer.from(issueAutoGoalCapability(root, actor), 'hex'));
  } catch { return false; }
}
