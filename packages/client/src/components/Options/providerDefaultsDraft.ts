import { resolveAgentDefaults, sparsifyAgentConfig, type AgentConfig, type AgentEngineKind, type UserDefaults, type UserDefaultsPatch } from '@vibisual/shared';

/** Project values are differences, so untouched fields continue following global defaults. */
export function providerDefaultsPatch(draft: Partial<AgentConfig>, defaults: UserDefaults | null | undefined, engine: AgentEngineKind, projectPath?: string): UserDefaultsPatch {
  if (!projectPath) return { engineConfigs: { [engine]: draft } };
  const global = resolveAgentDefaults(defaults, engine);
  const overrides = sparsifyAgentConfig(draft, global);
  if (overrides.provider && global.provider) {
    const provider = { ...overrides.provider };
    if (provider.modelId === global.provider.modelId) { provider.modelId = ''; delete provider.modelName; }
    overrides.provider = provider;
  }
  return { projectEngineConfigs: { [projectPath]: { [engine]: overrides } } };
}
