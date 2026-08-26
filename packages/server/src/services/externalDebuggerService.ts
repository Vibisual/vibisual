/**
 * §5.5 #17-20 ⑦ v4.74 — C층: 외부 디버거 위임.
 *
 * Windows 에서 언리얼 C++ 를 실제로 멈춰 세우는 디버그 엔진(`cppvsdbg`)은 Microsoft 전용이라
 * 우리가 실을 수 없다. **못 하는 것을 흉내 내지 않는다** — 설치돼 있는 Visual Studio·Rider·
 * VS Code 를 찾아 그 프로젝트를 열어 주는 버튼만 둔다.
 *
 * 탐지는 프로세스를 띄우지 않는 방법을 먼저 쓴다(설치 경로 훑기). `vswhere` 만은 예외로
 * 한 번 부르는데, Visual Studio 는 설치 위치가 자유라 경로 추측이 잘 빗나가기 때문이다.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ExternalDebuggerId, ExternalDebuggerInfo } from '@vibisual/shared';

import { logger } from '../logger.js';
import { resolveBinary } from './binLocator.js';
import { inspectUnrealProject } from './unrealProjectService.js';

/** 프로젝트 안에서 이만큼 깊이까지만 `.sln`/`.uproject` 를 찾는다(대형 저장소 폭주 방지). */
const TARGET_SCAN_DEPTH = 2;
/** 한 단계에서 훑을 엔트리 상한. */
const TARGET_SCAN_ENTRY_MAX = 400;
/** `vswhere` 응답을 기다리는 시간. */
const VSWHERE_TIMEOUT_MS = 4_000;

function exists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/** 프로젝트에서 특정 확장자 파일 하나를 얕게 찾는다(가장 얕은 것이 대개 정답). */
function findByExt(root: string, ext: string): string | null {
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(item.dir, { withFileTypes: true }).slice(0, TARGET_SCAN_ENTRY_MAX);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith(ext)) {
        return path.join(item.dir, entry.name);
      }
    }
    if (item.depth >= TARGET_SCAN_DEPTH) continue;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // 빌드 산출물·의존성 폴더는 볼 이유가 없다.
      if (/^(node_modules|\.git|Binaries|Intermediate|DerivedDataCache|Saved|obj|bin|target|dist|build)$/i.test(entry.name)) continue;
      queue.push({ dir: path.join(item.dir, entry.name), depth: item.depth + 1 });
    }
  }
  return null;
}

/** Visual Studio — `vswhere` 로 최신 설치본의 devenv.exe 를 얻는다(Windows 전용). */
function findVisualStudio(): string | null {
  if (process.platform !== 'win32') return null;
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const vswhere = path.join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (!exists(vswhere)) return null;
  try {
    const out = execFileSync(
      vswhere,
      ['-latest', '-prerelease', '-products', '*', '-property', 'productPath', '-format', 'value'],
      { encoding: 'utf8', timeout: VSWHERE_TIMEOUT_MS, windowsHide: true },
    ).trim();
    const first = out.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim();
    return first && exists(first) ? first : null;
  } catch {
    return null;
  }
}

/**
 * JetBrains Toolbox 가 채널별 폴더를 만드는 루트 + 그 안에서 실행본까지의 상대 경로.
 *
 * **왜 세 플랫폼 모두 훑어야 하는가**: JetBrains 가 지금 기본으로 미는 배포 창구가 Toolbox 다.
 * 종전엔 Windows 만 채널 폴더를 순회하고 mac/Linux 는 `/Applications/Rider.app`,
 * `/usr/local/bin/rider` 같은 **고정 경로 하나씩**만 봤다 — Toolbox 로 깐 사용자(대다수)는
 * 멀쩡히 설치돼 있는데도 화면에 "설치되어 있지 않음"이 뜬다.
 *
 * 레이아웃(실측):
 *  - win   `%LOCALAPPDATA%/JetBrains/Toolbox/apps/Rider/<채널>/bin/rider64.exe`
 *  - mac   `~/Library/Application Support/JetBrains/Toolbox/apps/Rider/<채널>/Rider.app/Contents/MacOS/rider`
 *  - linux `~/.local/share/JetBrains/Toolbox/apps/Rider/<채널>/bin/rider.sh`
 *
 * mac 이 한 겹 더 들어가는 이유는 채널 폴더 안에 `.app` **번들**이 통째로 놓이기 때문이다
 * (`.app` 은 폴더라 그 자리를 실행 파일로 spawn 할 수 없다 — `Contents/MacOS/rider` 까지 가야 한다).
 */
