import { describe, expect, it, vi } from 'vitest';
import { commandAppIconCandidates } from './commandAppIconCandidates';
import { createCommandAppIconResolver } from './commandAppIcon';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHZkAAAAASUVORK5CYII=', 'base64');

describe('grounded Unreal icon candidates', () => {
  it.each(['C:/UE/Engine/Build/BatchFiles/RunUAT.bat', 'C:/UE/Engine/Build/BatchFiles/Build.bat',
    'C:/UE/Engine/Binaries/Win64/UnrealEditor-Cmd.exe'])('tries two editor siblings before original %s', (input) => {
    expect(commandAppIconCandidates(input, 'win32')).toEqual([
      { executable: 'C:\\UE\\Engine\\Binaries\\Win64\\UnrealEditor.exe' },
      { executable: 'C:\\UE\\Engine\\Binaries\\Win64\\UE4Editor.exe' },
      { executable: input.replace(/\//g, '\\') },
    ]);
  });

  it('finds the macOS bundle via its executable and Linux via the native binary', () => {
    expect(commandAppIconCandidates('/UE/Engine/Build/BatchFiles/Mac/Build.sh', 'darwin')[0]).toEqual({
      executable: '/UE/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor',
      bundle: '/UE/Engine/Binaries/Mac/UnrealEditor.app',
    });
    expect(commandAppIconCandidates('/UE/Engine/Build/BatchFiles/RunUAT.sh', 'linux')[0]).toEqual({
      executable: '/UE/Engine/Binaries/Linux/UnrealEditor',
    });
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
    const getIconPng = vi.fn(async (_file: string): Promise<Buffer | null> => PNG);
    const make = (): ReturnType<typeof createCommandAppIconResolver> => createCommandAppIconResolver({
      platform: 'win32', env: {}, knownDirs: [], realpath,
      stat: async () => ({ isFile: () => true, mode: 0 }), getIconPng,
    });
    const first = make();
    expect(await first.get('C:/UE/Engine/Build/BatchFiles/RunUAT.bat')).toMatch(/^data:image\/png;/);
    expect(getIconPng).toHaveBeenLastCalledWith('C:\\UE\\Engine\\Binaries\\Win64\\UnrealEditor.exe');
    first.dispose();
    getIconPng.mockRejectedValueOnce(new Error('no icon'));
    const second = make();
    expect(await second.get('C:/UE/Engine/Build/BatchFiles/RunUAT.bat')).toMatch(/^data:image\/png;/);
    expect(getIconPng).toHaveBeenLastCalledWith('C:\\UE\\Engine\\Build\\BatchFiles\\RunUAT.bat');
    second.dispose();
  });

  it('asks macOS for the bundle icon only after its executable has been checked', async () => {
    const getIconPng = vi.fn(async (): Promise<Buffer | null> => PNG);
    const cache = createCommandAppIconResolver({
      platform: 'darwin', env: {}, knownDirs: [], realpath: async (file) => file,
      stat: async () => ({ isFile: () => true, mode: 0o755 }), getIconPng,
    });
    await cache.get('/UE/Engine/Build/BatchFiles/RunUAT.sh');
    expect(getIconPng).toHaveBeenCalledWith('/UE/Engine/Binaries/Mac/UnrealEditor.app');
    cache.dispose();
  });
});
