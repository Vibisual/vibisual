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
import {
  resolveClaudeBin,
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
  const bin = resolveClaudeBin();
  const detected = await detectCurrentVersion(bin.binPath);

  const latestEntry = await getLatestCached(forceRefresh);

  // PATH 폴백이지만 검출도 실패 → 'unknown' 로 격하 (안내만 가능, 자동설치 ❌)
  let source: ClaudeBinSource = bin.source;
  if (source === 'path' && !detected.version) source = 'unknown';

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
  const active = resolveClaudeBin();
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
  const bin = resolveClaudeBin();
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
    env: process.env,
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
    const verifyBin = resolveClaudeBin();
    const verify = await detectCurrentVersion(verifyBin.binPath);
    inflightInstall.newVersion = verify.version ?? undefined;
    inflightInstall.status = 'done';
    if (!verify.version) {
      inflightInstall.error = `installed but --version verification failed: ${verify.error ?? 'unknown'}`;
    }
    pushProgress();
    inflightInstall = null;
  });

  return {
    installId: session.installId,
    status: session.status,
    stdout: session.stdout,
  };
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