export function riderToolboxRoots(
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): { root: string; relatives: string[][] }[] {
  if (platform === 'win32') {
    const localAppData = env['LOCALAPPDATA'];
    if (!localAppData) return [];
    return [
      {
        root: path.join(localAppData, 'JetBrains', 'Toolbox', 'apps', 'Rider'),
        relatives: [['bin', 'rider64.exe']],
      },
    ];
  }
  if (platform === 'darwin') {
    return [
      {
        root: path.join(home, 'Library', 'Application Support', 'JetBrains', 'Toolbox', 'apps', 'Rider'),
        relatives: [
          ['Rider.app', 'Contents', 'MacOS', 'rider'],
          // Toolbox 판올림마다 채널 폴더 안 레이아웃이 달랐다 — 아래 두 깊이 스캔이 함께 받는다.
          ['bin', 'rider.sh'],
        ],
      },
    ];
  }
  return [
    {
      root: path.join(home, '.local', 'share', 'JetBrains', 'Toolbox', 'apps', 'Rider'),
      relatives: [['bin', 'rider.sh'], ['bin', 'rider']],
    },
  ];
}

/**
 * Toolbox 채널 폴더를 훑어 실행본 후보를 모은다.
 *
 * 채널 폴더(`ch-0`, `ch-1`, `Rider-2025.2` …) 아래에 실행본이 바로 있기도 하고, 버전 폴더가
 * **한 겹 더** 들어가기도 한다(Toolbox 판올림마다 달랐다). 두 깊이를 모두 본다 — 한 깊이만
 * 보면 그 시절 레이아웃을 쓰는 설치가 통째로 안 보인다.
 */
export function scanToolboxCandidates(
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const out: string[] = [];
  for (const { root, relatives } of riderToolboxRoots(platform, home, env)) {
    let channels: string[];
    try {
      channels = fs.readdirSync(root);
    } catch {
      continue; // Toolbox 미설치
    }
    for (const channel of channels) {
      const channelDir = path.join(root, channel);
      for (const rel of relatives) {
        const direct = path.join(channelDir, ...rel);
        if (exists(direct)) out.push(direct);
      }
      let versions: string[];
      try {
        versions = fs.readdirSync(channelDir);
      } catch {
        continue;
      }
      for (const version of versions) {
        for (const rel of relatives) {
          const nested = path.join(channelDir, version, ...rel);
          if (exists(nested)) out.push(nested);
        }
      }
    }
  }
  // 새 채널/버전 폴더가 사전순으로 뒤에 오므로 뒤집으면 대체로 최신이 앞에 선다.
  return out.sort().reverse();
}

/** JetBrains Rider — Toolbox 설치와 일반 설치 경로를 훑는다(세 플랫폼 모두 Toolbox 우선). */
function findRider(): string | null {
  const home = os.homedir();
  const candidates: string[] = [...scanToolboxCandidates()];
  if (process.platform === 'win32') {
    const localAppData = process.env['LOCALAPPDATA'] ?? '';
    const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    if (localAppData) candidates.push(path.join(localAppData, 'Programs', 'Rider', 'bin', 'rider64.exe'));
    candidates.push(path.join(programFiles, 'JetBrains', 'JetBrains Rider', 'bin', 'rider64.exe'));
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Rider.app/Contents/MacOS/rider',
      path.join(home, 'Applications', 'Rider.app', 'Contents', 'MacOS', 'rider'),
    );
  } else {
    candidates.push(
      '/opt/rider/bin/rider.sh',
      '/usr/local/bin/rider',
      '/snap/bin/rider',
      path.join(home, '.local', 'bin', 'rider'),
    );
  }
  // Toolbox 가 만드는 CLI 스크립트(사용자가 "Shell scripts" 를 켰을 때 생긴다).
  if (process.platform !== 'win32') {
    candidates.push(
      process.platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support', 'JetBrains', 'Toolbox', 'scripts', 'rider')
        : path.join(home, '.local', 'share', 'JetBrains', 'Toolbox', 'scripts', 'rider'),
    );
  }
  const known = candidates.find((c) => exists(c));
  if (known) return known;
  // Windows 는 PATH 폴백 ❌ — Toolbox 가 PATH 에 심는 `rider.cmd` 는 Node 18.20/20.12 이후
  //   `shell:true` 없이 spawn 하면 EINVAL 이다(CVE-2024-27980 대응). 아래 launch 는 직접 spawn 이다.
  if (process.platform === 'win32') return null;
  return resolveBinary('rider');
}

/**
 * VS Code — 알려진 설치 경로를 먼저 보고, 없으면 보강된 PATH 의 `code` 런처.
 *
 * mac 에서 `~/Applications` 설치(관리자 권한 없이 깐 경우)와 Linux 의 배포판 패키지 자리를
 * 종전엔 빼먹어서 "설치되어 있지 않음"이 떴다.
 */
