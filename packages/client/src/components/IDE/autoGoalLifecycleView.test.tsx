import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutoGoalSkillSummary } from '@vibisual/shared';
import type { AutoGoalControl } from './autoGoalScope.js';
import en from '../../i18n/locales/en.json';
import { IDEAutoGoalView } from './IDEAutoGoalView.js';
import { AutoGoalSkillRow } from './AutoGoalSkillRow.js';

const fixture = vi.hoisted(() => ({ control: null as AutoGoalControl | null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({
  i18n: { language: 'en' },
  t: (key: string, values?: Record<string, unknown>): string => {
    const value = key.split('.').reduce<unknown>((node, part) => node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined, en);
    return String(value ?? key).replace(/\{\{(\w+)\}\}/g, (_all, name: string) => String(values?.[name] ?? ''));
  },
}) }));
vi.mock('./autoGoalScope.js', () => ({
  useAutoGoalScope: () => fixture.control,
  AutoGoalScopeRows: () => null,
  AutoGoalScopeSummary: () => null,
}));
vi.mock('./useIDEProjectRoot.js', () => ({ useIDEProjectRoot: () => '/project' }));
vi.mock('./idePane.js', () => ({ useIDEPaneValue: () => 'session' }));
vi.mock('../ScrollFade.js', () => ({ ScrollFade: ({ children }: { children: ReactNode }) => createElement('div', null, children) }));

const skill: AutoGoalSkillSummary = { id: 'one', name: 'Build output', description: 'Create current output', steps: 2, runs: 100, createdAt: 1, updatedAt: 1, revision: 'body-hash' };
function renderRow(status?: AutoGoalSkillSummary['status']): string {
  return renderToStaticMarkup(createElement(AutoGoalSkillRow, { skill: { ...skill, ...(status ? { status } : {}) }, rootPath: '/project', disabled: false, onRemove: vi.fn(), onApprove: vi.fn(), onRetire: vi.fn(), onRequestReview: vi.fn() }));
}
beforeEach(() => {
  fixture.control = {
    states: [], effective: true, loading: false, saving: false, error: null,
    set: vi.fn(), dismiss: vi.fn(), removeSkill: vi.fn(), approveSkill: vi.fn(), retireSkill: vi.fn(), requestReview: vi.fn(), refresh: vi.fn(),
    state: { enabled: true, candidates: [], skills: [{ ...skill, status: 'candidate' }], observed: 100, minRuns: 3, analyzedAt: 1,
      metrics: { activeCount: 0, reviewCount: 1, retiredCount: 0, reuseCount: 2, skipCount: 1, failureCount: 0, revisionCount: 3 } },
  };
});

describe('procedure lifecycle view', () => {
  it('shows server reuse and skip outcomes separately from observation counts', () => {
    const html = renderToStaticMarkup(createElement(IDEAutoGoalView, { agentId: 'agent' }));
    expect(html).toContain('Reused 2');
    expect(html).toContain('Skipped 1');
    expect(html).toContain('In use 0');
    expect(html).toContain('To review 1');
    expect(html).toContain('repeated 100×');
    expect(html).not.toContain('Reused 100');
    expect(html).not.toContain('ide.autoGoal.');
  });

  it('does not present old unreviewed files as active', () => {
    const html = renderRow();
    expect(html).toContain('Awaiting review');
    expect(html).toContain('data-procedure-status="candidate"');
    expect(html).not.toContain('In use');
  });

  it('offers an agent review for stopped procedures instead of an activate or approve action', () => {
    const html = renderRow('retired');
    expect(html).toContain('Stopped');
    expect(html).toContain('Request agent review');
    expect(html).not.toContain('>Stop using<');
    expect(html).not.toContain('>Activate<');
    expect(html).not.toContain('>Approve<');
  });

  it('keeps replaced procedures stopped, with no direct reactivation action', () => {
    const html = renderRow('superseded');
    expect(html).toContain('Replaced');
    expect(html).not.toContain('Request agent review');
  });

  it('surfaces save failure while retaining the last confirmed list and a refresh action', () => {
    fixture.control!.error = 'save';
    const html = renderToStaticMarkup(createElement(IDEAutoGoalView, { agentId: 'agent' }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('The change could not be confirmed');
    expect(html).toContain('aria-label="Refresh procedures"');
    expect(html).toContain('Build output');
  });
});
