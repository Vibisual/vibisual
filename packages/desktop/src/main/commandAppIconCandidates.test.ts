import { describe, expect, it, vi } from 'vitest';
import { commandAppIconCandidates } from './commandAppIconCandidates';
import { createCommandAppIconResolver } from './commandAppIcon';
import type { IconImage, IconTarget } from './commandAppIconSource';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHZkAAAAASUVORK5CYII=', 'base64');
const IMAGE: IconImage = { mime: 'image/png', data: PNG };

describe('grounded Unreal icon candidates', () => {
  it.each(['C:/UE/Engine/Build/BatchFiles/RunUAT.bat', 'C:/UE/Engine/Build/BatchFiles/Build.bat',
    'C:/UE/Engine/Binaries/Win64/UnrealEditor-Cmd.exe'])('tries two editor siblings before original %s', (input) => {
    expect(commandAppIconCandidates(input, 'win32')).toEqual([
      { executable: 'C:\\UE\\Engine\\Binaries\\Win64\\UnrealEditor.exe' },
      { executable: 'C:\\UE\\Engine\\Binaries\\Win64\\UE4Editor.exe' },
      { executable: input.replace(/\//g, '\\') },
    ]);
  });

  it('finds the macOS bundle via its executable, and on Linux the engine-shipped icon beside the native binary', () => {
    expect(commandAppIconCandidates('/UE/Engine/Build/BatchFiles/Mac/Build.sh', 'darwin')[0]).toEqual({
      executable: '/UE/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor',
      bundle: '/UE/Engine/Binaries/Mac/UnrealEditor.app',
    });
    expect(commandAppIconCandidates('/UE/Engine/Build/BatchFiles/RunUAT.sh', 'linux').slice(0, 2)).toEqual([
      { executable: '/UE/Engine/Binaries/Linux/UnrealEditor', iconFile: '/UE/Engine/Source/Runtime/Launch/Resources/Linux/UnrealEngine.png' },
      { executable: '/UE/Engine/Binaries/Linux/UE4Editor', iconFile: '/UE/Engine/Source/Runtime/Launch/Resources/Linux/UE4.png' },
    ]);
  });

  it('treats a grounded managed assembly only as a hint, preserving dotnet identity outside this resolver', () => {
    const candidates = commandAppIconCandidates('C:/UE/Engine/Binaries/DotNET/AutomationTool/AutomationTool.dll', 'win32');
    expect(candidates).toHaveLength(2);
    expect(candidates.every((candidate) => candidate.executable.endsWith('Editor.exe'))).toBe(true);
  });

  it.each(['RunUAT.bat', 'dotnet', 'C:/scripts/Build.bat', 'C:/UE/Engine/Fake/RunUAT.bat',
    'C:/elsewhere/AutomationTool.dll'])('does not infer engine installation for %s', (input) => {
    expect(commandAppIconCandidates(input, 'win32')).toEqual([{ executable: input.replace(/\//g, '\\') }]);
  });

  it.each(['//server/UE/Engine/Build/BatchFiles/RunUAT.bat', 'https://host/UE/Engine/Build/BatchFiles/RunUAT.bat'])('rejects non-local source %s', (input) => {
    expect(commandAppIconCandidates(input, 'win32')).toEqual([]);
  });

  it('uses a verified sibling editor and falls back if that editor icon fails', async () => {
    const realpath = vi.fn(async (file: string): Promise<string> => {
      if (file.endsWith('UE4Editor.exe')) throw new Error('missing');
      return file;
    });
    const readIcon = vi.fn(async (_target: IconTarget): Promise<IconImage | null> => IMAGE);
    const make = (): ReturnType<typeof createCommandAppIconResolver> => createCommandAppIconResolver({
      platform: 'win32', env: {}, knownDirs: [], realpath,
      stat: async () => ({ isFile: () => true, mode: 0 }), readIcon,
    });
    const first = make();
    expect(await first.get('C:/UE/Engine/Build/BatchFiles/RunUAT.bat')).toMatch(/^data:image\/png;/);
    expect(readIcon.mock.lastCall![0].file).toBe('C:\\UE\\Engine\\Binaries\\Win64\\UnrealEditor.exe');
    first.dispose();
    readIcon.mockRejectedValueOnce(new Error('no icon'));
    const second = make();
    expect(await second.get('C:/UE/Engine/Build/BatchFiles/RunUAT.bat')).toMatch(/^data:image\/png;/);
    expect(readIcon.mock.lastCall![0].file).toBe('C:\\UE\\Engine\\Build\\BatchFiles\\RunUAT.bat');
    second.dispose();
  });

  it('a candidate without an icon of its own moves on to the next one', async () => {
    const readIcon = vi.fn(async (target: IconTarget): Promise<IconImage | null> => (target.file.endsWith('UnrealEditor.exe') ? null : IMAGE));
    const cache = createCommandAppIconResolver({
      platform: 'win32', env: {}, knownDirs: [], realpath: async (file) => file,
      stat: async () => ({ isFile: () => true, mode: 0 }), readIcon,
    });
    expect(await cache.get('C:/UE/Engine/Build/BatchFiles/Build.bat')).toMatch(/^data:image\/png;/);
    expect(readIcon.mock.calls.map(([target]) => target.file)).toEqual([
      'C:\\UE\\Engine\\Binaries\\Win64\\UnrealEditor.exe', 'C:\\UE\\Engine\\Binaries\\Win64\\UE4Editor.exe',
    ]);
    cache.dispose();
  });

  it('asks macOS for the bundle icon only after its executable has been checked', async () => {
    const readIcon = vi.fn(async (_target: IconTarget): Promise<IconImage | null> => IMAGE);
    const cache = createCommandAppIconResolver({
      platform: 'darwin', env: {}, knownDirs: [], realpath: async (file) => file,
      stat: async () => ({ isFile: () => true, mode: 0o755 }), readIcon,
    });
    await cache.get('/UE/Engine/Build/BatchFiles/RunUAT.sh');
    expect(readIcon.mock.calls[0]![0]).toEqual({
      file: '/UE/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor',
      command: '/UE/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor',
      bundle: '/UE/Engine/Binaries/Mac/UnrealEditor.app',
    });
    cache.dispose();
  });

  it('hands Linux the engine icon file only once the editor binary is verified', async () => {
    const readIcon = vi.fn(async (_target: IconTarget): Promise<IconImage | null> => IMAGE);
    const cache = createCommandAppIconResolver({
      platform: 'linux', env: {}, knownDirs: [], realpath: async (file) => file,
      stat: async (file) => ({ isFile: () => !file.endsWith('UnrealEditor'), mode: 0o755 }), readIcon,
    });
    await cache.get('/UE/Engine/Build/BatchFiles/RunUAT.sh');
    expect(readIcon.mock.calls[0]![0]).toEqual({
      file: '/UE/Engine/Binaries/Linux/UE4Editor',
      command: '/UE/Engine/Binaries/Linux/UE4Editor',
      iconFile: '/UE/Engine/Source/Runtime/Launch/Resources/Linux/UE4.png',
    });
    cache.dispose();
  });
});
