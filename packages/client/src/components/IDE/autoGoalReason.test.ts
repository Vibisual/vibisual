import { describe, expect, it } from 'vitest';
import { formatAutoGoalReason } from './autoGoalReason.js';

describe('procedure reason localization', () => {
  it.each([
    ['Current procedure and dependency evidence have not been reviewed.', 'notReviewed'],
    ['The procedure status was changed in its source file; review is required before activation.', 'statusChanged'],
    ['Stored review evidence is invalid.', 'invalidReview'],
    ['Dependency evidence has not been checked.', 'dependenciesUnchecked'],
    ['Current review evidence is missing.', 'missingReview'],
    ['Procedure applicability changed after review.', 'applicabilityChanged'],
    ['Procedure instructions changed after review.', 'instructionsChanged'],
    ['A reviewed dependency changed or is unavailable.', 'dependencyChanged'],
    ['user-paused', 'userPaused'],
    ['user-requested-review', 'userRequestedReview'],
  ])('translates the server-authored reason %s', (reason, key) => {
    expect(formatAutoGoalReason(reason, (value) => value)).toBe(`ide.autoGoal.reasons.${key}`);
  });

  it('keeps an agent-authored explanation exactly as submitted', () => {
    const reason = 'The migration removed the old build path.\nUse the new compiler instead.';
    expect(formatAutoGoalReason(reason, () => 'translated')).toBe(reason);
    expect(formatAutoGoalReason('user-paused because the project moved', () => 'translated')).toBe('user-paused because the project moved');
  });
});
