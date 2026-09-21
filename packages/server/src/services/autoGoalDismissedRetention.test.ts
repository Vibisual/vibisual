import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  mineAutoGoalCandidates, normalizeAutoGoalSettings, withAutoGoalDismissed, withAutoGoalScope,
  type AutoGoalSettings, type BashEntry,
} from '@vibisual/shared';
import { dropAutoGoalCache, getAutoGoalState } from './autoGoalService.js';

// User decisions exceed the former 200-entry cache cap in an ordinary long-lived project.
const COUNT = 240;
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    dropAutoGoalCache(root);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function observedProcedures(): Record<string, BashEntry[]> {
  return Object.fromEntries(Array.from({ length: COUNT }, (_, procedure) => [
    `session-${procedure}`,
    Array.from({ length: 6 }, (_, index) => ({
      id: `${procedure}-${index}`,
      command: `echo procedure-${procedure}-step-${index % 2}`,
      timestamp: 1_700_000_000_000 + Math.floor(index / 2) * 20 * 60_000 + index % 2,
      status: 'success' as const,
    })),
  ]));
}

describe('dismissed procedures are durable user decisions', () => {
  it('normalizes more than 200 ids without dropping old decisions', () => {
    const ids = Array.from({ length: COUNT }, (_, index) => `dismissed-${index}`);
    const normalized = normalizeAutoGoalSettings({ dismissed: [...ids, ' dismissed-0 ', '', null, 7] });
    expect(normalized.dismissed).toEqual(ids);
    // Loading persisted settings repeats normalization; it must remain lossless.
    expect(normalizeAutoGoalSettings(JSON.parse(JSON.stringify(normalized))).dismissed).toEqual(ids);
  });

  it('adds and updates decisions without evicting any other id across scope changes', () => {
    const ids = Array.from({ length: COUNT }, (_, index) => `dismissed-${index}`);
    let settings: AutoGoalSettings = {};
    for (const id of ids) settings = withAutoGoalDismissed(settings, id, true);
    settings = withAutoGoalDismissed(settings, ids[0]!, true);
    settings = withAutoGoalScope(settings, 'session', 'current', true);
    const restored = normalizeAutoGoalSettings(JSON.parse(JSON.stringify(settings)));
    expect(restored.dismissed).toHaveLength(COUNT);
    expect(new Set(restored.dismissed)).toEqual(new Set(ids));
    expect(restored.enabledSessions).toEqual({ current: true });
  });

  it('does not recreate any of 240 dismissed procedures after save normalization and another dismissal', () => {
    const bashHistory = observedProcedures();
    const candidates = mineAutoGoalCandidates({ bashHistory, max: COUNT }).candidates;
    expect(candidates).toHaveLength(COUNT);
    let settings: AutoGoalSettings = { enabledProject: true };
    for (const candidate of candidates) settings = withAutoGoalDismissed(settings, candidate.id, true);
    settings = normalizeAutoGoalSettings(JSON.parse(JSON.stringify(settings)));
    settings = withAutoGoalDismissed(settings, 'another-obsolete-procedure', true);
    expect(settings.dismissed).toHaveLength(COUNT + 1);

    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-dismissed-')));
    roots.push(root);
    const state = getAutoGoalState(root, settings, {}, { bashHistory });
    expect(state.candidates).toEqual([]);
    expect(state.skills).toEqual([]);
    expect(fs.existsSync(path.join(root, '.vibisual', 'skills'))).toBe(false);

    const restoredId = candidates[0]!.id;
    const explicitlyRestored = withAutoGoalDismissed(settings, restoredId, false);
    expect(explicitlyRestored.dismissed).toHaveLength(COUNT);
    expect(mineAutoGoalCandidates({ bashHistory, dismissed: explicitlyRestored.dismissed }).candidates)
      .toEqual([expect.objectContaining({ id: restoredId })]);
  });
});
