import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  CLAUDE_RELEASES_BASE_URL,
  CODEX_PACKAGE_ASSET_PREFIX,
  CODEX_PACKAGE_CHECKSUM_ASSET,
  CODEX_RELEASES_LATEST_API,
  CODEX_RELEASE_TAG_PREFIX,
  MANAGED_ENGINE_DISK_HEADROOM_RATIO,
  MANAGED_ENGINE_LOOKUP_TIMEOUT_MS,
  MANAGED_ENGINE_META_NAME,
  MANAGED_ENGINE_RETRY_BACKOFF_MS,
  MANAGED_ENGINE_ROLLBACK_MARK,
  MANAGED_ENGINE_UPDATE_INTERVAL_MS,
  parseAssetSha256,
  type ManagedEngineId,
  type ManagedEngineStatus,
} from '@vibisual/shared';
import { logger } from '../logger.js';
import { downloadTo, extractArchive, imageShortfall } from './localEngineService.js';
import type { HelperDownloadResult } from './helperDownload.js';
import {
  compareEngineVersions,
  findManagedBinIn,
  hostPlatformTarget,
  isEngineVersion,
  managedEngineDirIn,
  managedStagingDir,
  managedVersionsDir,
  managedVersionsToPrune,
  pickManagedVersions,
  readManagedMeta,
  scanManagedVersions,
  type ManagedEngineMeta,
} from './managedEngineLayout.js';
import {
  claudeFlagProbeCases,
  claudeSubcommandProbeCases,
  codexProbeCases,
  probeEngineVersion,
  runEngineProbes,
  type EngineProbeCase,
  type ProbeOutcome,
  type ProbeRunOptions,
} from './managedEngineProbe.js';
import { discoverAllClaudeBins, invalidateClaudeBinCache } from './claudeBin.js';
import { codexStandaloneCandidatesIn, invalidateCodexBinCache } from './codexCli.js';
import { resolveBinary } from './binLocator.js';
import { userDefaultsService } from './userDefaultsService.js';

/**
 * §4 (앱 전용 엔진) — 클로드·코덱스 실행본을 앱이 받아 깔고 판도 바꾼다. 조회 → 받기(크기·SHA-256) → `staging/` → 점검 → `versions/` → 지금·앞 판만 남김.
 * 동봉하지 않는다 — 공식 배포처(`CLAUDE_RELEASES_BASE_URL` · `openai/codex` 릴리스)에서만 받고 실행본은 고치지 않는다.
 * 판 상태는 폴더가 진실(`managedEngineLayout`), 메모리엔 이번 실행의 관측뿐. 같은 엔진의 받기는 하나(동시 호출은 합류).
 * 받기·SHA-256 은 앱 메인 밖 도우미(⑬ `helperDownload.ts`) — 앱 안에서 받으면 큰 파일 바이트가 망가졌다(2026-10-26). 오류면 짧은 간격으로 재시도(`setRetryHandler`).
 */

/** 공식 배포처에서 읽은 판 하나. */
export interface EngineRelease {
  version: string;
  /** 받을 주소(공식 배포처). */
  url: string;
  /** 받을 파일의 SHA-256(소문자 hex). 없으면 받지 않는다 — 대조 없는 실행본은 깔지 않는다. */
  sha256: string;
  /** 받을 파일 크기(바이트) — 모르면 0. */
  size: number;
  /** 받을 파일 이름(Claude = manifest 의 `binary` · 코덱스 = 자산 이름). */
  fileName: string;
}

export type ManagedEnsureOutcome =
  | 'installed'
  | 'up-to-date'
  | 'skipped-rolled-back'
  | 'probe-failed'
  | 'unsupported'
  | 'error';

export interface ManagedEnsureResult {
  outcome: ManagedEnsureOutcome;
  /** 이 일이 끝난 뒤 쓰는 판(설치 · 최신 확인) 또는 시도한 판(실패). */
  version?: string;
  binPath?: string;
  error?: string;
  failedProbes?: string[];
}

export interface ManagedPeek {
  latest: string | null;
  /** 최신 판이 이미 앱 전용 폴더에 있는가. */
  installed: boolean;
  /** 그 판이 사용자가 되돌린 판인가. */
  rolledBack: boolean;
  error?: string;
}

/** 자동 업데이트를 지금 돌려도 되는가 — 스위치 · 그 엔진을 쓰는 PC 인가. */
export type ManagedAutoGate = 'ok' | 'disabled' | 'not-in-use' | 'unsupported';

