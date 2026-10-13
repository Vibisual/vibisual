import { describe, expect, it } from 'vitest';
import { codexEffortOptionsFor, codexModelOptionsFor } from './codexSelectionOptions.js';

const current = { slug: 'new-model', displayName: 'New Model', reasoningLevels: ['low', 'max', 'ultra'] };

describe('Codex refreshed selection options', () => {
  it('keeps a saved model visible after retirement, hidden filtering or an outage', () => {
    for (const models of [[current], []]) {
      const choices = codexModelOptionsFor(models, 'saved-model', 'My Model', 'retained');
      expect(choices[0]).toEqual({ value: 'saved-model', label: 'My Model', description: 'retained' });
    }
  });

  it('uses refreshed metadata without duplicating or selecting an entry', () => {
    expect(codexModelOptionsFor([current], current.slug, 'Old name', 'retained')).toEqual([
      { value: current.slug, label: current.displayName, description: current.slug },
    ]);
    expect(codexModelOptionsFor([current], '', undefined, 'retained').map((option) => option.value)).toEqual([current.slug]);
  });

  it('preserves saved efforts and accepts future efforts reported by Codex', () => {
    expect(codexEffortOptionsFor(current.reasoningLevels, 'ultra').map((option) => option.value)).toEqual(['low', 'max', 'ultra']);
    expect(codexEffortOptionsFor(['low'], 'ultra').map((option) => option.value)).toEqual(['ultra', 'low']);
    expect(codexEffortOptionsFor([], 'custom-effort').map((option) => option.value)).toEqual(['custom-effort']);
  });
});
