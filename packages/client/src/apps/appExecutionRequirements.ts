import type { CommandExecutionRequirements, CreationRunLimits } from '@vibisual/shared';

export interface AppCommandOptions {
  executionRequirements?: CommandExecutionRequirements;
  runLimits?: CreationRunLimits;
}

/** A combined request gets enough room for its apps; the server still applies the user's tighter cap. */
export function appCommandOptions(briefs: readonly {
  executionRequirements?: CommandExecutionRequirements & { runLimits?: CreationRunLimits };
}[]): AppCommandOptions | undefined {
  const out: AppCommandOptions = {};
  for (const { executionRequirements: req } of briefs) {
    if (req?.localTransport) out.executionRequirements = { localTransport: true };
    for (const key of ['maxTurns', 'maxMinutes'] as const) {
      const value = req?.runLimits?.[key];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        out.runLimits = { ...out.runLimits, [key]: Math.max(out.runLimits?.[key] ?? 0, value) };
      }
    }
  }
  return Object.keys(out).length ? out : undefined;
}
