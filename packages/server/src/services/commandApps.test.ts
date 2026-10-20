import { describe, expect, it } from 'vitest';
import { COMMAND_ACTIVITY_LIMITS, detectCommandApps } from '@vibisual/shared';

const windows = { cwd: 'C:/Work/Game', platform: 'win32' } as const;
const linux = { cwd: '/work/game', platform: 'linux' } as const;

describe('command app detection', () => {
  it('keeps Windows paths intact and resolves an actual uproject argument', () => {
    const result = detectCommandApps(String.raw`& "C:\Program Files\Epic Games\UE_5.5\Engine\Binaries\Win64\UnrealEditor-Cmd.exe" "C:\Work\Game\Game.uproject" -run=ResavePackages`, windows);
    expect(result).toEqual([expect.objectContaining({
      name: 'Unreal Engine', detection: 'command',
      executable: 'C:/Program Files/Epic Games/UE_5.5/Engine/Binaries/Win64/UnrealEditor-Cmd.exe',
      projectPath: 'C:/Work/Game/Game.uproject',
    })]);
  });

  it('unwraps cmd /d /s /c with Windows double outer quotes', () => {
    const result = detectCommandApps(String.raw`cmd.exe /d /s /c ""C:\Program Files\Blender Foundation\Blender\blender.exe" -b "C:\Work\scene.blend""`, windows);
    expect(result).toEqual([expect.objectContaining({
      name: 'Blender', executable: 'C:/Program Files/Blender Foundation/Blender/blender.exe',
    })]);
    expect(detectCommandApps(String.raw`cmd /c "C:\Program Files\Blender\blender.exe"`, windows)[0])
      .toMatchObject({ name: 'Blender', executable: 'C:/Program Files/Blender/blender.exe' });
  });

  it('unwraps powershell -Command and its invocation operator', () => {
    const result = detectCommandApps(String.raw`powershell.exe -NoProfile -Command "& 'C:\Apps\blender.exe' -b 'C:\Work\scene.blend'"`, windows);
    expect(result).toEqual([expect.objectContaining({ name: 'Blender', executable: 'C:/Apps/blender.exe' })]);
  });

  it('unwraps nested shells and env assignments without treating shell arguments as code', () => {
    expect(detectCommandApps(`bash -lc 'env CI=1 blender -b scene.blend && git status' ignored python`, windows)
      .map((target) => target.name)).toEqual(['Blender', 'Git']);
    expect(detectCommandApps(`pwsh -Command 'bash -lc "node build.js"'`, windows)
      .map((target) => target.name)).toEqual(['Node.js']);
  });

  it('handles POSIX escaped spaces and platform-aware paths', () => {
    expect(detectCommandApps(String.raw`/opt/Blender\ Foundation/blender -b scene.blend`, linux))
      .toEqual([expect.objectContaining({ executable: '/opt/Blender Foundation/blender', name: 'Blender' })]);
    expect(detectCommandApps('/Applications/Blender.app/Contents/MacOS/Blender -b scene.blend', { platform: 'darwin' }))
      .toEqual([expect.objectContaining({ name: 'Blender', executable: '/Applications/Blender.app/Contents/MacOS/Blender' })]);
  });

  it('grounds ambiguous Unreal build script names in the engine path or project argument', () => {
    expect(detectCommandApps(String.raw`C:\UE\Engine\Build\BatchFiles\RunUAT.bat BuildCookRun -project="C:\Work\Game\Game.uproject"`, windows))
      .toEqual([expect.objectContaining({ name: 'Unreal Engine', projectPath: 'C:/Work/Game/Game.uproject' })]);
    expect(detectCommandApps('Build.bat -project=Game.uproject', windows)[0]?.name).toBe('Unreal Engine');
    expect(detectCommandApps('Build.bat unrelated', windows)[0]?.name).toBe('Build');
    expect(detectCommandApps('RunUAT.bat unrelated', windows)[0]?.name).toBe('RunUAT');
    expect(detectCommandApps('RunUAT unrelated', windows)).toEqual([]);
  });

  it.each(['UnrealEditor', 'UnrealEditor-Cmd', 'UE4Editor', 'UE4Editor-Cmd', 'UnrealBuildTool'])(
    'recognizes the actual %s executable without requiring installation lookup', (executable) => {
      expect(detectCommandApps(`${executable} -version`, windows)[0])
        .toMatchObject({ name: 'Unreal Engine', executable, detection: 'command' });
    },
  );

  it('groups editor and UAT commands for one engine/project but separates engine versions and projects', () => {
    const target = (command: string): string | undefined => detectCommandApps(command, windows)[0]?.id;
    const editor = target('C:/UE_5.5/Engine/Binaries/Win64/UnrealEditor.exe Game.uproject');
    expect(editor).toBe(target('C:/UE_5.5/Engine/Build/BatchFiles/RunUAT.bat -project=Game.uproject'));
    expect(editor).not.toBe(target('C:/UE_5.6/Engine/Binaries/Win64/UnrealEditor.exe Game.uproject'));
    expect(editor).not.toBe(target('C:/UE_5.5/Engine/Binaries/Win64/UnrealEditor.exe Other.uproject'));
    expect(editor).toBe(target('c:/ue_5.5/engine/binaries/win64/unrealeditor.EXE game.UPROJECT'));
  });

  it('recognizes Unreal managed tools only in dotnet executable-argument position with an engine path', () => {
    const editor = detectCommandApps('C:/UE/Engine/Binaries/Win64/UnrealEditor.exe Game.uproject', windows)[0];
    const managed = detectCommandApps('dotnet C:/UE/Engine/Binaries/DotNET/AutomationTool/AutomationTool.dll -project=Game.uproject', windows)[0];
    expect(managed).toMatchObject({
      name: 'Unreal Engine', executable: 'dotnet', id: editor?.id,
      iconSource: 'C:/UE/Engine/Binaries/DotNET/AutomationTool/AutomationTool.dll',
    });
    expect(detectCommandApps('dotnet exec C:/UE/Engine/Binaries/DotNET/UnrealBuildTool/UnrealBuildTool.dll Game.uproject', windows)[0]?.id)
      .toBe(editor?.id);
    expect(detectCommandApps('dotnet ./tools/AutomationTool.dll', windows)[0]?.name).toBe('.NET');
    expect(detectCommandApps('dotnet ./tools/AutomationTool.dll', windows)[0]?.iconSource).toBeUndefined();
    expect(detectCommandApps('dotnet run -- C:/UE/Engine/Binaries/DotNET/AutomationTool.dll', windows)[0]?.name).toBe('.NET');
  });

  it('preserves case-sensitive application identities on Linux', () => {
    const upper = detectCommandApps('/opt/Tools/tool.exe', linux)[0];
    const lower = detectCommandApps('/opt/tools/tool.exe', linux)[0];
    expect(upper?.id).not.toBe(lower?.id);
    expect(detectCommandApps('/opt/Tools/tool.exe', { ...linux, platform: 'darwin' })[0]?.id)
      .toBe(detectCommandApps('/opt/tools/tool.exe', { ...linux, platform: 'darwin' })[0]?.id);
  });

  it('resolves relative executables against cwd and an explicit preceding cd', () => {
    expect(detectCommandApps(String.raw`cd /d C:\Tools && .\bin\tool.exe`, windows)[0]?.executable)
      .toBe('C:/Tools/bin/tool.exe');
    expect(detectCommandApps('cd ../Tools && ./bin/tool.exe', linux)[0]?.executable).toBe('/work/Tools/bin/tool.exe');
    expect(detectCommandApps('./tool.exe')).toEqual([]);
    expect(detectCommandApps('cd $UNKNOWN; ./tool.exe', linux)).toEqual([]);
    expect(detectCommandApps(String.raw`\\server\share\tools\tool.exe`, windows)[0]?.executable)
      .toBe('//server/share/tools/tool.exe');
  });

  it('resolves Windows root-relative backslashes against the current drive or UNC share', () => {
    expect(detectCommandApps(String.raw`\Apps\blender.exe`, windows)[0]?.executable).toBe('C:/Apps/blender.exe');
    expect(detectCommandApps(String.raw`\Apps\blender.exe`, windows)[0]?.id)
      .toBe(detectCommandApps('C:/Apps/blender.exe', windows)[0]?.id);
    expect(detectCommandApps(String.raw`cmd /c "cd /d D:\Tools && \Apps\blender.exe"`, windows)[0]?.executable)
      .toBe('D:/Apps/blender.exe');
    expect(detectCommandApps(String.raw`\Apps\blender.exe`, { cwd: '//server/share/work', platform: 'win32' })[0]?.executable)
      .toBe('//server/share/Apps/blender.exe');
    expect(detectCommandApps(String.raw`\Apps\blender.exe`, { platform: 'win32' })).toEqual([]);
  });

  it('does not carry pipeline or background directory changes into the parent shell', () => {
    expect(detectCommandApps('cd /tmp/tools | ./blender', linux)[0]?.executable).toBe('/work/game/blender');
    expect(detectCommandApps('cd /tmp/tools | echo finished; ./blender', linux)[0]?.executable).toBe('/work/game/blender');
    expect(detectCommandApps('cd /tmp/tools & ./blender', linux)[0]?.executable).toBe('/work/game/blender');
    expect(detectCommandApps('cd /tmp/tools && ./blender & ./blender', linux).map((app) => app.executable))
      .toEqual(['/tmp/tools/blender', '/work/game/blender']);
    expect(detectCommandApps(`bash -c 'cd /tmp/tools && ./blender' && ./blender`, linux).map((app) => app.executable))
      .toEqual(['/tmp/tools/blender', '/work/game/blender']);
  });

  it('uses the original cwd on a failed cd and drops ambiguous relative-path guesses', () => {
    expect(detectCommandApps('cd /tmp/tools || ./blender', linux)[0]?.executable).toBe('/work/game/blender');
    expect(detectCommandApps('cd /tmp/tools; ./blender', linux)).toEqual([]);
    expect(detectCommandApps('cd /tmp/tools && false || ./blender', linux)).toEqual([]);
    expect(detectCommandApps('cd /tmp/tools && true && ./blender', linux)[0]?.executable).toBe('/tmp/tools/blender');
    expect(detectCommandApps('cd /tmp/tools; /opt/blender -b', linux)[0]?.executable).toBe('/opt/blender');
  });

  it('restores only locally observed directory-stack frames', () => {
    expect(detectCommandApps('pushd /tmp/tools && popd && ./blender', linux)[0]?.executable).toBe('/work/game/blender');
    expect(detectCommandApps('pushd /tmp/tools && pushd /opt/tools && popd && ./blender', linux)[0]?.executable)
      .toBe('/tmp/tools/blender');
    expect(detectCommandApps('popd && ./blender', linux)).toEqual([]);
    expect(detectCommandApps('pushd /tmp/tools; popd; ./blender', linux)).toEqual([]);
    expect(detectCommandApps('Push-Location C:/Tools && Pop-Location && ./blender.exe', windows)[0]?.executable)
      .toBe('C:/Work/Game/blender.exe');
  });

  it('bounds ambiguous cwd states and directory stacks while retaining independently identifiable apps', () => {
    const ambiguous = Array.from({ length: 20 }, (_, i) => `cd /possible-${i}`).join('; ');
    expect(detectCommandApps(`${ambiguous}; ./blender; python check.py; /opt/blender`, linux).map((app) => app.executable))
      .toEqual(['python', '/opt/blender']);
    const deepStack = Array.from({ length: 12 }, (_, i) => `pushd /level-${i}`).join(' && ');
    expect(detectCommandApps(`${deepStack} && ${'popd && '.repeat(12)}./blender`, linux)).toEqual([]);
  });

  it('normalizes MSYS drive paths only on Windows', () => {
    expect(detectCommandApps('/c/Apps/blender.exe', windows)[0]?.executable).toBe('c:/Apps/blender.exe');
    expect(detectCommandApps('/c/Apps/blender.exe', linux)[0]?.executable).toBe('/c/Apps/blender.exe');
  });

  it('recognizes Start-Process and cmd START executable positions', () => {
    expect(detectCommandApps(String.raw`Start-Process -FilePath .\blender.exe -WorkingDirectory C:\Apps`, windows)[0])
      .toMatchObject({ name: 'Blender', executable: 'C:/Apps/blender.exe' });
    expect(detectCommandApps(String.raw`cmd /c start "build window" /wait "C:\Apps\blender.exe" -b scene.blend`, windows)[0])
      .toMatchObject({ name: 'Blender', executable: 'C:/Apps/blender.exe' });
  });

  it('provides generic application names for explicit executable filenames and familiar CLIs', () => {
    expect(detectCommandApps('./Tools/CustomTool.exe --build', windows)[0])
      .toMatchObject({ name: 'CustomTool', executable: 'C:/Work/Game/Tools/CustomTool.exe' });
    expect(detectCommandApps('python3.12 script.py | node worker.js && git status', linux)
      .map((target) => target.name)).toEqual(['Python', 'Node.js', 'Git']);
  });

  it('never promotes program names in echo output, search patterns, file utility arguments or comments', () => {
    expect(detectCommandApps([
      'echo "UnrealEditor.exe && blender"',
      'rg "RunUAT.bat|Blender.exe" src',
      'cat Blender.exe',
      '# blender && node build.js',
      'echo okay # UnrealEditor.exe; python script.py',
      'Get-Content C:/Apps/blender.exe',
    ].join('\n'), windows)).toEqual([]);
  });

  it('ignores heredoc data even when it contains unmatched quotes or apparent pipelines', () => {
    const command = [
      "cat <<'EOF' > instructions.txt",
      'blender -b scene.blend && UnrealEditor.exe Game.uproject',
      'unmatched " ; node worker.js',
      'EOF',
      'git status',
    ].join('\n');
    expect(detectCommandApps(command, linux).map((target) => target.name)).toEqual(['Git']);
  });

  it('keeps the actual interpreter while ignoring multiple heredoc bodies and tab-indented delimiters', () => {
    const command = ['python - <<-PY <<DATA', '\tblender', '\tPY', 'node worker.js', 'DATA', 'git status'].join('\n');
    expect(detectCommandApps(command, linux).map((target) => target.name)).toEqual(['Python', 'Git']);
  });

  it('ignores PowerShell here-strings and block comments', () => {
    const command = ["$text = @'", 'blender && node build.js', "'@", '<# UnrealEditor.exe; python #>', 'git status'].join('\n');
    expect(detectCommandApps(command, windows).map((target) => target.name)).toEqual(['Git']);
  });

  it('does not treat quoted separators, redirection destinations or script text as apps', () => {
    expect(detectCommandApps('echo "hello |" blender > Node.exe', windows)).toEqual([]);
    expect(detectCommandApps(`python -c 'print("blender && UnrealEditor.exe")'`, linux)
      .map((target) => target.name)).toEqual(['Python']);
    expect(detectCommandApps('echo $(printf "hello; blender")', linux)).toEqual([]);
    expect(detectCommandApps('function render() { blender; }; echo skipped', linux)).toEqual([]);
    expect(detectCommandApps('Build.bat > Game.uproject', windows)[0]?.name).toBe('Build');
    expect(detectCommandApps('Build.bat -log=Game.uproject', windows)[0]?.name).toBe('Build');
  });

  it('keeps only supported, literal executable identities', () => {
    expect(detectCommandApps('$APP -b scene.blend', windows)).toEqual([]);
    expect(detectCommandApps('%TOOLS%/blender.exe -b scene.blend', windows)).toEqual([]);
    expect(detectCommandApps('mysterycli do-something', windows)).toEqual([]);
    expect(detectCommandApps('powershell -EncodedCommand QmxldmVy', windows)).toEqual([]);
    expect(detectCommandApps('"C:/Apps/blender.exe', windows)).toEqual([]);
  });

  it('deduplicates repeated targets and bounds the number of apps per command', () => {
    const result = detectCommandApps('blender -b a.blend; blender -b b.blend; git status; node build.js; python check.py; docker ps', windows);
    expect(result.map((target) => target.name)).toEqual(['Blender', 'Git', 'Node.js', 'Python']);
    expect(result).toHaveLength(COMMAND_ACTIVITY_LIMITS.targetsPerCommand);
  });

  it('bounds input size, segment count, token count and wrapper recursion', () => {
    expect(detectCommandApps(`blender ${'x'.repeat(65_536)}`, windows)).toEqual([]);
    expect(detectCommandApps(`${'echo ignored;'.repeat(128)}blender`, windows)).toEqual([]);
    expect(detectCommandApps(`blender ${'arg '.repeat(256)}`, windows)).toEqual([]);
    expect(detectCommandApps(`${'cmd /c '.repeat(6)}blender`, windows)).toEqual([]);
    expect(detectCommandApps(`${'cmd /c '.repeat(4)}blender`, windows)[0]?.name).toBe('Blender');
  });
});
