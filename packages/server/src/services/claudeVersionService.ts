import { spawn } from 'node:child_process';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type {
  ClaudeVersionInfo,
  ClaudeInstallProgress,
  ClaudeInstall,
  ClaudeInstallsInfo,
  WSMessage,
} from '@vibisual/shared';
import { CLAUDE_VERSION_PROBE_TIMEOUT_MS, CLAUDE_INSTALL_SCAN_MAX } from '@vibisual/shared';
import { logger } from '../logger.js';
import { broadcast } from '../broadcastBus.js';
import { userDefaultsService } from './userDefaultsService.js';
import {
  getClaudeBin,
  invalidateClaudeBinCache,
  discoverAllClaudeBins,
  readClaudeBinOverride,
  type ClaudeBinSource,
  type ClaudeBinInfo,
} from './claudeBin.js';

/** §5.7 #23-1 v1.59 — npm registry 조회 캐시 TTL */
const REGISTRY_CACHE_TTL_MS = 5 * 60 * 1000;
/** `--version` spawn 타임아웃 — 정상 응답은 수십 ms */
const VERSION_DETECT_TIMEOUT_MS = 2_000;
/** npm registry HTTPS 호출 타임아웃 */
const REGISTRY_FETCH_TIMEOUT_MS = 8_000;
/** npm install 자체 타임아웃 (대용량 다운로드 + postinstall 포함) */
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

const NPM_PACKAGE = '@anthropic-ai/claude-code';
const REGISTRY_URL = `https://registry.npmjs.org/${NPM_PACKAGE}/latest`;

interface CachedLatest {
  version: string | null;
  fetchedAt: number;
  error?: string;
}

let latestCache: CachedLatest | null = null;

interface InstallSession {
  installId: string;
  startedAt: number;
  status: ClaudeInstallProgress['status'];
  stdout: string;
  exitCode?: number;
  newVersion?: string;
  error?: string;
}

let inflightInstall: InstallSession | null = null;

/**
 * `<bin> --version` 실행 후 stdout 에서 semver 추출.
 * 정상 출력 예: "2.1.139 (Claude Code)" 또는 "2.1.139".
 */
