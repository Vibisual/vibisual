import { describe, expect, it } from 'vitest';
import { resolveAgentConfig, resolveAgentDefaults, sparsifyAgentConfig, type UserDefaults } from '@vibisual/shared';
import { providerDefaultsPatch } from './providerDefaultsDraft.js';

const defaults: UserDefaults = { updatedAt: 1, engineConfigs: { codex: {
  permissionMode: 'default', rules: 'global rules', provider: {
    kind: 'codex-cli', modelId: 'model-a', webSearch: 'live', networkAccess: true,
    modelVerbosity: 'high', reasoningSummary: 'auto', codexTools: { shell: 'ask' },
  },
} } };

describe('Codex settings scopes', () => {
  it('saves project differences and follows later global changes for untouched settings', () => {
    const draft = resolveAgentDefaults(defaults, 'codex', '/a');
    draft.provider = { ...draft.provider!, networkAccess: false, personality: 'pragmatic' };
    const patch = JSON.parse(JSON.stringify(providerDefaultsPatch(draft, defaults, 'codex', '/a')));
    const updated = { ...defaults, ...patch };
    updated.engineConfigs = { codex: { ...defaults.engineConfigs!.codex, rules: 'new rules', provider: {
      ...defaults.engineConfigs!.codex!.provider!, modelId: 'model-b', webSearch: 'cached',
    } } };
    expect(resolveAgentDefaults(updated, 'codex', '/a')).toMatchObject({ rules: 'new rules', provider: {
      modelId: 'model-b', webSearch: 'cached', networkAccess: false, personality: 'pragmatic',
    } });
    expect(resolveAgentDefaults(updated, 'codex', '/b').provider?.networkAccess).toBe(true);
  });

  it('clears global settings on the JSON wire and keeps explicit false/tool resets', () => {
    const draft = resolveAgentDefaults(defaults, 'codex');
    draft.provider = { ...draft.provider!, webSearch: undefined, networkAccess: false, codexTools: {} };
    const patch = JSON.parse(JSON.stringify(providerDefaultsPatch(draft, defaults, 'codex')));
    expect(patch.engineConfigs.codex.provider).not.toHaveProperty('webSearch');
    expect(patch.engineConfigs.codex.provider).toMatchObject({ networkAccess: false, codexTools: {} });
  });

  it('saving an individual preference does not freeze inherited preferences or lose usage', () => {
    const base = resolveAgentDefaults(defaults, 'codex');
    const config = { ...base, provider: { ...base.provider!, modelVerbosity: 'low' as const, tokensIn: 123 } };
    const overrides = sparsifyAgentConfig(config, base);
    expect(overrides.provider).toMatchObject({ modelId: '', modelVerbosity: 'low', tokensIn: 123 });
    expect(overrides.provider).not.toHaveProperty('webSearch');
    const updated = { ...defaults, engineConfigs: { codex: { provider: { ...base.provider!, webSearch: 'disabled' as const } } } };
    expect(resolveAgentConfig(overrides, updated).provider).toMatchObject({ webSearch: 'disabled', modelVerbosity: 'low', tokensIn: 123 });
  });
});
