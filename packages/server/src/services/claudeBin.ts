import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ClaudeBinSource } from '@vibisual/shared';
import { logger } from '../logger.js';

export type { ClaudeBinSource };

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
/** VS Code(및 변종) 확장 폴더 이름 접두사 — 뒤에 `<version>-<platform>` 이 붙는다. */
const EXT_DIR_PREFIX = 'anthropic.claude-code-';

/**
 * §4 (실행본 자가 복구) — 낙관적 폴백(`'claude'`)일 때 다시 찾아보는 간격(ms).
 *
 * 절대경로는 `isUsableBin()` stat 1회로 실재를 확인할 수 있지만, 아무것도 못 찾아 bare `'claude'`
 * 를 들고 있는 상태는 stat 할 대상 자체가 없다 — 그렇다고 매 호출 PATH 전수 스캔을 돌릴 수는
 * 없으니 이 간격으로만 재탐색한다(앱 밖에서 설치가 끝난 직후에도 다음 spawn 이 바로 잡는다).
 */
const CLAUDE_BIN_REVALIDATE_MS = 1_000;

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
 * §4 (실행본 자가 복구) — override 되쓰기 창구 **주입**.
 *
 * 이 모듈은 위 주석대로 `userDefaultsService` 를 import 하지 않고 파일을 직접 읽어 자급한다.
 * 그런데 승계(확장 자동 갱신 추종)는 **쓰기**가 필요하고, 그 서비스는 in-memory 사본을 들고
 * 통째로 저장하므로 우리가 파일을 직접 덮어쓰면 그 사본이 다음 저장 때 되돌려 버린다.
 * 그래서 쓰기만 **부팅 시 주입**받는다 — 미배선이면 승계는 그대로 되고 되쓰기만 생략된다.
 */
let overrideWriter: ((nextPath: string) => void) | null = null;

/** 서버 부팅에서 `userDefaultsService.update({ claudeBinPath })` 로 배선한다. null 로 해제. */
export function setClaudeBinOverrideWriter(fn: ((nextPath: string) => void) | null): void {
  overrideWriter = fn;
}

