import { posix, win32 } from 'node:path';
import { normalizeCommandExecutable } from './commandAppExecutable';

export interface IconCandidate {
  executable: string;
  /** macOS bundle that must contain the verified executable. */
  bundle?: string;
  /** Icon image in the same engine installation, read once the executable is verified (Linux). */
  iconFile?: string;
}

/** Two grounded Unreal siblings at most; ordinary commands retain their own executable icon. */
export function commandAppIconCandidates(input: string, platform: NodeJS.Platform): IconCandidate[] {
  const executable = normalizeCommandExecutable(input, platform);
  if (!executable) return [];
  const p = platform === 'win32' ? win32 : posix;
  const result: IconCandidate[] = [];
  const normalized = executable.replace(/\\/g, '/');
  // Only known launcher positions inside an explicit engine tree. A script named RunUAT
  // elsewhere, a project argument, or plain `dotnet` cannot imply an installed engine.
  const engine = p.isAbsolute(executable) ? normalized.match(/^(.*\/Engine)\/(?:Build\/BatchFiles\/(?:(?:Mac|Linux)\/)?(?:RunUAT|Build)\.(?:bat|sh)|Binaries\/(?:Win64|Linux|Mac)\/(?:UnrealEditor|UE4Editor)-Cmd(?:\.exe)?|Binaries\/DotNET\/(?:(?:AutomationTool|UnrealBuildTool)\/)?(?:AutomationTool|UnrealBuildTool)\.dll)$/i)?.[1] : undefined;
  if (engine) {
    for (const name of ['UnrealEditor', 'UE4Editor']) {
      if (platform === 'darwin') {
        const bundle = p.join(engine, 'Binaries', 'Mac', `${name}.app`);
        result.push({ executable: p.join(bundle, 'Contents', 'MacOS', name), bundle });
      } else if (platform === 'win32') {
        result.push({ executable: p.join(engine, 'Binaries', 'Win64', `${name}.exe`) });
      } else {
        // Linux editors are plain ELF files without an embedded icon; the engine ships its desktop icon.
        result.push({
          executable: p.join(engine, 'Binaries', 'Linux', name),
          iconFile: p.join(engine, 'Source', 'Runtime', 'Launch', 'Resources', 'Linux', name === 'UnrealEditor' ? 'UnrealEngine.png' : 'UE4.png'),
        });
      }
    }
  }
  // An assembly is only an installation hint: it is not itself the executed app.
  if (!engine || !/\.dll$/i.test(executable)) result.push({ executable });
  return result;
}