/** 외부 의존 — 시험이 네트워크 · 디스크 · 점검을 갈아 끼운다. */
export interface ManagedEngineDeps {
  home(): string;
  platform: NodeJS.Platform;
  target(engine: ManagedEngineId): string | null;
  fetchText(url: string, headers?: Record<string, string>): Promise<string>;
  fetchJson(url: string, headers?: Record<string, string>): Promise<unknown>;
  /**
   * 받는다 — 앱 메인 프로세스 밖의 도우미가 받고, 받은 바이트와 다시 읽은 파일의 SHA-256 을 둘 다 돌려준다(⑬).
   * 큰 파일을 앱 안에서 다시 읽어 해시를 내지 않는다.
   */
  download(url: string, dest: string, onBytes: (received: number, total: number) => void): Promise<HelperDownloadResult>;
  extract(archive: string, destDir: string): Promise<void>;
  shortfall(file: string): number;
  freeBytes(dir: string): number | null;
  probeVersion(engine: ManagedEngineId, bin: string, version: string, opts: ProbeRunOptions): Promise<string | null>;
  runProbes(engine: ManagedEngineId, bin: string, cases: readonly EngineProbeCase[], opts: ProbeRunOptions): Promise<ProbeOutcome>;
  tmpDir(): string;
  /** 이 PC 가 그 엔진을 쓰는가(앱 전용 말고 다른 실행본이 하나라도 있는가). */
  isInUse(engine: ManagedEngineId): boolean;
  autoUpdateEnabled(engine: ManagedEngineId): boolean;
  /** 지금 쓰는 판이 바뀌었을 때 — 실행본 캐시를 버려 다음 스폰부터 새 판이 쓰이게 한다. */
  onActiveChanged(engine: ManagedEngineId): void;
  now(): number;
  /** 한 박자 쉰다(백신이 갓 쓴 실행본을 훑는 동안 · 시험은 즉시). */
  sleep(ms: number): Promise<void>;
  /** 나중에 한 번 부른다(받기 실패 뒤 재시도) — 돌려준 함수로 취소한다. 시험이 시계를 갈아 끼운다. */
  schedule(fn: () => void, ms: number): () => void;
}

interface EngineRuntime {
  latest: string | null;
  checkedAt: number | null;
  release: EngineRelease | null;
  lastError: string | null;
  failedProbes: string[] | undefined;
  deferred: 'not-in-use' | undefined;
  inflight: Promise<ManagedEnsureResult> | null;
  reporters: Set<(line: string) => void>;
  /** 오류로 끝난 받기가 이어진 횟수 — 재시도 간격의 차례(`MANAGED_ENGINE_RETRY_BACKOFF_MS`). */
  failStreak: number;
  /** 예약된 재시도 시각 · 취소 함수. */
  nextRetryAt: number | null;
  cancelRetry: (() => void) | null;
}

/** 방금 읽은 배포처 정보를 다시 쓰는 시간 — 같은 확인 안에서 두 번 묻지 않게(`peekLatest` → `ensureLatest`). */
const RELEASE_REUSE_MS = 60_000;
/** 갓 받은 실행본을 백신이 붙잡고 있을 때 옮기기 · 띄우기를 다시 해 보는 횟수와 간격. */
const BUSY_RETRY_MAX = 5;
const BUSY_RETRY_DELAY_MS = 600;

