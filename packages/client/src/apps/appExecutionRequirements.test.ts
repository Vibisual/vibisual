import { describe, expect, it } from 'vitest';
import { appCommandOptions } from './appExecutionRequirements.js';

describe('app execution declarations', () => {
  it('leaves ordinary briefs unchanged', () => {
    expect(appCommandOptions([])).toBeUndefined();
    expect(appCommandOptions([{}, { executionRequirements: { localTransport: false } }])).toBeUndefined();
  });
  it('merges requested caps without creating a second cap field in the command', () => {
    expect(appCommandOptions([
      { executionRequirements: { localTransport: true, runLimits: { maxTurns: 160, maxMinutes: 120 } } },
      { executionRequirements: { runLimits: { maxTurns: 24, maxMinutes: 10 } } },
    ])).toEqual({ executionRequirements: { localTransport: true }, runLimits: { maxTurns: 160, maxMinutes: 120 } });
  });
});
