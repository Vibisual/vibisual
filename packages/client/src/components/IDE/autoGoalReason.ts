/** Exact server-authored reasons are UI copy. An agent's own explanation remains verbatim. */
const REASON_KEYS = new Map<string, string>([
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
]);

export function formatAutoGoalReason(reason: string, t: (key: string) => string): string {
  const key = REASON_KEYS.get(reason);
  return key ? t(`ide.autoGoal.reasons.${key}`) : reason;
}
