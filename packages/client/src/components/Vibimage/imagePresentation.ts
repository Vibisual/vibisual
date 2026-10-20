import type { CreationCandidateSummary } from '@vibisual/shared';

/** The node and every source editor open on the same current proposal; reviewing never adopts it. */
export function latestImageCandidate(
  candidates: readonly CreationCandidateSummary[], revision: number | undefined,
): CreationCandidateSummary | undefined {
  return candidates.filter((item) => item.status === 'pending' && item.baseRevision === revision)
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))[0];
}
