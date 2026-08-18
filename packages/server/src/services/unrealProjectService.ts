/**
 * §5.5 #17-20 ② ③ ⑦ — 언리얼 프로젝트 해석기.
 *
 * "이 프로젝트는 **어느 엔진으로** 여는가" 하나만 답하는 모듈이다. 이 질문에 잘못 답하면
 * 나머지가 전부 틀린다 — 5.3 프로젝트를 5.8 에디터로 열면 에셋이 상향 변환되며 되돌릴 수
 * 없고, 소스 빌드 프로젝트를 런처 설치본으로 열면 모듈 버전이 어긋나 아예 뜨지 않는다.
 *
 * 그래서 **설치된 엔진 중 최신을 고르지 않는다.** `.uproject` 의 `EngineAssociation` 이
 * 유일한 진실이고, 그 값이 가리키는 곳을 찾는 방법이 세 갈래다:
 *
 *   1. `"5.8"` 같은 버전 문자열 → 런처 설치본. 레지스트리 `HKLM\SOFTWARE\EpicGames\Unreal
 *      Engine\<ver>\InstalledDirectory` → 런처 매니페스트 → 관례 경로 순으로 찾는다.
 *   2. `"{GUID}"` → 사용자가 직접 빌드한 엔진. 레지스트리 `HKCU\SOFTWARE\Epic Games\Unreal
 *      Engine\Builds` 의 **값 이름이 그 GUID** 이고 값이 엔진 경로다.
 *   3. `""`(빈 문자열) → 프로젝트가 엔진 트리 안에 있다(`Engine/` 을 위로 거슬러 찾는다).
 *
 * 디스크·레지스트리가 SSOT 라 상태를 들지 않는다(체크포인트·broadcast 미관여).
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { logger } from '../logger.js';

/** `.uproject` 를 이만큼 깊이까지만 찾는다(대형 저장소에서 폭주하지 않게). */
const UPROJECT_SCAN_DEPTH = 2;
/** 한 단계에서 훑을 엔트리 상한. */
const SCAN_ENTRY_MAX = 400;
/** 레지스트리·프로세스 조회를 기다리는 시간. */
const PROBE_TIMEOUT_MS = 4_000;
/** `.uproject` 가 이보다 크면 읽지 않는다(설정 파일이 이만큼 클 리 없다). */
const UPROJECT_MAX_BYTES = 512 * 1024;

/** 엔진 루트를 **어떻게** 찾았는지 — 화면 근거 한 줄에 그대로 실린다. */
export type UnrealEngineSource =
  | 'registry-installed'
  | 'registry-source-build'
  | 'launcher-manifest'
  | 'conventional-path'
  | 'in-engine-tree'
  | 'not-found';

export interface UnrealProjectInfo {
  /** `.uproject` 절대 경로. */
  uprojectPath: string;
  /** 프로젝트 이름(= 파일명에서 확장자 뺀 것). 빌드 타깃 이름의 뿌리가 된다. */
  projectName: string;
  /** `.uproject` 에 적힌 `EngineAssociation` 원문(빈 문자열이면 엔진 트리 내장). */
  engineAssociation: string;
  /** 해석된 엔진 루트(`…/UE_5.8`). 못 찾으면 null. */
  engineRoot: string | null;
  /** 위 엔진 루트를 어떤 방법으로 찾았는지. */
  engineSource: UnrealEngineSource;
  /** 사람이 읽는 엔진 버전 표기(`5.8`, `소스 빌드 {GUID}` 등). */
  engineLabel: string;
  /** 에디터 실행 파일 절대 경로. 못 찾으면 null. */
  editorExe: string | null;
  /** `Build.bat`(또는 `Build.sh`) 절대 경로. 못 찾으면 null. */
  buildScript: string | null;
}

function exists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/** 프로젝트에서 `.uproject` 를 얕게 찾는다 — 가장 얕은 것이 대개 정답. */
export function findUProject(root: string): string | null {
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(item.dir, { withFileTypes: true }).slice(0, SCAN_ENTRY_MAX);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.uproject')) {
        return path.join(item.dir, entry.name);
      }
    }
    if (item.depth >= UPROJECT_SCAN_DEPTH) continue;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // 빌드 산출물·엔진 캐시는 볼 이유가 없다.
      if (/^(node_modules|\.git|Binaries|Intermediate|DerivedDataCache|Saved|obj|bin)$/i.test(entry.name)) continue;
      queue.push({ dir: path.join(item.dir, entry.name), depth: item.depth + 1 });
    }
  }
  return null;
}

