import { describe, expect, it } from 'vitest';
import type { AgentProvider } from '@vibisual/shared';
import { prepareLocalModelSelection } from './localModelConfig.js';

describe('local model selection', () => {
  const previous: AgentProvider = {
    kind: 'local-llama', modelId: 'old', toolSupport: 'none', contextUsed: 15000,
    contextLimit: 16384, contextSize: 8192, temperature: 0.4, tokensIn: 20000,
  };

  it('a new model is allowed to prove its tool support and loaded context', () => {
    const selected = prepareLocalModelSelection(previous, { ...previous, modelId: 'new' });
    expect(selected?.toolSupport).toBe('unknown');
    expect(selected).not.toHaveProperty('contextUsed');
    expect(selected).not.toHaveProperty('contextLimit');
    expect(selected).toMatchObject({ contextSize: 8192, temperature: 0.4, tokensIn: 20000 });
    expect(previous.toolSupport).toBe('none');
  });

  it('saving settings for the same model preserves its measured values', () => {
    const next = { ...previous, temperature: 0.8 };
    expect(prepareLocalModelSelection(previous, next)).toBe(next);
  });

  it('does not alter other providers or an absent provider', () => {
    const codex: AgentProvider = { kind: 'codex-cli', modelId: 'model' };
    expect(prepareLocalModelSelection(previous, codex)).toBe(codex);
    expect(prepareLocalModelSelection(previous, undefined)).toBeUndefined();
  });
});
