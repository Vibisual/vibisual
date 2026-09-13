import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveAgentConfig, resolveAgentDefaults } from '@vibisual/shared';
const io = vi.hoisted(() => ({ mkdir: vi.fn(), writeFile: vi.fn(), rename: vi.fn() }));
vi.mock('node:fs/promises', () => ({ default: io }));
vi.mock('node:fs', () => ({ default: { existsSync: () => false } }));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
describe('provider defaults persistence', () => {
  it('preserves settings when switching Claude → Codex → Claude and back', async () => {
    const { userDefaultsService: service } = await import('./userDefaultsService.js');
    await service.update({ agentConfig: { model: 'sonnet', rules: 'Claude rules' } });
    await service.update({ engineConfigs: { codex: { provider: { kind: 'codex-cli', modelId: 'test-model', reasoningEffort: 'high' }, rules: 'Codex rules' } } });
    let saved = await service.update({ engineChoice: { kind: 'codex', chosenAt: 1 }, agentConfig: { provider: { kind: 'codex-cli', modelId: '' } } });
    expect(saved.agentConfig?.provider?.modelId).toBe('test-model');
    expect(saved.engineConfigs?.claude?.model).toBe('sonnet');
    saved = await service.update({ engineChoice: { kind: 'claude', chosenAt: 2 }, agentConfig: { provider: null } });
    expect(saved.agentConfig?.provider).toBeUndefined();
    expect(saved.agentConfig?.rules).toBe('Claude rules');
    saved = await service.update({ engineChoice: { kind: 'codex', chosenAt: 3 } });
    expect(saved.agentConfig?.rules).toBe('Codex rules');
  });
  it('keeps project and provider scopes separate, including concurrent writes', async () => {
    const { userDefaultsService: service } = await import('./userDefaultsService.js');
    await Promise.all([
      service.update({ projectEngineConfigs: { '/a': { claude: { model: 'sonnet' } } } }),
      service.update({ projectEngineConfigs: { '/a': { codex: { provider: { kind: 'codex-cli', modelId: 'project-model' } } }, '/b': { claude: { model: 'opus' } } } }),
    ]);
    expect(resolveAgentDefaults(service.get(), 'claude', '/a').model).toBe('sonnet');
    expect(resolveAgentConfig({ provider: { kind: 'codex-cli', modelId: '' } }, service.get(), '/a').provider?.modelId).toBe('project-model');
    expect(resolveAgentDefaults(service.get(), 'claude', '/b').model).toBe('opus');
  });
  it('does not turn existing Claude agents into Codex when the main changes', async () => {
    const { userDefaultsService: service } = await import('./userDefaultsService.js');
    await service.update({ agentConfig: { model: 'sonnet' } });
    await service.update({ engineChoice: { kind: 'codex', chosenAt: 1 } });
    expect(resolveAgentConfig({}, service.get()).provider).toBeUndefined();
    expect(resolveAgentConfig({}, service.get()).model).toBe('sonnet');
    expect(resolveAgentDefaults(service.get()).provider?.kind).toBe('codex-cli');
  });
  it('rejects a failed disk save and retains the previous selection', async () => {
    const { userDefaultsService: service } = await import('./userDefaultsService.js');
    io.rename.mockRejectedValueOnce(new Error('disk full'));
    await expect(service.update({ engineChoice: { kind: 'codex', chosenAt: 1 } })).rejects.toThrow('disk full');
    expect(service.get().engineChoice).toBeUndefined();
  });
});