/** 레지스트리 값 하나를 읽는다(Windows 전용, 실패는 전부 null). */
function regQuery(keyPath: string, valueName: string): string | null {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('reg', ['query', keyPath, '/v', valueName], {
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
      // 없는 키는 정상적인 답("이 엔진은 여기 없다")이지 오류가 아니다 — stderr 로 새어 나가면
      // 콘솔이 붉은 줄로 덮인다. 판정은 예외로 하고 메시지는 버린다.
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    // `    InstalledDirectory    REG_SZ    C:\Program Files\Epic Games\UE_5.8`
    const line = out.split(/\r?\n/).find((l) => l.includes('REG_'));
    if (!line) return null;
    const value = line.split(/REG_[A-Z_]+\s+/)[1]?.trim();
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * 런처 매니페스트에서 버전에 맞는 설치 경로를 찾는다.
 * 레지스트리가 지워진 설치본(수동 이동·다중 계정)에서 마지막으로 기대는 자리다.
 */
function findInLauncherManifest(version: string): string | null {
  const candidates =
    process.platform === 'win32'
      ? ['C:\\ProgramData\\Epic\\UnrealEngineLauncher\\LauncherInstalled.dat']
      : ['/Users/Shared/Epic Games/UnrealEngineLauncher/LauncherInstalled.dat']; // privacy-ok — 공용 설치 경로
  for (const file of candidates) {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      const list = (parsed as { InstallationList?: unknown }).InstallationList;
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        const rec = entry as { AppName?: unknown; InstallLocation?: unknown };
        const appName = typeof rec.AppName === 'string' ? rec.AppName : '';
        const location = typeof rec.InstallLocation === 'string' ? rec.InstallLocation : '';
        if (!location) continue;
        // AppName 은 `UE_5.8` 형태 — 버전이 정확히 일치할 때만 쓴다(4.27 을 4.2 로 오인하지 않게).
        if (appName === `UE_${version}` && exists(location)) return location;
      }
    } catch {
      /* 매니페스트 없음 */
    }
  }
  return null;
}

/** `Engine/Binaries` 를 가진 조상을 찾는다 — 엔진 트리 안에 있는 프로젝트(association 이 빈 경우). */
function findEnclosingEngineRoot(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 6; i += 1) {
    if (exists(path.join(dir, 'Engine', 'Binaries'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * `EngineAssociation` → 엔진 루트. **설치된 것 중 최신을 고르는 폴백은 두지 않는다** —
 * 못 찾았으면 못 찾았다고 말해야 사용자가 엔진을 지정하지, 엉뚱한 버전으로 열려서는 안 된다.
 */
export function resolveEngineRoot(
  association: string,
  uprojectPath: string,
): { root: string | null; source: UnrealEngineSource } {
  const assoc = association.trim();

  // 3 — 빈 값이면 엔진 트리 내장 프로젝트다.
  if (assoc.length === 0) {
    const root = findEnclosingEngineRoot(path.dirname(uprojectPath));
    return root ? { root, source: 'in-engine-tree' } : { root: null, source: 'not-found' };
  }

  // 2 — GUID(소스 빌드). 값 **이름**이 GUID 이고 값이 경로다.
  if (/^\{?[0-9A-Fa-f-]{36}\}?$/.test(assoc)) {
    for (const hive of ['HKCU', 'HKLM']) {
      const found = regQuery(`${hive}\\SOFTWARE\\Epic Games\\Unreal Engine\\Builds`, assoc);
      if (found && exists(found)) return { root: found, source: 'registry-source-build' };
    }
    return { root: null, source: 'not-found' };
  }

  // 1 — 버전 문자열(런처 설치본).
  if (/^\d+(\.\d+)+$/.test(assoc)) {
    const installed = regQuery(`HKLM\\SOFTWARE\\EpicGames\\Unreal Engine\\${assoc}`, 'InstalledDirectory');
    if (installed && exists(installed)) return { root: installed, source: 'registry-installed' };

    const fromManifest = findInLauncherManifest(assoc);
    if (fromManifest) return { root: fromManifest, source: 'launcher-manifest' };

    const conventional =
      process.platform === 'win32'
        ? [
            path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Epic Games', `UE_${assoc}`),
            `C:\\Program Files\\Epic Games\\UE_${assoc}`,
          ]
        : process.platform === 'darwin'
          ? [path.join('/Users/Shared/Epic Games', `UE_${assoc}`)] // privacy-ok — 공용 설치 경로
          : [path.join('/opt/UnrealEngine', `UE_${assoc}`)];
    for (const c of conventional) {
      if (exists(c)) return { root: c, source: 'conventional-path' };
    }
    return { root: null, source: 'not-found' };
  }

  // 그 외(상대 경로를 적어 둔 드문 경우) — 프로젝트 기준으로 풀어 본다.
  const asPath = path.resolve(path.dirname(uprojectPath), assoc);
  if (exists(path.join(asPath, 'Engine', 'Binaries'))) return { root: asPath, source: 'conventional-path' };
  return { root: null, source: 'not-found' };
}

/** 엔진 루트 → 에디터 실행 파일. 5.x 는 `UnrealEditor`, 4.x 는 `UE4Editor`. */
export function findEditorExe(engineRoot: string): string | null {
  const binDir =
    process.platform === 'win32'
      ? path.join(engineRoot, 'Engine', 'Binaries', 'Win64')
      : process.platform === 'darwin'
        ? path.join(engineRoot, 'Engine', 'Binaries', 'Mac')
        : path.join(engineRoot, 'Engine', 'Binaries', 'Linux');

  const candidates =
    process.platform === 'win32'
      ? [path.join(binDir, 'UnrealEditor.exe'), path.join(binDir, 'UE4Editor.exe')]
      : process.platform === 'darwin'
        ? [
            path.join(binDir, 'UnrealEditor.app', 'Contents', 'MacOS', 'UnrealEditor'),
            path.join(binDir, 'UE4Editor.app', 'Contents', 'MacOS', 'UE4Editor'),
          ]
        : [path.join(binDir, 'UnrealEditor'), path.join(binDir, 'UE4Editor')];

  return candidates.find((c) => exists(c)) ?? null;
}

/** 엔진 루트 → 빌드 스크립트(에디터 타깃을 컴파일하는 자리). */
export function findBuildScript(engineRoot: string): string | null {
  const batchDir = path.join(engineRoot, 'Engine', 'Build', 'BatchFiles');
  const candidates =
    process.platform === 'win32'
      ? [path.join(batchDir, 'Build.bat')]
      : process.platform === 'darwin'
        ? [path.join(batchDir, 'Mac', 'Build.sh'), path.join(batchDir, 'Build.sh')]
        : [path.join(batchDir, 'Linux', 'Build.sh'), path.join(batchDir, 'Build.sh')];
  return candidates.find((c) => exists(c)) ?? null;
}

/**
 * 엔진 표기 — 근거 줄(`reason`)에 그대로 실린다.
 *
 * 번역하지 않는다. 이 자리는 `.vscode/launch.json › Launch Server` 처럼 **기계가 읽은 것을
 * 그대로 보여 주는 기술 흔적**이라 로케일마다 달라지면 오히려 대조가 어려워진다.
 */
function engineLabelOf(association: string, source: UnrealEngineSource): string {
  const assoc = association.trim();
  if (source === 'registry-source-build') return `source build ${assoc}`;
  if (source === 'in-engine-tree') return 'in-engine-tree';
  return assoc.length > 0 ? assoc : 'unknown';
}

/**
 * 이 프로젝트의 언리얼 정보 전부. `.uproject` 가 없으면 null(= 언리얼 프로젝트가 아니다).
 *
 * 엔진을 못 찾아도 **null 을 돌려주지 않는다** — 언리얼 프로젝트인 것은 맞으므로 그 사실과
 * "엔진을 못 찾았다"를 함께 전해야 화면이 이유를 적을 수 있다.
 */
export function inspectUnrealProject(projectRoot: string): UnrealProjectInfo | null {
  if (!projectRoot) return null;
  const uprojectPath = findUProject(projectRoot);
  if (!uprojectPath) return null;

  let engineAssociation = '';
  try {
    const stat = fs.statSync(uprojectPath);
    if (stat.isFile() && stat.size <= UPROJECT_MAX_BYTES) {
      const parsed: unknown = JSON.parse(fs.readFileSync(uprojectPath, 'utf8'));
      const value = (parsed as { EngineAssociation?: unknown }).EngineAssociation;
      if (typeof value === 'string') engineAssociation = value;
    }
  } catch {
    // 읽기·파싱 실패는 association 을 빈 값으로 두고 계속 — 엔진 트리 탐색이 아직 남았다.
  }

  const { root, source } = resolveEngineRoot(engineAssociation, uprojectPath);
  return {
    uprojectPath,
    projectName: path.basename(uprojectPath, path.extname(uprojectPath)),
    engineAssociation,
    engineRoot: root,
    engineSource: source,
    engineLabel: engineLabelOf(engineAssociation, source),
    editorExe: root ? findEditorExe(root) : null,
    buildScript: root ? findBuildScript(root) : null,
  };
}

// ─── 디버거 붙이기 ──────────────────────────────────────────────────────────

/**
 * 지금 이 `.uproject` 를 열고 있는 에디터 프로세스의 pid.
 *
 * 우리는 에디터를 PTY 로 띄우므로 손에 쥔 pid 는 셸의 것이지 에디터의 것이 아니다. 그래서
 * **명령줄에 이 uproject 경로를 가진 에디터 프로세스**를 찾아 그 pid 를 쓴다(다른 프로젝트를
 * 함께 열어 둔 경우에도 엉뚱한 창에 붙지 않게).
 */
export function findRunningEditorPid(uprojectPath: string): number | null {
  if (process.platform !== 'win32') return null;
  const target = path.basename(uprojectPath).toLowerCase();
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='UnrealEditor.exe' OR Name='UE4Editor.exe'\" | " +
          'Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress',
      ],
      { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS, windowsHide: true },
    ).trim();
    if (!out) return null;
    const parsed: unknown = JSON.parse(out);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    for (const row of rows) {
      const rec = row as { ProcessId?: unknown; CommandLine?: unknown };
      const pid = typeof rec.ProcessId === 'number' ? rec.ProcessId : null;
      const cmd = typeof rec.CommandLine === 'string' ? rec.CommandLine.toLowerCase() : '';
      if (pid && cmd.includes(target)) return pid;
    }
  } catch {
    /* 조회 실패는 "못 찾음" 과 같다 */
  }
  return null;
}

/** Visual Studio 즉시 디버거(JIT) 경로 — 이것이 있으면 실행 중인 프로세스에 붙일 수 있다. */
export function findJitDebugger(): string | null {
  if (process.platform !== 'win32') return null;
  const systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows';
  const candidate = path.join(systemRoot, 'system32', 'vsjitdebugger.exe');
  return exists(candidate) ? candidate : null;
}

/**
 * 실행 중인 에디터에 Visual Studio 디버거를 붙인다.
 *
 * 언리얼 C++ 를 실제로 멈춰 세우는 `cppvsdbg` 는 재배포할 수 없다(⑦). 그래서 **우리가 디버깅을
 * 하는 대신, 우리가 띄운 프로세스에 남의 디버거를 붙여 준다** — 사용자는 Vibisual 에서 실행하고
 * Vibisual 에서 붙이기를 누르며, 멈춰 세우는 일만 Visual Studio 가 한다.
 */
export function attachDebuggerToEditor(projectRoot: string): { ok: boolean; error?: string; pid?: number } {
  const info = inspectUnrealProject(projectRoot);
  if (!info) return { ok: false, error: 'not-unreal-project' };

  const jit = findJitDebugger();
  if (!jit) return { ok: false, error: 'jit-debugger-not-found' };

  const pid = findRunningEditorPid(info.uprojectPath);
  if (!pid) return { ok: false, error: 'editor-not-running' };

  try {
    const child = spawn(jit, ['-p', String(pid)], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      cwd: projectRoot,
    });
    child.unref();
    logger.info(`[unreal] attach requested: pid=${pid} (${info.projectName})`);
    return { ok: true, pid };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[unreal] attach failed: ${message}`);
    return { ok: false, error: message };
  }
}