const ENGINE_LABEL: Record<ManagedEngineId, string> = { claude: 'Claude Code', codex: 'Codex' };

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export class ManagedEngineService {
  private readonly runtime = new Map<ManagedEngineId, EngineRuntime>();
  private readonly listeners = new Set<(engine: ManagedEngineId) => void>();
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private retryHandler: ((engine: ManagedEngineId) => void) | null = null;

  constructor(private readonly deps: ManagedEngineDeps) {}

  private rt(engine: ManagedEngineId): EngineRuntime {
    let r = this.runtime.get(engine);
    if (!r) {
      r = {
        latest: null, checkedAt: null, release: null, lastError: null,
        failedProbes: undefined, deferred: undefined, inflight: null, reporters: new Set(),
        failStreak: 0, nextRetryAt: null, cancelRetry: null,
      };
      this.runtime.set(engine, r);
    }
    return r;
  }

  /**
   * 받기가 오류로 끝났을 때 부를 자리 — 그 엔진의 자동 업데이트 판단(스위치 · 쓰는 PC 인가 · 최신인가)을 다시 돈다.
   * 부르는 쪽(서버 부팅)이 정한다. 없으면 재시도를 예약하지 않는다.
   */
  setRetryHandler(handler: ((engine: ManagedEngineId) => void) | null): void {
    this.retryHandler = handler;
  }

  /**
   * 받기 한 번이 끝난 뒤 — 오류면 짧은 재시도를 예약하고(5분 → 15분 → 60분, 그 뒤로는 6시간 확인), 성공이면 횟수를 지운다.
   * 점검 탈락 · 지원 밖은 다시 받아도 같으므로 예약하지 않는다.
   */
  private noteOutcome(engine: ManagedEngineId, result: ManagedEnsureResult): void {
    const r = this.rt(engine);
    r.cancelRetry?.();
    r.cancelRetry = null;
    r.nextRetryAt = null;
    if (result.outcome !== 'error') {
      r.failStreak = 0;
      return;
    }
    const delay = MANAGED_ENGINE_RETRY_BACKOFF_MS[r.failStreak];
    r.failStreak += 1;
    if (delay === undefined || !this.retryHandler) return;
    r.nextRetryAt = this.deps.now() + delay;
    r.cancelRetry = this.deps.schedule(() => {
      r.cancelRetry = null;
      r.nextRetryAt = null;
      try {
        this.retryHandler?.(engine);
      } catch (err) {
        logger.warn(`[managedEngine] ${engine} retry failed to start: ${errText(err)}`);
      }
    }, delay);
    logger.info(`[managedEngine] ${engine} will retry in ${String(Math.round(delay / 60_000))} min`);
  }

  /** 상태가 바뀌었을 때 알림(받기 시작 · 끝 · 되돌리기). 해제 함수를 돌려준다. */
  onChange(listener: (engine: ManagedEngineId) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(engine: ManagedEngineId): void {
    for (const l of this.listeners) {
      try {
        l(engine);
      } catch (err) {
        logger.warn(`[managedEngine] listener failed: ${errText(err)}`);
      }
    }
  }

  /** 지금 상태 — 폴더를 훑어 만든다(캐시 ❌ — 사용자가 폴더를 지운 직후에도 화면이 맞아야 한다). */
  status(engine: ManagedEngineId): ManagedEngineStatus {
    const home = this.deps.home();
    const installed = scanManagedVersions(engine, { home, platform: this.deps.platform });
    const { active, previous } = pickManagedVersions(installed);
    const r = this.rt(engine);
    return {
      engine,
      root: managedEngineDirIn(home, engine),
      active,
      previous,
      installed,
      latest: r.latest,
      checkedAt: r.checkedAt,
      platformTarget: this.deps.target(engine),
      updating: r.inflight !== null,
      lastError: r.lastError,
      ...(r.failedProbes && r.failedProbes.length > 0 ? { failedProbes: [...r.failedProbes] } : {}),
      autoUpdate: this.deps.autoUpdateEnabled(engine),
      ...(r.deferred ? { deferred: r.deferred } : {}),
      ...(r.nextRetryAt !== null ? { nextRetryAt: r.nextRetryAt } : {}),
    };
  }

  /** 지금 쓰는 앱 전용 실행본(없으면 null). */
  activeBin(engine: ManagedEngineId): string | null {
    const installed = scanManagedVersions(engine, { home: this.deps.home(), platform: this.deps.platform });
    return pickManagedVersions(installed).active?.binPath ?? null;
  }

  /**
   * 자동 업데이트를 돌려도 되는가. **그 엔진을 쓰지 않는 PC 에는 받지 않는다** — 앱 전용 사본이 이미 있거나,
   * 다른 실행본이 하나라도 있을 때만(= 쓰는 사람이다). 아니면 사용자가 설치 창에서 [설치]를 누를 때 받는다.
   */
  autoGate(engine: ManagedEngineId): ManagedAutoGate {
    const r = this.rt(engine);
    if (!this.deps.autoUpdateEnabled(engine)) return 'disabled';
    if (!this.deps.target(engine)) return 'unsupported';
    const hasManaged = scanManagedVersions(engine, { home: this.deps.home(), platform: this.deps.platform }).length > 0;
    if (!hasManaged && !this.deps.isInUse(engine)) {
      if (r.deferred !== 'not-in-use') {
        r.deferred = 'not-in-use';
        this.emit(engine);
      }
      return 'not-in-use';
    }
    if (r.deferred) {
      r.deferred = undefined;
      this.emit(engine);
    }
    return 'ok';
  }

  /** 최신 판만 확인한다(받지 않는다). 자동 업데이트가 "할 일이 있는가"를 먼저 보는 데 쓴다. */
  async peekLatest(engine: ManagedEngineId): Promise<ManagedPeek> {
    const target = this.deps.target(engine);
    if (!target) return { latest: null, installed: false, rolledBack: false, error: 'unsupported platform' };
    try {
      const rel = await this.lookup(engine, target);
      const installed = scanManagedVersions(engine, { home: this.deps.home(), platform: this.deps.platform });
      const entry = installed.find((e) => e.version === rel.version);
      // 배포처의 최신이 지금 판보다 옛 판이면(문제 판 회수 등) 받을 것이 없다 — "있다"로 답해 진행 칸을 건드리지 않는다.
      const active = pickManagedVersions(installed).active;
      const behindActive = active !== null && compareEngineVersions(rel.version, active.version) < 0;
      return { latest: rel.version, installed: entry !== undefined || behindActive, rolledBack: entry?.rolledBack === true };
    } catch (err) {
      const r = this.rt(engine);
      r.lastError = `release lookup failed: ${errText(err)}`;
      this.emit(engine);
      return { latest: r.latest, installed: false, rolledBack: false, error: r.lastError };
    }
  }

  /**
   * 최신 판을 받아 점검하고 통과하면 바꾼다. `manual`([지금 업데이트]·[설치])은 되돌린 판이라도 표식을 걷고 가고, 자동은 가지 않는다.
   * `report` = 진행 줄(합류한 호출도 그 시점부터 받는다).
   */
  ensureLatest(engine: ManagedEngineId, opts: { manual: boolean; report?: (line: string) => void }): Promise<ManagedEnsureResult> {
    const r = this.rt(engine);
    if (r.inflight) {
      if (opts.report) r.reporters.add(opts.report);
      return r.inflight;
    }
    r.reporters = new Set(opts.report ? [opts.report] : []);
    const say = (line: string): void => {
      for (const fn of r.reporters) {
        try { fn(line); } catch { /* 표시 실패는 작업과 무관 */ }
      }
    };
    r.inflight = this.runEnsure(engine, opts.manual, say)
      .catch((err: unknown): ManagedEnsureResult => this.fail(engine, errText(err), 'error'))
      .then((result) => {
        this.noteOutcome(engine, result);
        return result;
      })
      .finally(() => {
        r.inflight = null;
        r.reporters.clear();
        this.emit(engine);
      });
    this.emit(engine);
    return r.inflight;
  }

  /**
   * [이전 판으로] — 지금 판에 되돌림 표식을 달고 바로 앞 판을 쓴다(다음 스폰부터).
   * 앞 판이 없으면 아무것도 하지 않고 `no-previous`. 받는 중에는 하지 않는다(바꾸는 중인 판을 물리면 꼬인다).
   */
  async rollback(engine: ManagedEngineId): Promise<{ ok: boolean; error?: 'no-previous' | 'busy' | 'failed'; status: ManagedEngineStatus }> {
    const r = this.rt(engine);
    if (r.inflight) return { ok: false, error: 'busy', status: this.status(engine) };
    const home = this.deps.home();
    const { active, previous } = pickManagedVersions(scanManagedVersions(engine, { home, platform: this.deps.platform }));
    if (!active || !previous) return { ok: false, error: 'no-previous', status: this.status(engine) };
    try {
      await fsp.writeFile(
        path.join(managedVersionsDir(engine, home), active.version, MANAGED_ENGINE_ROLLBACK_MARK),
        `${new Date(this.deps.now()).toISOString()}\n`,
        'utf8',
      );
    } catch (err) {
      logger.warn(`[managedEngine] ${engine} rollback mark failed: ${errText(err)}`);
      return { ok: false, error: 'failed', status: this.status(engine) };
    }
    logger.info(`[managedEngine] ${engine} rolled back ${active.version} → ${previous.version}`);
    this.deps.onActiveChanged(engine);
    this.emit(engine);
    return { ok: true, status: this.status(engine) };
  }

  /** 켜 둔 동안 새 판을 주기적으로 확인한다. `tick` 이 엔진별 자동 업데이트 판단을 돈다(부르는 쪽이 정한다). */
  startPeriodic(tick: () => void, intervalMs: number = MANAGED_ENGINE_UPDATE_INTERVAL_MS): void {
    if (this.periodicTimer) return;
    this.periodicTimer = setInterval(() => {
      try { tick(); } catch (err) { logger.warn(`[managedEngine] periodic tick failed: ${errText(err)}`); }
    }, intervalMs);
    // 이 타이머가 프로세스를 붙잡아 종료를 막으면 안 된다.
    (this.periodicTimer as { unref?: () => void }).unref?.();
  }

  stopPeriodic(): void {
    if (this.periodicTimer) clearInterval(this.periodicTimer);
    this.periodicTimer = null;
    for (const r of this.runtime.values()) {
      r.cancelRetry?.();
      r.cancelRetry = null;
      r.nextRetryAt = null;
    }
  }

  // ─── 안쪽 ───

  private fail(engine: ManagedEngineId, message: string, outcome: ManagedEnsureOutcome, extra: Partial<ManagedEnsureResult> = {}): ManagedEnsureResult {
    const r = this.rt(engine);
    r.lastError = message;
    logger.warn(`[managedEngine] ${engine}: ${message}`);
    return { outcome, error: message, ...extra };
  }

  private async lookup(engine: ManagedEngineId, target: string): Promise<EngineRelease> {
    const r = this.rt(engine);
    if (r.release && r.checkedAt !== null && this.deps.now() - r.checkedAt < RELEASE_REUSE_MS) return r.release;
    const rel = engine === 'claude' ? await this.lookupClaude(target) : await this.lookupCodex(target);
    r.release = rel;
    r.latest = rel.version;
    r.checkedAt = this.deps.now();
    return rel;
  }

  /** Claude Code — `latest` 포인터 → `<판>/manifest.json` → 그 플랫폼의 실행본 · SHA-256 · 크기. */
  private async lookupClaude(target: string): Promise<EngineRelease> {
    const version = (await this.deps.fetchText(`${CLAUDE_RELEASES_BASE_URL}/latest`)).trim();
    // 지역 차단 등으로 HTML 이 오면 그 글자가 판 이름으로 들어가지 않게 막는다(공식 인스톨러와 같은 방어).
    if (!isEngineVersion(version)) throw new Error(`unexpected release pointer "${version.slice(0, 40)}"`);
    const manifest = (await this.deps.fetchJson(`${CLAUDE_RELEASES_BASE_URL}/${version}/manifest.json`)) as {
      platforms?: Record<string, { binary?: unknown; checksum?: unknown; size?: unknown }>;
    } | null;
    const p = manifest?.platforms?.[target];
    const checksum = typeof p?.checksum === 'string' ? p.checksum.toLowerCase() : '';
    if (!/^[a-f0-9]{64}$/.test(checksum)) throw new Error(`no checksum for ${target} in manifest ${version}`);
    const fileName = typeof p?.binary === 'string' && /^[\w.-]+$/.test(p.binary)
      ? p.binary
      : target.startsWith('win32') ? 'claude.exe' : 'claude';
    return {
      version,
      url: `${CLAUDE_RELEASES_BASE_URL}/${version}/${target}/${fileName}`,
      sha256: checksum,
      size: typeof p?.size === 'number' && p.size > 0 ? p.size : 0,
      fileName,
    };
  }

  /** 코덱스 — GitHub 최신 릴리스 → `codex-package-<타깃>.tar.gz` · SHA-256(자산 `digest`, 없으면 SUMS 파일). */
  private async lookupCodex(target: string): Promise<EngineRelease> {
    const headers = { accept: 'application/vnd.github+json' };
    const rel = (await this.deps.fetchJson(CODEX_RELEASES_LATEST_API, headers)) as {
      tag_name?: unknown;
      assets?: Array<{ name?: unknown; browser_download_url?: unknown; size?: unknown; digest?: unknown }>;
    } | null;
    const tag = typeof rel?.tag_name === 'string' ? rel.tag_name : '';
    if (!tag.startsWith(CODEX_RELEASE_TAG_PREFIX)) throw new Error(`unexpected release tag "${tag.slice(0, 40)}"`);
    const version = tag.slice(CODEX_RELEASE_TAG_PREFIX.length);
    if (!isEngineVersion(version)) throw new Error(`unexpected release version "${version.slice(0, 40)}"`);
    const assets = Array.isArray(rel?.assets) ? rel.assets : [];
    const fileName = `${CODEX_PACKAGE_ASSET_PREFIX}${target}.tar.gz`;
    const asset = assets.find((a) => a.name === fileName);
    const url = typeof asset?.browser_download_url === 'string' ? asset.browser_download_url : '';
    if (!asset || !url) throw new Error(`no ${fileName} in release ${tag}`);
    let sha = parseAssetSha256(typeof asset.digest === 'string' ? asset.digest : undefined) ?? '';
    if (!sha) {
      const sums = assets.find((a) => a.name === CODEX_PACKAGE_CHECKSUM_ASSET);
      const sumsUrl = typeof sums?.browser_download_url === 'string' ? sums.browser_download_url : '';
      if (sumsUrl) {
        const text = await this.deps.fetchText(sumsUrl);
        for (const line of text.split(/\r?\n/)) {
          const m = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line.trim());
          if (m && m[2]?.trim() === fileName) sha = (m[1] ?? '').toLowerCase();
        }
      }
    }
    if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error(`no SHA-256 for ${fileName} in release ${tag}`);
    return { version, url, sha256: sha, size: typeof asset.size === 'number' && asset.size > 0 ? asset.size : 0, fileName };
  }

  private async runEnsure(engine: ManagedEngineId, manual: boolean, say: (line: string) => void): Promise<ManagedEnsureResult> {
    const r = this.rt(engine);
    const label = ENGINE_LABEL[engine];
    const target = this.deps.target(engine);
    if (!target) {
      return this.fail(engine, `${label} has no official build for ${this.deps.platform}/${process.arch}`, 'unsupported');
    }
    say(`Checking the latest ${label} release…`);
    let rel: EngineRelease;
    try {
      rel = await this.lookup(engine, target);
    } catch (err) {
      return this.fail(engine, `release lookup failed: ${errText(err)}`, 'error');
    }

    const home = this.deps.home();
    const versionsDir = managedVersionsDir(engine, home);
    const installed = scanManagedVersions(engine, { home, platform: this.deps.platform });
    const existing = installed.find((e) => e.version === rel.version);
    if (existing) {
      if (existing.rolledBack && !manual) {
        const current = pickManagedVersions(installed).active?.version;
        say(`${label} ${rel.version} was rolled back — staying on ${current ?? '?'}`);
        r.lastError = null;
        r.failedProbes = undefined;
        return { outcome: 'skipped-rolled-back', ...(current ? { version: current } : {}) };
      }
      if (existing.rolledBack) {
        // 사용자가 직접 [지금 업데이트]를 눌렀다 — 되돌림 표식을 걷고 그 판으로 간다.
        await fsp.rm(path.join(versionsDir, existing.version, MANAGED_ENGINE_ROLLBACK_MARK), { force: true });
        this.deps.onActiveChanged(engine);
        say(`Using ${label} ${rel.version} again`);
      } else {
        say(`${label} ${rel.version} is already the latest`);
      }
      r.lastError = null;
      r.failedProbes = undefined;
      return { outcome: existing.rolledBack ? 'installed' : 'up-to-date', version: rel.version, binPath: existing.binPath };
    }

    // 배포처의 최신이 지금 판보다 옛 판이면(회수 등) 받지 않는다 — 받아도 디스크만 쓴다.
    const current = pickManagedVersions(installed).active;
    if (current && compareEngineVersions(rel.version, current.version) < 0) {
      say(`The latest ${label} release (${rel.version}) is older than ${current.version} — keeping ${current.version}`);
      r.lastError = null;
      r.failedProbes = undefined;
      return { outcome: 'up-to-date', version: current.version, binPath: current.binPath };
    }

    let staged: { dir: string; bin: string };
    try {
      staged = await this.stage(engine, target, rel, say);
    } catch (err) {
      return this.fail(engine, errText(err), 'error', { version: rel.version });
    }

    say(`Checking that ${label} ${rel.version} accepts every option Vibisual uses…`);
    const failures = await this.probe(engine, staged.bin, rel.version);
    if (failures.length > 0) {
      r.failedProbes = failures.map((f) => f.label);
      const head = failures.slice(0, 3).map((f) => `${f.label} (${f.reason})`).join('; ');
      say(`${label} ${rel.version} was not switched in — ${failures.length} check(s) failed: ${head}`);
      return this.fail(engine, `${label} ${rel.version} rejected ${failures.length} option(s): ${head}`, 'probe-failed', {
        version: rel.version,
        failedProbes: [...r.failedProbes],
      });
    }

    const finalDir = path.join(versionsDir, rel.version);
    try {
      await fsp.mkdir(versionsDir, { recursive: true });
      if (fs.existsSync(finalDir)) {
        await fsp.rm(staged.dir, { recursive: true, force: true });
      } else {
        await this.renameWithRetry(staged.dir, finalDir);
      }
    } catch (err) {
      return this.fail(engine, `could not activate ${rel.version}: ${errText(err)}`, 'error', { version: rel.version });
    }
    const binPath = findManagedBinIn(finalDir, engine, this.deps.platform) ?? undefined;
    this.deps.onActiveChanged(engine);
    r.lastError = null;
    r.failedProbes = undefined;
    await this.prune(engine);
    logger.info(`[managedEngine] ${engine} now ${rel.version} (${binPath ?? '?'})`);
    say(`Now using ${label} ${rel.version}`);
    return { outcome: 'installed', version: rel.version, ...(binPath ? { binPath } : {}) };
  }

  /**
   * 받아 `staging/<판>` 에 둔다. 앞서 받아 둔 것이 그대로 있으면(점검에서 떨어졌던 판) 다시 받지 않는다 —
   * 앱이 고쳐져 들어오면 점검만 다시 해 통과한다.
   */
  private async stage(engine: ManagedEngineId, target: string, rel: EngineRelease, say: (line: string) => void): Promise<{ dir: string; bin: string }> {
    const label = ENGINE_LABEL[engine];
    const home = this.deps.home();
    const stagingRoot = managedStagingDir(engine, home);
    const stagedDir = path.join(stagingRoot, rel.version);

    const prevMeta = readManagedMeta(stagedDir);
    const prevBin = findManagedBinIn(stagedDir, engine, this.deps.platform);
    if (prevMeta && prevMeta.version === rel.version && prevMeta.sha256 === rel.sha256 && prevBin && this.deps.shortfall(prevBin) === 0) {
      say(`Using the ${label} ${rel.version} download kept from the last check`);
      return { dir: stagedDir, bin: prevBin };
    }

    await fsp.rm(stagedDir, { recursive: true, force: true });
    await fsp.mkdir(stagingRoot, { recursive: true });
    if (rel.size > 0) {
      const free = this.deps.freeBytes(stagingRoot);
      const need = rel.size * MANAGED_ENGINE_DISK_HEADROOM_RATIO;
      if (free !== null && free < need) {
        throw new Error(`not enough disk space for ${label} ${rel.version} (need ${formatMiB(need)}, free ${formatMiB(free)})`);
      }
    }

    // 앞선 실행이 남긴 받기 조각을 걷는다 — 같은 엔진의 받기는 한 번에 하나라, 지금 남아 있는 조각은 전부 끝난 일의 것이다.
    await this.removeStaleParts(stagingRoot);
    const part = await fsp.mkdtemp(path.join(stagingRoot, `${rel.version}.part-`));
    const archive = engine === 'codex' ? path.join(stagingRoot, `${rel.version}-${randomUUID()}.tar.gz`) : null;
    try {
      const file = archive ?? path.join(part, rel.fileName);
      say(`Downloading ${label} ${rel.version}${rel.size > 0 ? ` (${formatMiB(rel.size)})` : ''}…`);
      let lastDecile = -1;
      const got = await this.deps.download(rel.url, file, (received, total) => {
        const all = total > 0 ? total : rel.size;
        if (all <= 0) return;
        // 줄은 10% 마다 하나 — 진행 칸이 줄로 도배되지 않게.
        const decile = Math.min(10, Math.floor((received / all) * 10));
        if (decile > lastDecile) {
          lastDecile = decile;
          if (decile > 0) say(`Downloading ${label} ${rel.version}… ${decile * 10}% (${formatMiB(received)} / ${formatMiB(all)})`);
        }
      });
      if (rel.size > 0) {
        const size = fs.statSync(file).size;
        if (size !== rel.size) throw new Error(`download size mismatch for ${rel.fileName} (${size} / ${rel.size} bytes)`);
      }
      say('Verifying the download…');
      // 지문 둘은 받기 도우미가 냈다(⑬) — 받은 바이트 · 다 쓴 파일. 큰 파일을 앱 안에서 다시 읽지 않는다.
      if (got.streamSha256 !== rel.sha256) {
        throw new Error(
          `checksum mismatch for ${rel.fileName}: expected ${rel.sha256.slice(0, 16)}…, got ${got.streamSha256.slice(0, 16)}… — the received bytes differ from the release`,
        );
      }
      if (got.fileSha256 !== got.streamSha256) {
        throw new Error(
          `${rel.fileName} was corrupted while writing to disk (received ${got.streamSha256.slice(0, 16)}…, on disk ${got.fileSha256.slice(0, 16)}…) — try again`,
        );
      }

      let root = part;
      if (archive) {
        say(`Unpacking ${label} ${rel.version}…`);
        await this.deps.extract(archive, part);
        // 자산에 따라 한 겹 아래에 풀릴 수 있다 — 그 폴더를 판 폴더로 삼는다.
        if (!findManagedBinIn(part, engine, this.deps.platform)) {
          const nested = fs.readdirSync(part, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => path.join(part, d.name))
            .find((d) => findManagedBinIn(d, engine, this.deps.platform) !== null);
          if (nested) root = nested;
        }
      }

      const bin = findManagedBinIn(root, engine, this.deps.platform)
        ?? (this.deps.platform !== 'win32' ? this.chmodAndFind(root, engine) : null);
      if (!bin) throw new Error(`${label} executable not found after download`);
      if (this.deps.platform !== 'win32') await fsp.chmod(bin, 0o755);
      const short = this.deps.shortfall(bin);
      if (short > 0) throw new Error(`${label} executable is incomplete (missing ${short} bytes) — try again`);

      const meta: ManagedEngineMeta = {
        engine,
        version: rel.version,
        platformTarget: target,
        sha256: rel.sha256,
        source: rel.url,
        size: rel.size,
        installedAt: this.deps.now(),
      };
      await fsp.writeFile(path.join(root, MANAGED_ENGINE_META_NAME), JSON.stringify(meta, null, 2), 'utf8');
      await this.renameWithRetry(root, stagedDir);
      if (root !== part) await fsp.rm(part, { recursive: true, force: true }).catch(() => undefined);
      const stagedBin = findManagedBinIn(stagedDir, engine, this.deps.platform);
      if (!stagedBin) throw new Error(`${label} executable vanished while staging`);
      return { dir: stagedDir, bin: stagedBin };
    } catch (err) {
      await fsp.rm(part, { recursive: true, force: true }).catch(() => undefined);
      throw err;
    } finally {
      if (archive) await fsp.rm(archive, { force: true }).catch(() => undefined);
    }
  }

  /** 앞선 실행이 남긴 받기 조각(`<판>.part-*` 폴더 · 받다 만 `*.tar.gz`)을 걷는다. 붙잡혀 못 지우면 그대로 둔다(새 조각은 새 이름이다). */
  private async removeStaleParts(stagingRoot: string): Promise<void> {
    let names: string[] = [];
    try {
      names = await fsp.readdir(stagingRoot);
    } catch {
      return;
    }
    for (const name of names) {
      if (!/\.part-|\.tar\.gz$/.test(name)) continue;
      await fsp.rm(path.join(stagingRoot, name), { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** POSIX 에서 풀린 실행본에 실행 권한이 빠졌으면(받은 그대로가 644 인 자산) 채우고 다시 찾는다. */
  private chmodAndFind(root: string, engine: ManagedEngineId): string | null {
    const exe = engine === 'claude' ? ['claude'] : ['bin/codex', 'codex'];
    for (const rel of exe) {
      const file = path.join(root, ...rel.split('/'));
      try {
        if (fs.statSync(file).isFile()) {
          fs.chmodSync(file, 0o755);
          return findManagedBinIn(root, engine, this.deps.platform);
        }
      } catch { /* 없음 */ }
    }
    return null;
  }

  /** 점검 — `--version` 이 그 판을 말하고, 우리 인자를 전부 받아야 한다. 빈 임시 설정 홈에서 돈다. */
  private async probe(engine: ManagedEngineId, bin: string, version: string): Promise<ProbeOutcome['failures']> {
    const work = await fsp.mkdtemp(path.join(this.deps.tmpDir(), `vibisual-${engine}-probe-`));
    const isolatedHome = path.join(work, 'home');
    const scratchDir = path.join(work, 'scratch');
    try {
      await fsp.mkdir(isolatedHome, { recursive: true });
      await fsp.mkdir(scratchDir, { recursive: true });
      // 경로를 받는 플래그가 실재하는 빈 설정을 가리키게 한다(없는 파일이라 떨어지는 오판을 막는다).
      await fsp.writeFile(path.join(scratchDir, 'mcp.json'), JSON.stringify({ mcpServers: {} }), 'utf8');
      await fsp.writeFile(path.join(scratchDir, 'settings.json'), '{}', 'utf8');
      const opts: ProbeRunOptions = { isolatedHome, scratchDir, platform: this.deps.platform };
      let versionError = await this.deps.probeVersion(engine, bin, version, opts);
      for (let i = 0; versionError && i < 2; i += 1) {
        // 갓 쓴 실행본을 백신이 훑는 동안 실행이 한 번 막히는 일이 있다 — 한 박자 쉬고 다시 묻는다.
        await this.deps.sleep(2_000);
        versionError = await this.deps.probeVersion(engine, bin, version, opts);
      }
      if (versionError) return [{ label: '--version', reason: versionError }];
      const cases = engine === 'claude'
        ? [...claudeFlagProbeCases(scratchDir), ...claudeSubcommandProbeCases(scratchDir)]
        : codexProbeCases(scratchDir);
      const { failures } = await this.deps.runProbes(engine, bin, cases, opts);
      return failures;
    } finally {
      await fsp.rm(work, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** 같은 볼륨 안 옮기기 — 백신이 갓 쓴 실행본을 붙잡고 있으면 잠깐 기다렸다 다시 한다(Windows). */
  private async renameWithRetry(from: string, to: string): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await fsp.rename(from, to);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException | null)?.code;
        if (attempt >= BUSY_RETRY_MAX || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err;
        await this.deps.sleep(BUSY_RETRY_DELAY_MS);
      }
    }
  }

  /** 지금 판 + 앞 판(+ 지금보다 새로 되돌린 판)만 남기고, 받아 둔 대기본도 최신 것 말고는 걷는다. */
  private async prune(engine: ManagedEngineId): Promise<void> {
    const home = this.deps.home();
    const installed = scanManagedVersions(engine, { home, platform: this.deps.platform });
    for (const e of managedVersionsToPrune(installed)) {
      await fsp.rm(path.join(managedVersionsDir(engine, home), e.version), { recursive: true, force: true }).catch((err: unknown) => {
        // 도는 세션이 붙잡고 있으면(Windows) 지우지 못한다 — 다음 확인 때 다시 한다.
        logger.info(`[managedEngine] ${engine} ${e.version} still in use — will retry later (${errText(err)})`);
      });
    }
    const stagingRoot = managedStagingDir(engine, home);
    let names: string[] = [];
    try { names = await fsp.readdir(stagingRoot); } catch { return; }
    const keep = this.rt(engine).latest;
    for (const name of names) {
      if (keep && name === keep && !installed.some((e) => e.version === keep)) continue;
      await fsp.rm(path.join(stagingRoot, name), { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

// ─── 기본 의존 ───

async function fetchOk(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const res = await fetch(url, {
    headers: { 'user-agent': 'vibisual', ...headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(MANAGED_ENGINE_LOOKUP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res;
}

function freeBytesOf(dir: string): number | null {
  try {
    const statfs = (fs as unknown as { statfsSync?: (p: string) => { bavail: number | bigint; bsize: number | bigint } }).statfsSync;
    if (!statfs) return null;
    const s = statfs(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

export const managedEngineService = new ManagedEngineService({
  home: () => os.homedir(),
  platform: process.platform,
  target: (engine) => hostPlatformTarget(engine),
  fetchText: async (url, headers) => (await fetchOk(url, headers)).text(),
  fetchJson: async (url, headers) => (await fetchOk(url, headers)).json(),
  download: (url, dest, onBytes) => downloadTo(url, dest, onBytes),
  extract: (archive, destDir) => extractArchive(archive, destDir),
  shortfall: (file) => imageShortfall(file),
  freeBytes: (dir) => freeBytesOf(dir),
  probeVersion: (engine, bin, version, opts) => probeEngineVersion(engine, bin, version, opts),
  runProbes: (engine, bin, cases, opts) => runEngineProbes(engine, bin, cases, opts),
  tmpDir: () => os.tmpdir(),
  isInUse: (engine) => {
    try {
      if (engine === 'claude') return discoverAllClaudeBins().some((c) => c.source !== 'managed');
      return resolveBinary('codex', codexStandaloneCandidatesIn(process.platform, process.env, os.homedir())) !== null;
    } catch {
      return false;
    }
  },
  autoUpdateEnabled: (engine) => {
    const d = userDefaultsService.get();
    return engine === 'claude' ? d.claudeAutoUpdate?.enabled !== false : d.codexAutoUpdate?.enabled !== false;
  },
  onActiveChanged: (engine) => {
    if (engine === 'claude') invalidateClaudeBinCache();
    else invalidateCodexBinCache();
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  schedule: (fn, ms) => {
    const timer = setTimeout(fn, ms);
    // 이 예약이 프로세스를 붙잡아 종료를 막으면 안 된다.
    (timer as { unref?: () => void }).unref?.();
    return () => clearTimeout(timer);
  },
});
