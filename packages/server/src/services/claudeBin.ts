import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type ClaudeBinSource = 'vscode-extension' | 'path' | 'unknown';

export interface ClaudeBinInfo {
  binPath: string;
  source: ClaudeBinSource;
}

/** §4 v2.43 — 발견된 설치본 후보 (버전 probe 전, 경로+출처만). */
export interface ClaudeBinCandidate {
  binPath: string;
  source: Exclude<ClaudeBinSource, 'unknown'>;
}

const IS_WIN = process.platform === 'win32';
/** 확장 번들/네이티브 바이너리 파일명 — Windows 만 `.exe`. */
const BIN_FILE = IS_WIN ? 'claude.exe' : 'claude';

/**
 * §4 v2.43 — 사용자가 옵션창 Version 탭에서 고른 override 경로 SSOT.
 * `userDefaultsService` 와 같은 글로벌 파일을 **동기 직접 read** 한다 — `resolveClaudeBin` 이
 * 모듈 로드 시 top-level const 로 불리므로 서비스 import(초기화 순서·순환 위험)를 피하고 자급한다.
 */
const USER_DEFAULTS_FILE = path.join(os.homedir(), '.vibisual', 'user-defaults.json');

/** override 경로 읽기 — 미설정/파일없음/파싱실패 시 null. 존재·파일 검증은 호출 측에서. */
export function readClaudeBinOverride(): string | null {
  try {
    const raw = fs.readFileSync(USER_DEFAULTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as { claudeBinPath?: unknown };
    const p = parsed?.claudeBinPath;
    if (typeof p === 'string' && p.trim().length > 0) return p.trim();
  } catch {
    /* 파일 없음/파싱 실패 — override 없음 */
  }
  return null;
}

/**
 * VS Code 본체 + 변종 IDE 의 `extensions` 디렉터리 후보.
 * 존재하는 것만 스캔하므로 다 넣어도 비용 없음. (mac/Linux/Win 모두 home 기준 동일 레이아웃)
 */
function vscodeExtensionDirs(): string[] {
  const home = os.homedir();
  return [
    '.vscode',           // VS Code stable
    '.vscode-insiders',  // VS Code Insiders
    '.vscode-oss',       // VSCodium
    '.vscode-server',    // Remote-SSH / devcontainer / code-server
    '.cursor',           // Cursor (VS Code fork — Claude Code 사용자 다수)
    '.windsurf',         // Windsurf (VS Code fork)
  ].map((b) => path.join(home, b, 'extensions'));
}

/**
 * VS Code(및 변종) 확장이 번들한 claude 바이너리 — **모든** 매칭 반환(버전·IDE 별 다수 가능).
 * 정렬: 디렉터리 안에서 semver 내림차순(`.sort().pop()` 와 동일 의미로 최신이 앞).
 */
function listVscodeExtensionBins(): string[] {
  const out: string[] = [];
  for (const extDir of vscodeExtensionDirs()) {
    let entries: string[];
    try {
      entries = fs.readdirSync(extDir);
    } catch {
      continue; // 해당 IDE 미설치
    }
    const matches = entries
      .filter((d) => d.startsWith('anthropic.claude-code-'))
      .sort()
      .reverse(); // 최신 버전 먼저
    for (const m of matches) {
      // 확장 번들 레이아웃: <ext>/resources/native-binary/claude(.exe) — OS 무관 동일.
      const bin = path.join(extDir, m, 'resources', 'native-binary', BIN_FILE);
      if (fs.existsSync(bin)) out.push(bin);
    }
  }
  return out;
}

/** VS Code(및 변종) 확장이 번들한 claude 바이너리 절대경로 — 없으면 null (최신 우선). */
function findVscodeExtensionBin(): string | null {
  return listVscodeExtensionBins()[0] ?? null;
}

/** PATH + 잘 알려진 네이티브/패키지 위치의 claude 후보 절대경로 목록 (존재 검증 전 후보). */
function pathAndKnownCandidates(): string[] {
  const home = os.homedir();
  const candidates: string[] = [];

  // 1) PATH 디렉터리 스캔
  const pathEntries = (process.env.PATH ?? '').split(IS_WIN ? ';' : ':').filter(Boolean);
  if (IS_WIN) {
    const exts = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map((e) => e.trim()).filter(Boolean);
    for (const dir of pathEntries) {
      for (const ext of exts) candidates.push(path.join(dir, `claude${ext.toLowerCase()}`));
    }
  } else {
    for (const dir of pathEntries) candidates.push(path.join(dir, 'claude'));
  }

  // 2) 잘 알려진 설치 위치 (PATH 미상속 GUI 앱 보완)
  const known = IS_WIN
    ? [
        path.join(home, '.local', 'bin', 'claude.exe'),
        path.join(home, 'AppData', 'Local', 'Programs', 'claude', 'claude.exe'),
        path.join(home, '.claude', 'local', 'claude.exe'),
        path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'npm', 'claude.cmd'),
      ]
    : [
        path.join(home, '.local', 'bin', 'claude'),       // 공식 네이티브 인스톨러
        path.join(home, '.claude', 'local', 'claude'),    // migrate-installer
        '/opt/homebrew/bin/claude',                       // Apple Silicon Homebrew
        '/usr/local/bin/claude',                          // Intel Homebrew / 수동
        '/usr/bin/claude',
        path.join(home, '.npm-global', 'bin', 'claude'),  // npm prefix 커스텀
      ];
  candidates.push(...known);
  return candidates;
}

