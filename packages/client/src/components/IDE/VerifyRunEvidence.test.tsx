import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { VerificationRun } from '@vibisual/shared';
import { VerifyRunEvidence } from './VerifyRunEvidence.js';
import en from '../../i18n/locales/en.json';

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, values?: Record<string, unknown>): string => {
    const value = key.split('.').reduce<unknown>((node, part) => node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined, en);
    return String(value ?? key).replace(/\{\{(\w+)\}\}/g, (_all, name: string) => String(values?.[name] ?? ''));
  },
}) }));
vi.mock('../../stores/graphStore.js', () => ({ useGraphStore: (selector: (value: unknown) => unknown) => selector({ openImageLightbox: vi.fn() }) }));

const run: VerificationRun = {
  id: 'run-one', agentId: 'agent', subAgentId: 'session', projectName: 'project', status: 'done', verdict: 'pass', startedAt: 0, recipeSource: 'none', attempts: [],
  target: { kind: 'browser', url: 'http://localhost:3000' }, requiredSteps: 2,
  toolEvents: [{ id: 'event-one', operation: 'act', action: { kind: 'click', selector: '#save' }, at: 1, durationMs: 3, stepIndex: 0, ok: true, detail: 'Clicked Save', evidenceId: 'shot-one' }],
  evidence: [{ id: 'shot-one', rel: 'hidden/path.png', capturedAt: 1, sha256: 'abc', width: 100, height: 100 }],
};
describe('actual verification evidence UI', () => {
  it('renders durable screenshots and actual step coverage without exposing disk paths', () => {
    const html = renderToStaticMarkup(createElement(VerifyRunEvidence, { run, readOnly: false }));
    expect(html).toContain('/api/verification-runs/run-one/evidence/shot-one.png');
    expect(html).toContain('Steps completed: 1 / 2');
    expect(html).toContain('Clicked Save');
    expect(html).toContain('Save successful actions as a procedure');
    expect(html).not.toContain('hidden/path');
    expect(html).not.toContain('ide.verify.');
  });
  it('never offers to save a failed, read-only, or self-reported run as a successful procedure', () => {
    for (const props of [
      { run: { ...run, verdict: 'fail' as const }, readOnly: false },
      { run, readOnly: true },
      { run: { ...run, toolEvents: [] }, readOnly: false },
    ]) expect(renderToStaticMarkup(createElement(VerifyRunEvidence, props))).not.toContain('Save successful actions as a procedure');
  });
});
