import type { AgentProvider } from '@vibisual/shared';

/** A new model has not inherited the old model's tool verdict or loaded context. */
export function prepareLocalModelSelection(
  previous: AgentProvider | undefined,
  next: AgentProvider | undefined,
): AgentProvider | undefined {
  if (!next || next.kind !== 'local-llama'
    || (previous?.kind === next.kind && previous.modelId === next.modelId)) return next;
  const selected = { ...next, toolSupport: 'unknown' as const };
  delete selected.contextUsed;
  delete selected.contextLimit;
  return selected;
}
