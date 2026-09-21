import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AutoGoalSummary } from '@vibisual/shared';
import type { PluginBubbleContext, PluginClientModule } from './types.js';
import { readAutoGoal } from './sdk/judgments/autoGoal.js';
import { memoryInvalidationClient } from './memory-invalidation/index.js';
import { supersedeClient } from './supersede/index.js';
import { reflexionClient } from './reflexion/index.js';
import { strings as invalidationStrings } from './memory-invalidation/strings.js';
import { strings as supersedeStrings } from './supersede/strings.js';
import { strings as reflexionStrings } from './reflexion/strings.js';

function context(patch: Partial<AutoGoalSummary> = {}): PluginBubbleContext {
  return {
    bubbleId: 'agent', bubbleType: 'agent', label: 'Agent', customCreated: true, now: 1, t: (key) => key,
    data: { autoGoal: {
      enabled: true, skillCount: 10, candidateCount: 2, dismissedCount: 8, anchoredCount: 10,
      fromCommand: 10, fromStep: 0, observed: 300, minRuns: 3, topRuns: 50, totalRuns: 100,
      ...patch,
    } },
  };
}
function render(client: PluginClientModule, ctx: PluginBubbleContext): string {
  return renderToStaticMarkup(<>{client.panelSections?.[0]?.render(ctx)}</>);
}

describe('procedure lifecycle readings', () => {
  it('treats old stored files as awaiting review, not as active or carried instructions', () => {
    const reading = readAutoGoal(context());
    expect(reading).toMatchObject({ skills: 10, stored: 12, active: 0, review: 12, retired: 0, carried: 0, revisions: 0, reused: 0, skipped: 0, failed: 0 });
    expect(memoryInvalidationClient.panelSections?.[0]?.severity?.(context())).toBe('warn');
  });

  it('reads lifecycle and outcome counters independently of file and observation counts', () => {
    const reading = readAutoGoal(context({ activeCount: 3, reviewCount: 5, retiredCount: 2, revisionCount: 4, reuseCount: 6, skipCount: 1, failureCount: 2 }));
    expect(reading).toMatchObject({ skills: 10, stored: 12, active: 3, review: 5, retired: 2, carried: 3, revisions: 4, reused: 6, skipped: 1, failed: 2 });
  });

  it('keeps incomplete lifecycle summaries conservative and respects agent disablement', () => {
    expect(readAutoGoal(context({ activeCount: 10 }))).toMatchObject({ active: 0, review: 12, carried: 0 });
    expect(readAutoGoal(context({ activeCount: 10, reviewCount: 0, retiredCount: 0, agentEnabled: { agent: false } }))).toMatchObject({ active: 10, activeHere: false, carried: 0 });
  });

  it('does not present dismissed patterns as stopped procedure history', () => {
    const ctx = context({ activeCount: 3, reviewCount: 7, retiredCount: 0, dismissedCount: 100 });
    expect(render(supersedeClient, ctx)).toContain('panel.plugins.supersede.level.flat');
    expect(render(supersedeClient, context({ activeCount: 3, reviewCount: 5, retiredCount: 2, dismissedCount: 0 }))).toContain('panel.plugins.supersede.level.history');
  });

  it('shows a clean review queue only from review state, not from the absence of mining candidates', () => {
    const ctx = context({ candidateCount: 0, activeCount: 0, reviewCount: 10, retiredCount: 0 });
    expect(render(memoryInvalidationClient, ctx)).toContain('panel.plugins.memoryInvalidation.level.pending');
    expect(render(memoryInvalidationClient, context({ candidateCount: 8, activeCount: 10, reviewCount: 0, retiredCount: 0 }))).toContain('panel.plugins.memoryInvalidation.level.clean');
  });

  it('does not treat self-reported lessons as successful procedure review', () => {
    const ctx = context();
    ctx.data.agentReports = [{ id: 'report', agentId: 'agent', did: [], userActions: [], learned: ['All fixed'], createdAt: 1 }];
    expect(render(reflexionClient, ctx)).toContain('panel.plugins.reflexion.level.pending');
    ctx.data.autoGoal = null;
    expect(render(reflexionClient, ctx)).toContain('panel.plugins.reflexion.level.none');
    expect(reflexionClient.needs).toEqual(['autoGoal']);
    expect(render(reflexionClient, context({ activeCount: 10, reviewCount: 0, retiredCount: 0 }))).toContain('panel.plugins.reflexion.level.reviewed');
  });

  it('keeps all lifecycle descriptions and row labels translated across the 12 locales', () => {
    for (const bundle of [invalidationStrings, supersedeStrings, reflexionStrings]) {
      const sourceKeys = JSON.stringify(Object.keys(bundle.en.check).sort());
      expect(Object.keys(bundle)).toHaveLength(12);
      for (const [locale, values] of Object.entries(bundle)) {
        expect(JSON.stringify(Object.keys(values.check).sort()), locale).toBe(sourceKeys);
        if (locale !== 'en') {
          expect(values.desc, locale).not.toBe(bundle.en.desc);
          expect(values.note, locale).not.toBe(bundle.en.note);
        }
      }
    }
  });
});
