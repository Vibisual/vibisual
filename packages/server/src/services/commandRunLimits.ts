import type { QueuedCommand } from '@vibisual/shared';

/**
 * §5.13 (R-10) — per-command limits ("quick draft" / "refine" in the creation apps). Pure: parsing, the effective
 * turn cap and the time cap. Nothing here promises a cost — turns and minutes are the only things we can enforce.
 */
export const RUN_LIMIT_BOUNDS = { maxTurns: { min: 1, max: 1000 }, maxMinutes: { min: 1, max: 600 } } as const;
type RunLimits = NonNullable<QueuedCommand['runLimits']>;

export function normalizeRunLimits(value: unknown): RunLimits | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const out: RunLimits = {};
  const turns = raw['maxTurns'];
  if (typeof turns === 'number' && Number.isInteger(turns) && turns >= RUN_LIMIT_BOUNDS.maxTurns.min && turns <= RUN_LIMIT_BOUNDS.maxTurns.max) out.maxTurns = turns;
  const minutes = raw['maxMinutes'];
  if (typeof minutes === 'number' && Number.isFinite(minutes) && minutes >= RUN_LIMIT_BOUNDS.maxMinutes.min && minutes <= RUN_LIMIT_BOUNDS.maxMinutes.max) out.maxMinutes = minutes;
  return Object.keys(out).length ? out : undefined;
}

/** The tighter of the agent's own cap (0 = none) and the command's cap. */
export function effectiveMaxTurns(configured: number, limits: QueuedCommand['runLimits']): number {
  const own = configured > 0 ? configured : Infinity;
  const command = limits?.maxTurns ?? Infinity;
  const result = Math.min(own, command);
  return Number.isFinite(result) ? result : 0;
}

export function runLimitMs(limits: QueuedCommand['runLimits']): number | null {
  return limits?.maxMinutes ? limits.maxMinutes * 60_000 : null;
}
