import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueuedCommand, SubAgent } from '@vibisual/shared';
import { SubAgentManager } from './subAgentManager.js';

/** §5.13 (R-10) — the time limit is enforced on every engine: a command still running at its limit stops the session and says why; a turn that already ended is left alone. */
type Innards = { currentTurnId: Map<string, string>; armRunTimeLimit: (sub: SubAgent, cmd: QueuedCommand) => void };
const AGENT = 'agent-run-limit';
const SUB = 'sub-run-limit-1';
function setup(minutes = 1) {
  const m = new SubAgentManager();
  const priv = m as unknown as Innards;
  const sub = m.create(AGENT, SUB);
  const stop = vi.spyOn(m, 'stop').mockReturnValue(true);
  const cmd: QueuedCommand = { id: 'cmd-1', text: 'make a bottle', timestamp: Date.now(), subAgentId: sub.id, status: 'executing', runLimits: { maxMinutes: minutes } };
  priv.currentTurnId.set(sub.id, cmd.id);
  priv.armRunTimeLimit(sub, cmd);
  return { m, priv, sub, cmd, stop };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('per-command time limit', () => {
  it('stops the running turn at its limit and records the reason', () => {
    vi.useFakeTimers();
    const { sub, cmd, stop } = setup(1);
    expect(cmd.runLimitsApplied).toMatchObject({ maxMinutes: 1 });
    vi.advanceTimersByTime(59_000);
    expect(stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(stop).toHaveBeenCalledWith(sub.id);
    expect(cmd.runLimitHit).toBe('maxMinutes');
  });
  it('leaves a turn that already finished (or another turn) alone', () => {
    vi.useFakeTimers();
    const { priv, sub, cmd, stop } = setup(1);
    priv.currentTurnId.set(sub.id, 'cmd-2');
    vi.advanceTimersByTime(60_000);
    expect(stop).not.toHaveBeenCalled();
    expect(cmd.runLimitHit).toBeUndefined();
  });
  it('arms nothing without a time limit', () => {
    vi.useFakeTimers();
    const m = new SubAgentManager();
    const sub = m.create(AGENT, 'sub-run-limit-2');
    const stop = vi.spyOn(m, 'stop').mockReturnValue(true);
    const cmd: QueuedCommand = { id: 'cmd-3', text: 'x', timestamp: Date.now(), subAgentId: sub.id, status: 'executing', runLimits: { maxTurns: 5 } };
    (m as unknown as Innards).armRunTimeLimit(sub, cmd);
    vi.advanceTimersByTime(10 * 60_000);
    expect(stop).not.toHaveBeenCalled();
    expect(cmd.runLimitsApplied?.maxMinutes).toBeUndefined();
  });
});
