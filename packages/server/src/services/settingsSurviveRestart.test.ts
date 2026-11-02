import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listEffortLevels, pathKey as sharedPathKey, resolveAgentConfig, resolveAgentDefaults } from '@vibisual/shared';
import type { ModelRegistry, PlatformName, UserDefaults } from '@vibisual/shared';

/**
 * §4·§5.25 — 저장한 설정이 재시작·업데이트 뒤에도 같은 값으로 읽히는가.
 * ① 프로젝트 칸은 경로가 키라, 저장한 표기(`C:/work/…`)와 찾는 표기(서버의 접힌 키·`c:` 드라이브)가 달라도 찾아야 한다.
 * ② UI 언어는 `user-defaults.json` 에 남는다. ③ effort 칸은 이번 CLI 목록에 없는 저장값도 그린다.
 */

// 실제 저장 서비스를 돌리되 읽고 쓰기는 메모리에만(사용자 홈을 건드리지 않는다).
const disk = vi.hoisted(() => ({ raw: undefined as string | undefined, temporary: undefined as string | undefined }));
const io = vi.hoisted(() => ({ mkdir: vi.fn(), writeFile: vi.fn(), rename: vi.fn() }));
vi.mock('node:fs/promises', () => ({ default: io }));
vi.mock('node:fs', () => ({ default: { existsSync: () => disk.raw !== undefined, readFileSync: () => disk.raw } }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  disk.raw = undefined;
  disk.temporary = undefined;
  io.mkdir.mockResolvedValue(undefined);
  io.writeFile.mockImplementation(async (_file: string, contents: string) => { disk.temporary = contents; });
  io.rename.mockImplementation(async () => { disk.raw = disk.temporary; });
});

/** 그 플랫폼의 경로 규칙으로 서비스를 새로 띄운다(= 앱 재시작). */
async function loadService(platform: PlatformName) {
  vi.doMock('./pathKey.js', () => ({ pathKey: (p: string) => sharedPathKey(p, platform) }));
  return (await import('./userDefaultsService.js')).userDefaultsService;
}

const codex = (reasoningEffort: string, modelId = '') => ({ provider: { kind: 'codex-cli' as const, modelId, reasoningEffort } });

describe('프로젝트별 설정 — 같은 폴더의 다른 표기는 한 칸에 모인다', () => {
  it('Windows: 드라이브 문자·대소문자만 다른 저장은 처음 칸에 합쳐진다', async () => {
    const service = await loadService('win32');
    await service.update({ projectEngineConfigs: { 'C:/work/Proj': { codex: codex('max') } } });
    await service.update({ projectEngineConfigs: { 'c:/work/proj': { codex: codex('high') } } });

    const map = service.get().projectEngineConfigs ?? {};
    expect(Object.keys(map)).toEqual(['C:/work/Proj']);
    expect(map['C:/work/Proj']?.codex?.provider?.reasoningEffort).toBe('high');
  });

  it('Linux: 대소문자만 다른 두 폴더는 서로 다른 폴더라 따로 남는다', async () => {
    const service = await loadService('linux');
    await service.update({ projectEngineConfigs: { '/srv/projects/Proj': { codex: codex('max') } } });
    await service.update({ projectEngineConfigs: { '/srv/projects/proj': { codex: codex('high') } } });

    expect(Object.keys(service.get().projectEngineConfigs ?? {}).sort()).toEqual(['/srv/projects/Proj', '/srv/projects/proj']);
  });
});

describe('UI 언어 — 설정 파일에 남아 재시작 뒤에도 읽힌다', () => {
  it('저장한 언어가 다음 실행의 서비스에서 그대로 나온다', async () => {
    const first = await loadService('win32');
    await first.update({ appearance: { uiLocale: 'ko' } });

    vi.resetModules();
    const restarted = await loadService('win32');
    expect(restarted.get().appearance?.uiLocale).toBe('ko');
  });
});

describe('프로젝트 칸 찾기 — 서버는 접힌 키로, 화면은 원래 표기로 찾는다', () => {
  const defaults: UserDefaults = {
    updatedAt: 1,
    engineChoice: { kind: 'claude', chosenAt: 1 },
    agentConfig: { model: 'opus' },
    engineConfigs: { codex: codex('ultra', 'global-model') },
    projectEngineConfigs: { 'C:/work/Proj': { codex: codex('max') } },
  };

  it('win32 — 소문자로 접힌 서버 키로도 저장된 프로젝트 값이 나온다', () => {
    const resolved = resolveAgentDefaults(defaults, 'codex', 'c:/work/proj', 'win32');
    expect(resolved.provider?.reasoningEffort).toBe('max');
    expect(resolved.provider?.modelId).toBe('global-model');
  });

  it('완성본 해소도 같은 칸을 본다(스폰·상태바가 읽는 값)', () => {
    const resolved = resolveAgentConfig({ provider: { kind: 'codex-cli', modelId: '' } }, defaults, 'c:/work/proj', 'win32');
    expect(resolved.provider?.reasoningEffort).toBe('max');
  });

  it('linux — 대소문자가 다르면 다른 폴더라 전역 값을 따른다', () => {
    const linux: UserDefaults = { ...defaults, projectEngineConfigs: { '/srv/projects/Proj': { codex: codex('max') } } };
    expect(resolveAgentDefaults(linux, 'codex', '/srv/projects/proj', 'linux').provider?.reasoningEffort).toBe('ultra');
    expect(resolveAgentDefaults(linux, 'codex', '/srv/projects/Proj/', 'linux').provider?.reasoningEffort).toBe('max');
  });

  it('플랫폼을 모르면 모양만 맞추고 대소문자는 접지 않는다', () => {
    expect(resolveAgentDefaults(defaults, 'codex', 'C:\\work\\Proj\\').provider?.reasoningEffort).toBe('max');
    expect(resolveAgentDefaults(defaults, 'codex', 'c:/work/proj').provider?.reasoningEffort).toBe('ultra');
  });
});

describe('effort 칸 — 이번 CLI 목록에 없는 저장값도 그린다', () => {
  const registry = { effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] } as unknown as ModelRegistry;

  it('도움말 밖 등급(probe 실패로 빠진 ultracode)이 저장돼 있으면 목록 끝에 남는다', () => {
    expect(listEffortLevels(registry, 'ultracode')).toEqual(['default', 'low', 'medium', 'high', 'xhigh', 'max', 'ultracode']);
  });

  it('이미 있는 값·미설정은 겹쳐 넣지 않는다', () => {
    expect(listEffortLevels(registry, 'max')).toEqual(['default', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(listEffortLevels(registry, 'default')).toEqual(['default', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(listEffortLevels(registry, undefined)).toEqual(['default', 'low', 'medium', 'high', 'xhigh', 'max']);
  });
});