/** 승계된 경로를 사용자 설정에 되쓴다 — 창구가 없으면 조용히 넘어간다(해석 결과는 이미 유효). */
function persistClaudeBinOverride(nextPath: string): void {
  if (!overrideWriter) return;
  try {
    overrideWriter(nextPath);
  } catch (err) {
    logger.warn(`[claudeBin] override persist failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * §4 (첫 실행 설치 온보딩) — **공식 네이티브 인스톨러가 관리하는 설치 위치**.
 *
 * 이 아래에 있는 실행본이 `'native'` 출처다 — 우리 앱이 깔아 주고(`claudeSetupService`),
 * `<bin> update` 로 우리가 갱신할 수 있는 유일한 부류라 **사용자 override 다음으로 우선**한다.
 * (VS Code 확장 번들은 마켓플레이스 밖에서 갱신할 수 없어 뒤로 내려간다.)
 *
 * - `~/.local/bin` — 공식 인스톨러가 만드는 런처(`~/.local/share/claude/versions/…` 심볼릭)
 * - `~/.local/share/claude` — 버전 저장소 본체
 * - `~/.claude/local` — `claude migrate-installer` 가 옮긴 자기 관리 설치본
 */
function nativeInstallRoots(): string[] {
  const home = os.homedir();
  return [
    path.join(home, '.local', 'bin'),
    path.join(home, '.local', 'share', 'claude'),
    path.join(home, '.claude', 'local'),
  ];
}

/** 경로가 네이티브 설치 루트 아래인가 (대소문자는 Windows 만 무시). */
function isUnderNativeRoot(binPath: string): boolean {
  const norm = (p: string): string => (IS_WIN ? p.toLowerCase() : p);
  const target = norm(path.resolve(binPath));
  return nativeInstallRoots().some((root) => {
    const r = norm(path.resolve(root));
    return target === r || target.startsWith(r + path.sep);
  });
}

/** 네이티브 인스톨러가 깐 실행본 절대경로 — 없으면 null. 런처(`~/.local/bin`) 우선. */
function findNativeBin(): string | null {
  const home = os.homedir();
  const candidates = [
    path.join(home, '.local', 'bin', BIN_FILE),
    path.join(home, '.claude', 'local', BIN_FILE),
  ];
  for (const c of candidates) {
    if (isUsableBin(c)) return c;
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
 * **한 `extensions` 디렉터리 안**의 확장 번들 실행본 — 최신 버전 먼저.
 * 정렬: 디렉터리 안에서 semver 내림차순(`.sort().pop()` 와 동일 의미로 최신이 앞).
 * 확장 번들 레이아웃: `<ext>/resources/native-binary/claude(.exe)` — OS 무관 동일.
 */
function listExtensionBinsIn(extensionsDir: string): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(extensionsDir);
  } catch {
    return []; // 해당 IDE 미설치
  }
  const matches = entries
    .filter((d) => d.startsWith(EXT_DIR_PREFIX))
    .sort()
    .reverse(); // 최신 버전 먼저
  const out: string[] = [];
  for (const m of matches) {
    const bin = path.join(extensionsDir, m, 'resources', 'native-binary', BIN_FILE);
    if (isUsableBin(bin)) out.push(bin);
  }
  return out;
}

/**
 * VS Code(및 변종) 확장이 번들한 claude 바이너리 — **모든** 매칭 반환(버전·IDE 별 다수 가능).
 */
function listVscodeExtensionBins(): string[] {
  const out: string[] = [];
  for (const extDir of vscodeExtensionDirs()) out.push(...listExtensionBinsIn(extDir));
  return out;
}

/** VS Code(및 변종) 확장이 번들한 claude 바이너리 절대경로 — 없으면 null (최신 우선). */
function findVscodeExtensionBin(): string | null {
  return listVscodeExtensionBins()[0] ?? null;
}

/**
 * 확장 번들 실행본 경로에서 그것을 담고 있는 `extensions` 디렉터리를 되짚는다 — 아니면 null.
 * `<extensions>/anthropic.claude-code-<ver>/resources/native-binary/claude(.exe)` → `<extensions>`
 */
function extensionsDirOf(binPath: string): string | null {
  const parts = path.resolve(binPath).split(path.sep);
  const i = parts.findIndex((seg) => seg.toLowerCase().startsWith(EXT_DIR_PREFIX));
  if (i <= 0) return null;
  return parts.slice(0, i).join(path.sep);
}

/**
 * §4 (실행본 자가 복구) — **확장 자동 갱신 승계**.
 *
 * VS Code 는 확장을 갱신할 때 **새 버전 폴더를 만들고 옛 폴더를 통째로 지운다**
 * (`anthropic.claude-code-2.1.234-…` → `anthropic.claude-code-2.1.235-…`). 그래서 사용자가
 * Version 탭에서 고른 override 가 하루아침에 없는 경로가 된다. 그 선택은 "이 확장 번들을
 * 쓰겠다"는 뜻이지 "그 버전 숫자를 쓰겠다"가 아니므로, **같은 `extensions` 디렉터리의 최신
 * 번들**로 이어 준다. 승계할 게 없으면 null → 호출 측이 자동 우선순위로 폴백한다.
 */
export function succeedStaleExtensionOverride(override: string): string | null {
  if (classifyClaudeBinSource(override) !== 'vscode-extension') return null;
  const extDir = extensionsDirOf(override);
  if (!extDir) return null;
  const next = listExtensionBinsIn(extDir)[0];
  if (!next) return null;
  return normalizeForDedup(next) === normalizeForDedup(override) ? null : next;
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

/**
 * §4 v2.43 — 임의 바이너리 경로의 출처 분류 (override·discovery 표시용).
 * §4 (첫 실행 설치 온보딩) — `'native'` 를 가장 먼저 본다(우선순위 판정과 같은 기준을 쓰기 위함).
 */
export function classifyClaudeBinSource(binPath: string): Exclude<ClaudeBinSource, 'unknown'> {
  if (isUnderNativeRoot(binPath)) return 'native';
  // 디스크에 저장된 override 는 `/` 표기로 들어올 수 있다(사용자가 손으로 고쳤거나 다른 OS 표기).
  // 구분자를 OS 표준으로 맞춘 뒤 봐야 확장 번들을 놓치지 않는다 — 승계(자동 갱신 추종)가 이 판정에 걸려 있다.
  const lower = (path.isAbsolute(binPath) ? path.resolve(binPath) : binPath).toLowerCase();
  const isExt =
    lower.includes(EXT_DIR_PREFIX) &&
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

  // §4 (첫 실행 설치 온보딩) — 네이티브(우리가 관리하는 출처)를 맨 앞에 둔다. resolveClaudeBin 의
  // 우선순위와 같은 순서라, 목록 첫 줄이 곧 "지금 활성일 가능성이 가장 높은 것"이 된다.
  const nativeBin = findNativeBin();
  if (nativeBin) push(nativeBin, 'native');
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
 * 우선순위 (§4 첫 실행 설치 온보딩에서 **1↔2 순서를 대체** — 종전은 확장 번들이 네이티브보다 앞):
 *  0) **사용자 override** (`UserDefaults.claudeBinPath`) — 옵션창 Version 탭에서 명시 선택. 파일 존재 검증
 *     통과 시 최우선. 경로 패턴으로 출처 분류. 파일이 사라졌으면 자동 폴백(아래 1~4).
 *     확장 번들을 계속 쓰려는 사용자는 여기서 고른다 — 선택지를 없애는 변경이 아니다.
 *  1) **공식 네이티브 인스톨러 설치본**(`~/.local/bin` · `~/.claude/local`) → 'native'.
 *     우리 앱이 깔고(`claudeSetupService`) 우리가 `<bin> update` 로 갱신할 수 있는 유일한 출처라
 *     자동으로 골랐을 때 버전 관리가 끊기지 않는다.
 *  2) VS Code(및 Insiders/VSCodium/Remote/Cursor/Windsurf) 확장 번들 바이너리 → 'vscode-extension'.
 *     마켓플레이스 밖에서 갱신 ❌ 라 네이티브가 있으면 그쪽을 쓴다.
 *  3) PATH / 알려진 네이티브·패키지 설치 위치의 절대경로 → 'path'
 *  4) 모두 실패해도 'claude' 문자열 반환(spawn 이 ENOENT 던지게) + source='path'(낙관)
 *     → `claudeVersionService` 가 `--version` 검증 실패 시 'unknown' 으로 격하한다.
 */
export function resolveClaudeBin(): ClaudeBinInfo {
  const override = readClaudeBinOverride();
  if (override) {
    if (isUsableBin(override)) {
      return { binPath: override, source: classifyClaudeBinSource(override) };
    }
    // §4 (실행본 자가 복구) — 확장이 자동 갱신되어 override 폴더가 사라진 경우: 같은 확장의
    //   최신 번들로 승계하고, 사용자의 선택이 계속 유효하도록 저장된 경로도 새 것으로 되쓴다.
    //   (되쓰지 않으면 Version 탭의 `selected` 판정이 갱신 때마다 어긋난다.)
    const successor = succeedStaleExtensionOverride(override);
    if (successor) {
      logger.info(`[claudeBin] override succeeded to updated extension bundle: ${override} → ${successor}`);
      persistClaudeBinOverride(successor);
      return { binPath: successor, source: 'vscode-extension' };
    }
  }

  const native = findNativeBin();
  if (native) return { binPath: native, source: 'native' };

  const ext = findVscodeExtensionBin();
  if (ext) return { binPath: ext, source: 'vscode-extension' };

  const found = findOnPathOrKnownLocations();
  if (found) return { binPath: found, source: 'path' };

  // 낙관적 폴백 — bare 'claude'. spawn PATH 해석에 맡기고, --version 검증 실패 시 호출 측이 'unknown' 격하.
  return { binPath: 'claude', source: 'path' };
}

// ─── §4 (첫 실행 설치 온보딩) — 지연 해석 + 명시 무효화 ─────────────────────────────
//
// 종전엔 여러 서비스가 **모듈 로드 시** `const CLAUDE_BIN = resolveClaudeBin().binPath` 로 1회
// 캡처했다(§4 v2.43 이 "선택은 다음 실행에 적용"이라고 적어 둔 이유). 그런데 앱 안에서 CLI 를
// **깔아 주는** 경로가 생기면 그 규약이 곧바로 문제가 된다 — 설치가 끝나도 이미 캡처된 값은
// 여전히 폴백 `'claude'`(= 없는 것)라 사용자가 앱을 껐다 켜기 전에는 에이전트를 못 띄운다.
// "설치하면 바로 로그인하고 쓸 수 있게" 라는 요구가 그 지점에서 깨진다.
//
// 그래서 **호출 시점에 해석**하되, 매 spawn 마다 PATH 전체를 훑지 않도록 결과를 캐시하고,
// 값이 실제로 바뀔 수 있는 지점에서 버린다:
//   ① 설치 완료(`claudeSetupService`)  ② 사용자가 Version 탭에서 실행본을 바꿨을 때
//   ③ §4 (실행본 자가 복구) — **캐시가 가리키는 파일이 그 자리에서 사라졌을 때**
//
// ③ 이 뒤늦게 붙은 이유: ①② 만 두었을 때의 전제는 "앱이 도는 동안 실행본이 저절로 바뀌지
// 않는다" 였는데, **VS Code 확장 자동 갱신**이 정확히 그 전제를 깬다 — 확장은 새 버전 폴더로
// 갈아치워지며 옛 폴더를 통째로 지우고, 그러면 우리가 든 절대경로는 죽은 채 남는다. 실측
// (2026-08-19): `2.1.234` → `2.1.235` 교체 후 모든 spawn 이 `ENOENT`(Windows libuv `-4058`) 로
// 죽었고 **앱을 껐다 켜기 전에는 복구되지 않았다.** 그래서 캐시를 돌려주기 전에 그 경로가
// 아직 있는지 확인한다(stat 1회 — spawn 비용에 비하면 무시할 수준).

let cachedBin: ClaudeBinInfo | null = null;
/** `cachedBin` 을 해석한 시각 — 낙관적 폴백(`'claude'`)의 재탐색 간격 판정에만 쓴다. */
let cachedAt = 0;

/** 캐시된 해석 결과가 **아직 그 자리에 있는가**. */
function isCachedBinStillThere(info: ClaudeBinInfo, now: number): boolean {
  // 낙관적 폴백(bare `'claude'`)은 stat 할 대상이 없다 — 간격을 두고 다시 찾아본다.
  if (!path.isAbsolute(info.binPath)) return now - cachedAt < CLAUDE_BIN_REVALIDATE_MS;
  return isUsableBin(info.binPath);
}

/**
 * 지금 이 앱이 쓰는 `claude` 실행본 — **캐시된 해석 결과**. spawn·probe 전 콜사이트가 이것을 쓴다.
 * 첫 호출에 `resolveClaudeBin()` 을 돌리고, 이후에는 무효화되거나 **그 파일이 사라지기 전까지**
 * 같은 값을 돌려준다.
 */
export function getClaudeBin(): ClaudeBinInfo {
  const now = Date.now();
  if (cachedBin && isCachedBinStillThere(cachedBin, now)) return cachedBin;

  const prev = cachedBin;
  cachedBin = resolveClaudeBin();
  cachedAt = now;
  if (prev && prev.binPath !== cachedBin.binPath) {
    // 앱이 도는 중에 실행본이 바뀐 유일한 흔적 — 이 줄이 없으면 다음 사람이 또 처음부터 추적해야 한다.
    logger.warn(
      `[claudeBin] resolved binary changed while running: ${prev.binPath} (${prev.source})`
      + ` → ${cachedBin.binPath} (${cachedBin.source})`,
    );
  }
  return cachedBin;
}

/** 실행본이 바뀔 수 있는 시점(설치 완료 · override 변경 · spawn ENOENT)에 캐시를 버린다. */
export function invalidateClaudeBinCache(): void {
  cachedBin = null;
  cachedAt = 0;
}

/**
 * §4 (실행본 자가 복구) — **spawn 실패가 ENOENT 면 우리가 든 경로가 사라진 것**이므로 캐시를 버린다.
 *
 * `getClaudeBin()` 의 사전 확인과 실제 `spawn()` 사이의 틈(확장 갱신이 하필 그 사이에 끝난 경우)과,
 * 애초에 아무것도 못 찾아 bare `'claude'` 로 띄운 경우를 함께 받는다. 다음 호출이 재해석한다.
 *
 * @returns ENOENT 로 판정해 캐시를 버렸으면 true — 호출 측이 "다시 태울지" 를 이 값으로 정한다.
 */
export function noteClaudeSpawnFailure(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  const message = err instanceof Error ? err.message : String(err ?? '');
  if (code !== 'ENOENT' && !message.includes('ENOENT')) return false;
  logger.warn(`[claudeBin] spawn ENOENT — cached binary is gone, re-resolving on next use: ${message}`);
  invalidateClaudeBinCache();
  return true;
}