function detectCurrentVersion(
  binPath: string,
  timeoutMs: number = VERSION_DETECT_TIMEOUT_MS,
): Promise<{ version: string | null; error?: string }> {
  return new Promise((resolve) => {
    let resolved = false;
    const child = spawn(binPath, ['--version'], {
      shell: process.platform === 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c) => { stdout += c.toString(); });
    child.stderr?.on('data', (c) => { stderr += c.toString(); });

    const finish = (result: { version: string | null; error?: string }): void => {
      if (resolved) return;
      resolved = true;
      try { child.kill(); } catch { /* ignore */ }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ version: null, error: `--version timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      finish({ version: null, error: `spawn failed: ${err.message}` });
    });

    child.on('close', () => {
      clearTimeout(timer);
      const text = (stdout || stderr).trim();
      const match = text.match(/(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/);
      if (match && match[1]) {
        finish({ version: match[1] });
      } else {
        finish({ version: null, error: text ? `unparsable: ${text.slice(0, 80)}` : 'no output' });
      }
    });
  });
}

/**
 * §4 (첫 실행 설치 온보딩) — 임의 경로의 `claude` 실행본 버전 probe 공개 창구.
 * `claudeSetupService` 가 설치 전후 판정에 쓴다(같은 spawn·파싱 규칙을 공유해 판정이 갈리지 않게).
 */
export function probeClaudeBinVersion(
  binPath: string,
  timeoutMs: number = CLAUDE_VERSION_PROBE_TIMEOUT_MS,
): Promise<{ version: string | null; error?: string }> {
  return detectCurrentVersion(binPath, timeoutMs);
}

function fetchLatestVersion(): Promise<{ version: string | null; error?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const req = https.get(REGISTRY_URL, { timeout: REGISTRY_FETCH_TIMEOUT_MS }, (res) => {
      if (res.statusCode !== 200) {
        if (!settled) { settled = true; resolve({ version: null, error: `HTTP ${res.statusCode}` }); }
        res.resume();
        return;
      }
      let body = '';
      res.on('data', (c) => { body += c.toString(); });
      res.on('end', () => {
        if (settled) return;
        settled = true;
        try {
          const parsed = JSON.parse(body) as { version?: string };
          if (typeof parsed.version === 'string' && /^\d+\.\d+\.\d+/.test(parsed.version)) {
            resolve({ version: parsed.version });
          } else {
            resolve({ version: null, error: 'no version field' });
          }
        } catch (err) {
          resolve({ version: null, error: `parse error: ${(err as Error).message}` });
        }
      });
    });
    req.on('timeout', () => {
      if (settled) return;
      settled = true;
      try { req.destroy(); } catch { /* ignore */ }
      resolve({ version: null, error: `timeout after ${REGISTRY_FETCH_TIMEOUT_MS}ms` });
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      resolve({ version: null, error: err.message });
    });
  });
}

/** semver 비교: a < b 면 true. 한쪽이라도 null/형식 불일치면 false. */
function isOutdated(current: string | null, latest: string | null): boolean {
  if (!current || !latest) return false;
  const parse = (v: string): number[] => (v.split(/[-+]/)[0] ?? '').split('.').map((n) => parseInt(n, 10) || 0);
  const a = parse(current);
  const b = parse(latest);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai: number = a[i] ?? 0;
    const bi: number = b[i] ?? 0;
    if (ai < bi) return true;
    if (ai > bi) return false;
  }
  return false;
}

/** latest 조회 (5분 TTL in-memory 캐시 공유). forceRefresh=true 면 캐시 무효화. */
async function getLatestCached(forceRefresh = false): Promise<CachedLatest> {
  if (
    !forceRefresh &&
    latestCache &&
    Date.now() - latestCache.fetchedAt < REGISTRY_CACHE_TTL_MS
  ) {
    return latestCache;
  }
  const r = await fetchLatestVersion();
  latestCache = { version: r.version, fetchedAt: Date.now(), error: r.error };
  return latestCache;
}

/**
 * 현재/최신 버전 조회 + outdated 판정.
 * latest 는 5분 TTL 캐시. forceRefresh=true 면 캐시 무효화.
 */
export async function getClaudeVersionInfo(forceRefresh = false): Promise<ClaudeVersionInfo> {
  const bin = getClaudeBin();
  const detected = await detectCurrentVersion(bin.binPath);

  const latestEntry = await getLatestCached(forceRefresh);

  // 실제 파일을 가리키는 출처인데 `--version` 검증도 실패 → 'unknown' 로 격하 (안내만, 자동설치 ❌).
  // §4 (첫 실행 설치 온보딩) — 'native' 도 같은 규칙을 탄다(경로만 있고 못 돌면 없는 것과 같다).
  let source: ClaudeBinSource = bin.source;
  if ((source === 'path' || source === 'native') && !detected.version) source = 'unknown';

  return {
    current: detected.version,
    latest: latestEntry.version,
    source,
    binPath: bin.binPath,
    isOutdated: isOutdated(detected.version, latestEntry.version),
    checkedAt: Date.now(),
    registryError: latestEntry.error,
    detectError: detected.error,
  };
}

/** 캐시 무효화 — 클라가 dismiss/install 후 재조회를 강제할 때 호출. */
export function invalidateLatestCache(): void {
  latestCache = null;
}

/**
 * §4 v2.43 — Vibisual 자체 버전을 **동적** 으로 read (하드코딩 ❌).
 * 우선순위: (1) `npm_package_version` 환경변수, (2) 이 모듈에서 위로 올라가며 만나는 첫 package.json 의 version.
 * 1회 계산 후 캐시.
 */
let appVersionCache: string | null = null;
function readAppVersion(): string {
  if (appVersionCache !== null) return appVersionCache;
  const fromEnv = process.env['npm_package_version'];
  if (fromEnv && /^\d+\.\d+\.\d+/.test(fromEnv)) {
    appVersionCache = fromEnv;
    return appVersionCache;
  }
  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i++) {
      const pkg = path.join(dir, 'package.json');
      try {
        const raw = fs.readFileSync(pkg, 'utf-8');
        const parsed = JSON.parse(raw) as { version?: unknown; name?: unknown };
        // 워크스페이스 패키지(@vibisual/server 등) 도 같은 0.x 버전을 공유하므로 첫 매치 채택.
        if (typeof parsed.version === 'string' && parsed.version.length > 0) {
          appVersionCache = parsed.version;
          return appVersionCache;
        }
      } catch {
        /* 이 레벨엔 package.json 없음/파싱불가 — 위로 */
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* fileURLToPath 실패 등 */
  }
  appVersionCache = 'unknown';
  return appVersionCache;
}

/**
 * §4 v2.43 — 옵션창 Version 탭 전체 데이터. PC 에 깔린 모든 claude 설치본을 발견·probe 하고
 * 현재 활성/선택 표시 + Vibisual·런타임 메타 + npm latest 를 묶어 반환. 전부 런타임 동적.
 */
export async function getClaudeInstallsInfo(forceRefresh = false): Promise<ClaudeInstallsInfo> {
  const active = getClaudeBin();
  const override = readClaudeBinOverride();

  // 발견 + 상한. active 바이너리가 후보에 없으면(예: bare 'claude' 폴백) 앞에 보강.
  const candidates = discoverAllClaudeBins().slice(0, CLAUDE_INSTALL_SCAN_MAX);
  const norm = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p);
  const hasActive = candidates.some((c) => norm(c.binPath) === norm(active.binPath));
  if (!hasActive && active.binPath) {
    candidates.unshift({
      binPath: active.binPath,
      source: active.source === 'unknown' ? 'path' : active.source,
    });
  }

  // 각 후보 병렬 probe (probe 전용 타임아웃).
  const [latestEntry, probed] = await Promise.all([
    getLatestCached(forceRefresh),
    Promise.all(
      candidates.map(async (c): Promise<ClaudeInstall> => {
        const det = await detectCurrentVersion(c.binPath, CLAUDE_VERSION_PROBE_TIMEOUT_MS);
        return {
          binPath: c.binPath,
          source: c.source,
          version: det.version,
          detectError: det.error,
          active: norm(c.binPath) === norm(active.binPath),
          selected: override != null && norm(c.binPath) === norm(override),
        };
      }),
    ),
  ]);

  // 정렬: active 우선 → 버전 검출된 것 우선 → 경로 알파벳.
  probed.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    const av = a.version ? 0 : 1;
    const bv = b.version ? 0 : 1;
    if (av !== bv) return av - bv;
    return a.binPath.localeCompare(b.binPath);
  });

  return {
    installs: probed,
    overridePath: override,
    appVersion: readAppVersion(),
    latest: latestEntry.version,
    registryError: latestEntry.error,
    runtime: {
      node: process.versions.node,
      electron: process.versions.electron,
      platform: process.platform,
      arch: process.arch,
    },
    scannedAt: Date.now(),
  };
}

function pushProgress(): void {
  if (!inflightInstall) return;
  const payload: ClaudeInstallProgress = {
    installId: inflightInstall.installId,
    status: inflightInstall.status,
    stdout: inflightInstall.stdout,
    exitCode: inflightInstall.exitCode,
    newVersion: inflightInstall.newVersion,
    error: inflightInstall.error,
  };
  const msg: WSMessage = {
    type: 'claude_install_progress',
    timestamp: Date.now(),
    payload,
  };
  broadcast(msg);
}

/**
 * §5.7 #23-1 v1.81 — 멀티플랫폼 업데이트 명령 결정.
 * - 절대경로의 실제 바이너리(공식 네이티브 인스톨러·Homebrew 등) → Claude Code 자체 `<bin> update`
 *   (OS·설치방식 무관, CLI 가 자기 설치 채널을 인지해 갱신). 명시 args 라 shell 불필요.
 * - npm-global 흔적(node_modules/.bin/npm-global/.cmd) 또는 bare 'claude' → `npm install -g`.
 * `manualHint` = 자동 실패 시 사용자에게 노출할 수동 명령.
 */
function buildInstallPlan(bin: ClaudeBinInfo): {
  command: string;
  args: string[];
  useShell: boolean;
  kind: 'self-update' | 'npm';
  manualHint: string;
} {
  const lower = bin.binPath.toLowerCase();
  const sep = path.sep;
  const looksNpmGlobal =
    lower.includes(`${sep}node_modules${sep}`) ||
    lower.includes(`${sep}.bin${sep}`) ||
    lower.includes('npm-global') ||
    lower.includes(`${sep}npm${sep}`) ||
    lower.endsWith('.cmd');

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npmManual = `${npmCmd} install -g ${NPM_PACKAGE}`;

  if (path.isAbsolute(bin.binPath) && !looksNpmGlobal) {
    return {
      command: bin.binPath,
      args: ['update'],
      useShell: false,
      kind: 'self-update',
      manualHint: `"${bin.binPath}" update  (or: ${npmManual})`,
    };
  }
  return {
    command: npmCmd,
    args: ['install', '-g', NPM_PACKAGE],
    useShell: process.platform === 'win32',
    kind: 'npm',
    manualHint: npmManual,
  };
}

/**
 * Claude Code 업데이트 실행 + WS 진행 push. 설치 방식(네이티브 self-update / npm)은
 * `buildInstallPlan` 이 바이너리 경로로 멀티플랫폼 분기. 동시 호출은 같은 in-flight installId 공유.
 */
export function installLatestClaude(): ClaudeInstallProgress {
  if (inflightInstall) {
    // 진행 중 — 즉시 현재 상태만 반환. 클라는 WS 로 후속 push 받음.
    return {
      installId: inflightInstall.installId,
      status: inflightInstall.status,
      stdout: inflightInstall.stdout,
      exitCode: inflightInstall.exitCode,
      newVersion: inflightInstall.newVersion,
      error: inflightInstall.error,
    };
  }

  const session: InstallSession = {
    installId: randomUUID(),
    startedAt: Date.now(),
    status: 'starting',
    stdout: '',
  };
  inflightInstall = session;

  // VS Code 확장 출처면 호출 측에서 막는 게 정상이지만 방어적으로 fail-fast.
  const bin = getClaudeBin();
  if (bin.source === 'vscode-extension') {
    session.status = 'error';
    session.error = 'VS Code extension binary cannot be auto-updated. Use the Marketplace.';
    pushProgress();
    inflightInstall = null;
    return { installId: session.installId, status: 'error', error: session.error };
  }

  const plan = buildInstallPlan(bin);
  logger.info('[claudeVersionService] starting install', {
    kind: plan.kind,
    command: plan.command,
    args: plan.args,
  });

  const child = spawn(plan.command, plan.args, {
    shell: plan.useShell,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // §4 (Claude Code CLI 자동 업데이트) — **패키지 매니저 설치본도 실제로 올라가게.**
      //   Homebrew(mac)·WinGet(Windows) 로 깐 실행본은 `claude update` 가 기본적으로
      //   "이미 최신"이라고만 답하고 **아무것도 하지 않는다**(갱신은 brew/winget 담당).
      //   그대로 두면 우리는 매 실행마다 갱신을 시도했다고 보고하면서 버전은 그대로인
      //   조용한 거짓말이 된다. CLI 가 이 env 를 보면 자기가 알아서 `brew upgrade` /
      //   `winget upgrade` 를 대신 돌려 준다(공식 문서가 지정한 레버).
      //   네이티브·npm 설치본에는 아무 영향이 없다.
      CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE: '1',
    },
  });

  session.status = 'running';
  pushProgress();

  const onChunk = (c: Buffer): void => {
    if (!inflightInstall) return;
    inflightInstall.stdout += c.toString();
    pushProgress();
  };
  child.stdout?.on('data', onChunk);
  child.stderr?.on('data', onChunk);

  const timer = setTimeout(() => {
    if (!inflightInstall) return;
    inflightInstall.error = `install timed out after ${INSTALL_TIMEOUT_MS}ms`;
    inflightInstall.status = 'error';
    try { child.kill(); } catch { /* ignore */ }
  }, INSTALL_TIMEOUT_MS);

  child.on('error', (err) => {
    clearTimeout(timer);
    if (!inflightInstall) return;
    inflightInstall.status = 'error';
    inflightInstall.error = `spawn failed: ${err.message}`;
    pushProgress();
    inflightInstall = null;
  });

  child.on('close', async (code) => {
    clearTimeout(timer);
    if (!inflightInstall) return;
    inflightInstall.exitCode = code ?? -1;
    if (code !== 0) {
      inflightInstall.status = 'error';
      inflightInstall.error =
        inflightInstall.error ??
        `${plan.kind === 'self-update' ? 'self-update' : 'npm install'} exited ${code}. Manual: ${plan.manualHint}`;
      pushProgress();
      inflightInstall = null;
      return;
    }
    // 종료 정상 — 새 바이너리 --version 으로 PATH 캐시 검증 + 캐시 무효화
    invalidateLatestCache();
    // 갱신 후에는 실행본 경로 자체가 바뀔 수 있다(네이티브 self-update 는 versions/ 심볼릭 교체).
    invalidateClaudeBinCache();
    const verifyBin = getClaudeBin();
    const verify = await detectCurrentVersion(verifyBin.binPath);
    inflightInstall.newVersion = verify.version ?? undefined;
    inflightInstall.status = 'done';
    if (!verify.version) {
      inflightInstall.error = `installed but --version verification failed: ${verify.error ?? 'unknown'}`;
    }
    pushProgress();
    const settled = getInflightInstall();
    inflightInstall = null;
    if (settled) emitInstallSettled(settled);
  });

  return {
    installId: session.installId,
    status: session.status,
    stdout: session.stdout,
  };
}

// ─── §4 — 설치/갱신 완료 알림 ─────────────────────────────────────────────────
//
// CLI 가 바뀌면 **CLI 에서 파생된 캐시**(로그인 판정 · 모델 레지스트리 · effort 등급 ·
// 내장 슬래시 명령)가 통째로 낡는다. 종전엔 그 캐시들이 전부 "부팅 1회" 전제였는데,
// 이제 앱을 켠 뒤에 CLI 가 새로 깔리거나 최신으로 바뀌는 경로가 생겼으므로 그 순간을
// 알려 줄 창구가 필요하다. 없으면 갓 설치한 사용자는 다음 실행 전까지 로그인 창도
// 못 보고 모델 목록도 비어 있다.

type InstallSettledListener = (progress: ClaudeInstallProgress) => void;
const installSettledListeners = new Set<InstallSettledListener>();

/**
 * 인스톨러가 **정상 종료(exit 0)해 실행본이 실제로 바뀌었을 수 있는** 순간 알림.
 * spawn 실패·비정상 종료는 바뀐 게 없으므로 발화하지 않는다(헛된 재스캔 방지).
 * 해제 함수를 돌려준다.
 */
export function onClaudeInstallSettled(listener: InstallSettledListener): () => void {
  installSettledListeners.add(listener);
  return () => installSettledListeners.delete(listener);
}

function emitInstallSettled(progress: ClaudeInstallProgress): void {
  for (const l of installSettledListeners) {
    try {
      l(progress);
    } catch (err) {
      logger.warn(`[claudeVersionService] settled listener failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * §4 (Claude Code CLI 자동 업데이트) — **앱을 켤 때 1회** CLI 를 최신으로 맞춘다.
 *
 * `installLatestClaude()` 는 §5.7 #23-1 부터 있었지만 **그것을 부르는 자동 경로가 없었다** —
 * 유일한 트리거였던 `ClaudeVersionGate` 는 `claudeVersionModalOpen` 을 켜는 곳이 클라 어디에도
 * 없어서(미배선), 사용자가 옵션창을 직접 열지 않는 한 버전이 영원히 그대로였다. 이 함수가
 * 그 빈 자리를 메운다 — 새 설치 레일을 만들지 않고 기존 서비스·기존 WS 진행 push 를 그대로 쓴다.
 *
 * 건너뛰는 경우:
 *  - 사용자가 껐다(`UserDefaults.claudeAutoUpdate.enabled === false`)
 *  - 이미 최신 (또는 current/latest 중 하나를 못 읽어 비교 자체가 불가)
 *  - `source === 'vscode-extension'` — 마켓플레이스 밖에서 갱신할 수 없다(안내만)
 *  - `source === 'unknown'` — 아직 안 깔렸다. 이건 갱신이 아니라 **설치** 문제라
 *    §4 설치 온보딩 게이트(`claudeSetupService`)가 맡는다.
 *
 * ⚠ §4 v2.44 **Vibisual 앱** 자동 업데이트(electron-updater)와는 무관하다 — 그쪽은 종전 그대로.
 */
export async function autoUpdateClaudeIfEnabled(): Promise<{ started: boolean; reason?: string }> {
  if (userDefaultsService.get().claudeAutoUpdate?.enabled === false) {
    return { started: false, reason: 'disabled' };
  }
  const info = await getClaudeVersionInfo(true);
  if (info.source === 'unknown') return { started: false, reason: 'not-installed' };
  if (info.source === 'vscode-extension') return { started: false, reason: 'vscode-extension' };
  if (!info.isOutdated) return { started: false, reason: 'up-to-date' };

  logger.info(
    `[claudeVersionService] auto-update on launch: ${info.current ?? '?'} → ${info.latest ?? '?'} (${info.source})`,
  );
  installLatestClaude();
  return { started: true };
}

export function getInflightInstall(): ClaudeInstallProgress | null {
  if (!inflightInstall) return null;
  return {
    installId: inflightInstall.installId,
    status: inflightInstall.status,
    stdout: inflightInstall.stdout,
    exitCode: inflightInstall.exitCode,
    newVersion: inflightInstall.newVersion,
    error: inflightInstall.error,
  };
}
