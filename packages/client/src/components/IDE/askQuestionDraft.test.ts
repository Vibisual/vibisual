import { describe, expect, it } from 'vitest';
import type { AskUserQuestionRequest } from '@vibisual/shared';
import { compileAnswer, draftFromAnswer, type StepDraft } from './askQuestionDraft.js';

const item = {
  question: 'Which branch?',
  multiSelect: true,
  options: [{ label: 'main' }, { label: 'dev' }, { label: 'release' }],
} as unknown as AskUserQuestionRequest['items'][number];

describe('restoring a question card from the answers it failed to send', () => {
  it.each<[string, StepDraft]>([
    ['options only', { selected: new Set([2, 0]), note: '' }],
    ['options with a note', { selected: new Set([1]), note: 'after review' }],
    ['a written-in answer', { selected: new Set([0, 3]), note: 'hotfix' }],
  ])('%s round-trips through the sent answer', (_label, draft) => {
    const answer = compileAnswer(draft, item);
    const restored = draftFromAnswer(item, answer);
    expect(compileAnswer(restored, item)).toEqual(answer);
    expect([...restored.selected].sort()).toEqual([...draft.selected].sort());
    expect(restored.note).toBe(draft.note);
  });

  it('an item without a saved answer starts empty', () => {
    const restored = draftFromAnswer(item, undefined);
    expect(restored.selected.size).toBe(0);
    expect(restored.note).toBe('');
  });
});