function findVsCode(): string | null {
  const home = os.homedir();
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    const localAppData = process.env['LOCALAPPDATA'] ?? '';
    const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    if (localAppData) candidates.push(path.join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe'));
    candidates.push(path.join(programFiles, 'Microsoft VS Code', 'Code.exe'));
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
      path.join(home, 'Applications', 'Visual Studio Code.app', 'Contents', 'MacOS', 'Electron'),
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
    );
  } else {
    candidates.push('/usr/bin/code', '/usr/local/bin/code', '/snap/bin/code', '/usr/share/code/bin/code');
  }
  const known = candidates.find((c) => exists(c));
  if (known) return known;
  // Windows 는 PATH 폴백을 하지 않는다 — 거기서 잡히는 `code.cmd` 는 Node 18.20/20.12 이후
  //   `shell:true` 없이는 spawn 이 EINVAL 로 죽는다(CVE-2024-27980 대응). 아래 launch 는 직접 spawn 이다.
  if (process.platform === 'win32') return null;
  return resolveBinary('code');
}

/**
 * 언리얼 에디터 — **이 프로젝트가 쓰는 엔진**의 에디터.
 *
 * 예전에는 설치된 `UE_*` 폴더를 정렬해 **최신 하나**를 골랐다. 그건 프로젝트가 어느 엔진에
 * 묶여 있는지 묻지 않은 것이라, 5.3 프로젝트를 5.8 로 여는 사고가 난다(에셋이 상향 변환되고
 * 되돌릴 수 없다). 이제 `.uproject` 의 `EngineAssociation` 을 해석하는 한 곳에 위임한다 —
 * 못 찾으면 최신으로 때우지 않고 **없다고 답한다**.
 */
function findUnrealEditor(projectPath: string): string | null {
  return inspectUnrealProject(projectPath)?.editorExe ?? null;
}

/**
 * 이 프로젝트에서 쓸 수 있는 외부 디버거 목록.
 *
 * `available=false` 인 항목도 **지우지 않고 함께 돌려준다** — 화면이 "설치되어 있지 않음" 을
 * 그 자리에 적어야 사용자가 "왜 Rider 버튼이 없지?" 로 헤매지 않는다.
 */
export function listExternalDebuggers(projectPath: string): ExternalDebuggerInfo[] {
  const sln = projectPath ? findByExt(projectPath, '.sln') : null;
  const uproject = projectPath ? findByExt(projectPath, '.uproject') : null;

  const vs = findVisualStudio();
  const rider = findRider();
  const code = findVsCode();
  const unreal = uproject ? findUnrealEditor(projectPath) : null;

  const out: ExternalDebuggerInfo[] = [
    {
      id: 'visual-studio',
      name: 'Visual Studio',
      available: !!vs,
      ...(vs ? { execPath: vs } : {}),
      ...(sln ? { target: sln, reason: path.basename(sln) } : {}),
    },
    {
      id: 'rider',
      name: 'JetBrains Rider',
      available: !!rider,
      ...(rider ? { execPath: rider } : {}),
      ...(uproject ?? sln ? { target: (uproject ?? sln) as string, reason: path.basename((uproject ?? sln) as string) } : {}),
    },
    {
      id: 'vscode',
      name: 'Visual Studio Code',
      available: !!code,
      ...(code ? { execPath: code } : {}),
      ...(projectPath ? { target: projectPath } : {}),
    },
  ];

  // 언리얼 에디터는 `.uproject` 가 있는 프로젝트에서만 목록에 낸다(없으면 열 대상이 없다).
  if (uproject) {
    out.push({
      id: 'unreal-editor',
      name: 'Unreal Editor',
      available: !!unreal,
      ...(unreal ? { execPath: unreal } : {}),
      target: uproject,
      reason: path.basename(uproject),
    });
  }

  return out;
}

/**
 * 고른 외부 도구로 대상을 연다. 우리 프로세스에 매달지 않는다(detached) — 사용자가 Vibisual 을
 * 껐다고 해서 열어 둔 Visual Studio 가 함께 죽으면 안 된다.
 */
export function launchExternalDebugger(
  id: ExternalDebuggerId,
  projectPath: string,
): { ok: boolean; error?: string } {
  const info = listExternalDebuggers(projectPath).find((d) => d.id === id);
  if (!info) return { ok: false, error: 'unknown debugger' };
  if (!info.available || !info.execPath) return { ok: false, error: 'not installed' };

  const target = info.target ?? projectPath;
  try {
    const child = spawn(info.execPath, [target], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      cwd: projectPath || undefined,
    });
    child.unref();
    logger.info(`[external-debugger] launched ${id}: ${path.basename(target)}`);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[external-debugger] launch failed (${id}): ${message}`);
    return { ok: false, error: message };
  }
}
