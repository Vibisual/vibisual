import { describe, expect, it } from 'vitest';
import { composeCodexTurnInput, mergeCodexDeveloperInstructions } from './codexTurnInput.js';

describe('native Codex turn input', () => {
  it('keeps a follow-up verbatim and places native and app instructions in their own role', () => {
    const followUp = '  Is the export repair verified?\nKeep the existing task scope.  ';
    const native = 'Follow the project rules.\n\n  Preserve intentional indentation.\n';
    const result = composeCodexTurnInput({
      userText: followUp,
      appContext: 'Active task: repair export',
      appendSystemPrompt: 'Report only after the authorized work is complete.',
      nativeDeveloperInstructions: native,
    });

    expect(result.input).toEqual([{ type: 'text', text: followUp, text_elements: [] }]);
    expect(result.developerInstructions).toBe(`${native}\n\nActive task: repair export\n\nReport only after the authorized work is complete.`);
    expect(result.developerInstructions).not.toContain(followUp);
  });

  it('inherits the native setting when every app context source is disabled', () => {
    const result = composeCodexTurnInput({
      userText: 'Inspect the output', appContext: '  ', appendSystemPrompt: '\n',
      nativeDeveloperInstructions: 'Keep my configured behavior.',
    });
    expect(result).not.toHaveProperty('developerInstructions');
    expect(result.input[0]).toEqual({ type: 'text', text: 'Inspect the output', text_elements: [] });
  });

  it('keeps native developer OFF while retaining separately enabled app instructions', () => {
    expect(mergeCodexDeveloperInstructions('', 'App task context')).toBe('App task context');
    expect(mergeCodexDeveloperInstructions(undefined, '')).toBeUndefined();
  });

  it('does not serialize unrelated config values into the prompt', () => {
    const config = { developer_instructions: 'Do not read the entire config', api_key: ['fixture', 'key'].join('-') };
    expect(mergeCodexDeveloperInstructions(config, 'App context')).toBe('App context');
  });

  it('transports local images once without copying their paths into either text role', () => {
    const first = 'C:\\work folder\\capture one.png';
    const second = '/work/screens/capture-two.png';
    const result = composeCodexTurnInput({
      userText: 'Compare the images', appContext: 'Keep the comparison scoped.',
      images: [first, second, first, ''],
    });
    expect(result.input).toEqual([
      { type: 'text', text: 'Compare the images', text_elements: [] },
      { type: 'localImage', path: first }, { type: 'localImage', path: second },
    ]);
    expect(result.developerInstructions).not.toContain(first);
    expect(result.developerInstructions).not.toContain(second);
  });

  it('does not duplicate rules already present in app context and preserves context order', () => {
    const result = composeCodexTurnInput({
      userText: 'Continue', appContext: 'Configured agent rules', rules: 'Configured agent rules',
      appendSystemPrompt: 'Stable protocol', livePreamble: 'Current goal', edgeInstructions: 'Dispatch instructions',
    });
    expect(result.developerInstructions).toBe('Configured agent rules\n\nStable protocol\n\nCurrent goal\n\nDispatch instructions');
  });

  it('retains the rules fallback for callers without assembled context', () => {
    const result = composeCodexTurnInput({ userText: '/compact', rules: 'Agent-specific rules' });
    expect(result.developerInstructions).toBe('Agent-specific rules');
    expect(result.input[0]).toEqual({ type: 'text', text: '/compact', text_elements: [] });
  });
});