/** 존재(+posix 실행권한) 검증 — 통과한 절대경로면 반환. */
function isUsableBin(c: string): boolean {
  try {
    const st = fs.statSync(c);
    if (!st.isFile()) return false;
    if (IS_WIN) return true;
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * PATH + 잘 알려진 네이티브/패키지 설치 위치에서 claude 절대경로 탐색 (sync).
 * GUI 런치 앱은 사용자 셸 PATH 를 상속하지 않을 수 있어(특히 macOS) 알려진 위치로 보완한다.
 */
function findOnPathOrKnownLocations(): string | null {
  for (const c of pathAndKnownCandidates()) {
    if (isUsableBin(c)) return c;
  }
  return null;
}

/** §4 v2.43 — 임의 바이너리 경로의 출처 분류 (override·discovery 표시용). */
export function classifyClaudeBinSource(binPath: string): Exclude<ClaudeBinSource, 'unknown'> {
  const lower = binPath.toLowerCase();
  const isExt =
    lower.includes('anthropic.claude-code-') &&
    lower.includes(`${path.sep}resources${path.sep}native-binary${path.sep}`.toLowerCase());
  return isExt ? 'vscode-extension' : 'path';
}

/** realpath 정규화 (심볼릭/대소문자 dedupe용). 실패 시 입력 그대로. Windows 는 lower-case. */
function normalizeForDedup(p: string): string {
  let real = p;
  try {
    real = fs.realpathSync.native(p);
  } catch {
    try { real = fs.realpathSync(p); } catch { /* keep p */ }
  }
  return IS_WIN ? real.toLowerCase() : real;
}

/**
 * §4 v2.43 — PC 에 깔린 **모든** claude 설치본 후보를 발견(버전 probe 전).
 * 출처 우선순위(vscode-extension → path/known)로 모으고 realpath dedupe.
 * `CLAUDE_INSTALL_SCAN_MAX` 는 호출 측(claudeVersionService)에서 적용.
 */
export function discoverAllClaudeBins(): ClaudeBinCandidate[] {
  const out: ClaudeBinCandidate[] = [];
  const seen = new Set<string>();

  const push = (binPath: string, source: Exclude<ClaudeBinSource, 'unknown'>): void => {
    if (!isUsableBin(binPath)) return;
    const key = normalizeForDedup(binPath);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ binPath, source });
  };

  for (const bin of listVscodeExtensionBins()) push(bin, 'vscode-extension');
  for (const c of pathAndKnownCandidates()) push(c, classifyClaudeBinSource(c));

  return out;
}

/**
 * §5.7 #23-1 v1.81 / §4 v2.43 — `claude` CLI 바이너리 위치 + 출처 판정 SSOT (멀티플랫폼).
 * `subAgentManager`(spawn) 와 `claudeVersionService`(--version / 업데이트) 가 동일 경로를 쓰도록 단일화.
 *
 * **동기 함수 유지** — 여러 서비스가 모듈 로드 시 top-level (`const X = resolveClaudeBin().binPath`)
 * 로 호출하므로 async 화 금지. 모든 탐색은 sync fs.
 *
 * 우선순위:
 *  0) **사용자 override** (`UserDefaults.claudeBinPath`) — 옵션창 Version 탭에서 명시 선택. 파일 존재 검증
 *     통과 시 최우선. 경로 패턴으로 출처 분류. 파일이 사라졌으면 자동 폴백(아래 1~3).
 *  1) VS Code(및 Insiders/VSCodium/Remote/Cursor/Windsurf) 확장 번들 바이너리 → 'vscode-extension'
 *  2) PATH / 알려진 네이티브·패키지 설치 위치의 절대경로 → 'path'
 *  3) 모두 실패해도 'claude' 문자열 반환(spawn 이 ENOENT 던지게) + source='path'(낙관)
 *     → `claudeVersionService` 가 `--version` 검증 실패 시 'unknown' 으로 격하한다.
 */
export function resolveClaudeBin(): ClaudeBinInfo {
  const override = readClaudeBinOverride();
  if (override && isUsableBin(override)) {
    return { binPath: override, source: classifyClaudeBinSource(override) };
  }

  const ext = findVscodeExtensionBin();
  if (ext) return { binPath: ext, source: 'vscode-extension' };

  const found = findOnPathOrKnownLocations();
  if (found) return { binPath: found, source: 'path' };

  // 낙관적 폴백 — bare 'claude'. spawn PATH 해석에 맡기고, --version 검증 실패 시 호출 측이 'unknown' 격하.
  return { binPath: 'claude', source: 'path' };
}
