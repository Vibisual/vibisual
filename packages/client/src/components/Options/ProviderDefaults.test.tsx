import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ProviderDefaults, type ProviderDefaultsHandle } from './ProviderDefaults.js';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../stores/graphStore.js', () => ({ useGraphStore: (select: (s: unknown) => unknown) => select({
  userDefaults: { updatedAt: 1 },
  codexModels: { models: [{ slug: 'model-a', displayName: 'Model A', reasoningLevels: ['low', 'high'], defaultReasoningLevel: 'high' }] },
}) }));
vi.mock('../Codex/useCodexEffectiveConfig.js', () => ({ useCodexEffectiveConfig: () => ({ layers: [] }) }));
vi.mock('../LocalModel/localEffective.js', () => ({ useLocalSampling: () => null, localContextPlaceholder: () => ({}), localTemperaturePlaceholder: () => ({}) }));

it('offers the default model reasoning levels and the complete shared Codex controls', () => {
  const html = renderToStaticMarkup(createElement(ProviderDefaults, { engine: 'codex', ref: createRef<ProviderDefaultsHandle>() }));
  for (const key of ['providers.effort', 'providers.codexTools', 'providers.reasoningSummary', 'providers.serviceTier', 'providers.autoCompactTokenLimit', 'panel.agentConfig.codex.network.label', 'panel.agentConfig.permissionMode.label', 'panel.agentConfig.permissionTimeoutPolicy.label']) expect(html).toContain(key);
  expect(html).toContain('value="high"');
  expect(html).toContain('exec_command / write_stdin');
  expect(html).not.toContain('providers.save'); // The window owns Apply.
});
