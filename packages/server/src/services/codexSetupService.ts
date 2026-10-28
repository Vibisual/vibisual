import { randomUUID } from 'node:crypto';
import {
  CODEX_SETUP_INSTALL_COMMAND_WIN,
  CODEX_SETUP_INSTALL_COMMAND_POSIX,
  CODEX_SETUP_DOCS_URL,
  CODEX_SETUP_PROBE_TIMEOUT_MS,
  CODEX_SETUP_INSTALL_TIMEOUT_MS,
  CODEX_SETUP_VERIFY_RETRY_INTERVAL_MS,
  CODEX_SETUP_VERIFY_RETRY_MAX,
  CODEX_SETUP_OUTPUT_MAX_CHARS,
} from '@vibisual/shared';
import type { CodexBinSource, CodexInstall, CodexInstallsInfo, CodexSetupState, CodexSetupProgress, ManagedEngineStatus, WSMessage } from '@vibisual/shared';
import { codexBinOverride, discoverCodexBins, getCodexBin, invalidateCodexBinCache, readCodexBinOverride, runCodexCli, parseCodexVersion } from './codexCli.js';
import { samePath } from './pathKey.js';
import { managedEngineService, type ManagedAutoGate, type ManagedEnsureResult, type ManagedPeek } from './managedEngineService.js';
import { broadcast } from '../broadcastBus.js';
import { logger } from '../logger.js';

/**
 * §5.25 (D) — 코덱스 CLI 설치의 서버 창구. `claudeSetupService` 와 같은 규약: "직접 설치" 명령 문자열은 한 곳에서 조립하고,
 * 받기 완료가 아니라 `--version` 이 실제로 도는지로 성공을 판정하며, 설치 완료는 REST 응답이 아니라 리스너로 화면에 전한다.
 * §4 앱 전용 엔진 — [설치]는 `openai/codex`(Apache-2.0) GitHub 릴리스 패키지를 SHA-256 대조 후 `~/.vibisual/cli-engines/codex` 에 풀고, 쓰는 하위 명령을 전부 받는지
 * 점검한 뒤 쓴다(`managedEngineService`). 앱에 동봉하지 않는다(받아서 설치). 공식 명령(https://learn.chatgpt.com/docs/codex/cli)은 받기 실패 시의 손 경로로 화면에 남는다.
 * 이미 쓸 수 있는 코덱스가 있으면(업데이트) 단계를 `installing` 으로 바꾸지 않는다 — 설치 창이 다시 뜨지 않게. 진행은 `codex_setup_progress` 로 흐른다.
 */

/**
 * 플랫폼을 주입해 세 OS 를 시험한다. npm 존재 여부는 설치의 조건이 아니다.
 */
export function isCodexAutoInstallSupported(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32' || platform === 'darwin' || platform === 'linux';
}

/** 화면의 "직접 설치" 안내(받기가 실패했을 때의 손 경로) — 공식 독립 설치 명령. */
export function buildCodexSetupInstallCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? CODEX_SETUP_INSTALL_COMMAND_WIN : CODEX_SETUP_INSTALL_COMMAND_POSIX;
}

/** 앱 전용 받기 창구 — 시험이 갈아 끼운다(네트워크 · 디스크 없이 설치 흐름만 본다). */
export interface CodexEngineInstaller {
  ensureLatest(opts: { manual: boolean; report?: (line: string) => void }): Promise<ManagedEnsureResult>;
  status(): ManagedEngineStatus | undefined;
  autoGate(): ManagedAutoGate;
  peekLatest(): Promise<ManagedPeek>;
}

const managedCodexInstaller: CodexEngineInstaller = {
  ensureLatest: (opts) => managedEngineService.ensureLatest('codex', opts),
  status: () => managedEngineService.status('codex'),
  autoGate: () => managedEngineService.autoGate('codex'),
  peekLatest: () => managedEngineService.peekLatest('codex'),
};

interface SetupSession {
  setupId: string;
  startedAt: number;
  status: CodexSetupProgress['status'];
  output: string;
  exitCode?: number;
  binPath?: string;
  version?: string;
  error?: string;
  /** 쓸 수 있는 코덱스가 이미 있던 상태에서 시작했나(= 업데이트) — 단계를 `installing` 으로 바꾸지 않는다. */
  update: boolean;
}

type StateListener = (state: CodexSetupState) => void;

export class CodexSetupService {
  private cached: CodexSetupState | null = null;
  private inflightRefresh: Promise<CodexSetupState> | null = null;
  private install: SetupSession | null = null;
  private listeners = new Set<StateListener>();

  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly installer: CodexEngineInstaller = managedCodexInstaller,
    /** 사용자가 Version 탭에서 보조로 고른 실행본(쓸 수 있을 때만) — 시험이 실제 설정 파일을 읽지 않게 주입한다. */
    private readonly selectedBin: () => string | null = () => codexBinOverride(),
  ) {}

  get(): CodexSetupState | null {
    return this.cached;
  }

  getProgress(): CodexSetupProgress | null {
    return this.install ? toProgress(this.install) : null;
  }

  onChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(state: CodexSetupState): void {
    this.cached = state;
    for (const l of this.listeners) {
      try {
        l(state);
      } catch (err) {
        logger.warn(`[codexSetup] listener failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private baseState(): Omit<CodexSetupState, 'phase'> {
    let managed: ManagedEngineStatus | undefined;
    try {
      managed = this.installer.status();
    } catch {
      managed = undefined;
    }
    return {
      canAutoInstall: isCodexAutoInstallSupported(this.platform),
      installCommand: buildCodexSetupInstallCommand(this.platform),
      docsUrl: CODEX_SETUP_DOCS_URL,
      checkedAt: Date.now(),
      // §4 (앱 전용 엔진) — Version 탭 코덱스 칸(지금 판 · 앞 판 · 공식 배포처 최신 · 실패 사유 · 자동 업데이트).
      ...(managed ? { managed } : {}),
    };
  }

  /** 현재 실행본을 판정해 상태를 갱신한다. 실패해도 throw 하지 않는다. */
  async refresh(): Promise<CodexSetupState> {
    if (this.inflightRefresh) return this.inflightRefresh;
    // 수동 설치 후 [다시 확인]도 앱 재시작 없이 새 실행본을 찾아야 한다.
    // 자동 설치 종료에서만 지우면 처음 캐시한 null 이 영구히 남는다.
    invalidateCodexBinCache();
    this.inflightRefresh = this.probe().finally(() => {
      this.inflightRefresh = null;
    });
    return this.inflightRefresh;
  }

  private async probe(): Promise<CodexSetupState> {
    const binPath = getCodexBin();
    const version = binPath ? await probeCodexVersion() : undefined;
    const base = this.baseState();

    if (binPath && version) {
      const next: CodexSetupState = { ...base, phase: 'ready', binPath, version };
      this.emit(next);
      return next;
    }

    // 설치가 도는 중이면 "없음"이 아니라 "설치 중"이다(게이트가 진행 화면을 유지하도록).
    const running = this.install && (this.install.status === 'starting' || this.install.status === 'running');
    const failed = this.install?.status === 'error';
    const next: CodexSetupState = {
      ...base,
      phase: running ? 'installing' : failed ? 'failed' : 'missing',
      ...(failed && this.install?.error ? { error: this.install.error } : {}),
    };
    this.emit(next);
    return next;
  }

  /** 설치(또는 업데이트) 실행. 이미 도는 중이면 같은 진행 상태를 돌려준다(여러 창에서 눌러도 받기는 한 번). `manual=false` 는 켤 때 · 6시간 자동 확인 — 사용자가 되돌린 판으로 다시 가지 않는다. */
  startInstall(opts: { manual?: boolean } = {}): CodexSetupProgress {
    if (this.install && (this.install.status === 'starting' || this.install.status === 'running')) {
      return toProgress(this.install);
    }

    const update = this.cached?.phase === 'ready';
    const session: SetupSession = {
      setupId: randomUUID(),
      startedAt: Date.now(),
      status: 'starting',
      output: '',
      update,
    };
    this.install = session;

    if (!isCodexAutoInstallSupported(this.platform)) {
      session.status = 'error';
      session.error = `Automatic install is not supported on ${this.platform}. See ${CODEX_SETUP_DOCS_URL}`;
      this.pushProgress(session);
      void this.refresh();
      return toProgress(session);
    }

    logger.info(`[codexSetup] ${update ? 'updating' : 'installing'} the app-managed Codex`);
    session.status = 'running';
    this.pushProgress(session);
    if (!update) this.emitInstallingState();

    const appendOutput = (line: string): void => {
      if (this.install !== session) return;
      const next = `${session.output}${line}\n`;
      session.output =
        next.length > CODEX_SETUP_OUTPUT_MAX_CHARS ? next.slice(-CODEX_SETUP_OUTPUT_MAX_CHARS) : next;
      this.pushProgress(session);
    };

    // 받기는 회선에 따라 오래 걸릴 수 있다 — 상한은 종전 설치 스크립트와 같은 값이다.
    const timer = setTimeout(() => {
      this.finishInstall(session, {
        status: 'error',
        error: `install timed out after ${CODEX_SETUP_INSTALL_TIMEOUT_MS}ms`,
      });
    }, CODEX_SETUP_INSTALL_TIMEOUT_MS);

    let pending: Promise<ManagedEnsureResult>;
    try {
      pending = this.installer.ensureLatest({ manual: opts.manual !== false, report: appendOutput });
    } catch (err) {
      clearTimeout(timer);
      this.finishInstall(session, { status: 'error', error: err instanceof Error ? err.message : String(err) });
      return toProgress(session);
    }
    void pending.then(
      (result) => {
        clearTimeout(timer);
        if (this.install !== session || session.status !== 'running') return;
        const ok = result.outcome === 'installed' || result.outcome === 'up-to-date' || result.outcome === 'skipped-rolled-back';
        session.exitCode = ok ? 0 : 1;
        if (!ok) {
          this.finishInstall(session, { status: 'error', error: result.error ?? 'install failed' });
          return;
        }
        // 받기가 끝난 것을 곧바로 성공으로 단정하지 않는다 — `--version` 이 실제로 도는지가 유일한 근거다.
        void this.verifyAfterInstall(session);
      },
      (err: unknown) => {
        clearTimeout(timer);
        this.finishInstall(session, { status: 'error', error: err instanceof Error ? err.message : String(err) });
      },
    );

    return toProgress(session);
  }

  /**
   * §4 (앱 전용 엔진) — 켤 때 · 켜 둔 동안 6시간마다 코덱스 앱 전용 사본을 최신으로 맞춘다.
   * 스위치(`UserDefaults.codexAutoUpdate`)가 꺼져 있거나, 코덱스를 쓰지 않는 PC 면 받지 않는다.
   * 먼저 최신 판만 보고 이미 있으면 진행 칸을 건드리지 않는다(매번 "끝남"이 뜨지 않게).
   */
  async autoUpdateIfEnabled(): Promise<{ started: boolean; reason?: string }> {
    // 사용자가 다른 설치본을 보조로 골라 두었으면 그 설치본의 갱신은 그 주인의 것이다 — 앱 전용 사본도 받지 않는다
    //   (Claude 에서 자기 설치본을 고르면 앱 전용을 건드리지 않는 것과 같다). 기본으로 돌아오면 다음 확인부터 받는다.
    if (this.selectedBin()) return { started: false, reason: 'user-selected' };
    const gate = this.installer.autoGate();
    if (gate !== 'ok') {
      void this.refresh().catch(() => undefined); // 미뤄 둔 이유(deferred)를 화면에 싣는다
      return { started: false, reason: gate };
    }
    const peek = await this.installer.peekLatest();
    if (peek.error) return { started: false, reason: 'lookup-failed' };
    if (peek.installed) return { started: false, reason: peek.rolledBack ? 'rolled-back' : 'up-to-date' };
    // 부팅 판정이 아직이면(창 표시가 늦어 밀린 경우) 먼저 마친다 — 판정 전이면 깔려 있는 코덱스를 "없음"으로 보고
    //   설치 창 단계(`installing`)를 띄우게 된다. 업데이트는 쓸 수 있는 코덱스가 있다는 판정 위에서만 조용하다.
    if (!this.cached) await this.refresh().catch(() => undefined);
    logger.info(`[codexSetup] app-managed update: → ${peek.latest ?? '?'}`);
    this.startInstall({ manual: false });
    return { started: true };
  }

  private async verifyAfterInstall(session: SetupSession): Promise<void> {
    for (let attempt = 0; attempt < CODEX_SETUP_VERIFY_RETRY_MAX; attempt++) {
      if (this.install !== session || session.status !== 'running') return;
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, CODEX_SETUP_VERIFY_RETRY_INTERVAL_MS));
      }
      if (this.install !== session || session.status !== 'running') return;
      // 방금 깔린 실행본은 캐시된 판정과 다르다 — 매 시도마다 다시 푼다. 이게 있어야
      //   **재시작 없이** 바로 로그인 단계로 넘어갈 수 있다.
      invalidateCodexBinCache();
      const binPath = getCodexBin();
      if (binPath) {
        const version = await probeCodexVersion();
        if (version) {
          this.finishInstall(session, { status: 'done', binPath, version });
          return;
        }
      }
    }
    const tail = session.output.trim().slice(-300);
    this.finishInstall(session, {
      status: 'error',
      error: tail || `install finished with code ${String(session.exitCode)} but no working codex was found`,
    });
  }

  private finishInstall(
    session: SetupSession,
    patch: { status: 'done' | 'error'; error?: string; binPath?: string; version?: string },
  ): void {
    if (this.install !== session) return;
    if (session.status === 'done' || session.status === 'error') return;
    session.status = patch.status;
    if (patch.error !== undefined) session.error = patch.error;
    if (patch.binPath !== undefined) session.binPath = patch.binPath;
    if (patch.version !== undefined) session.version = patch.version;
    if (patch.status === 'done') {
      logger.info(`[codexSetup] installed ${patch.version ?? '?'} at ${patch.binPath ?? '?'}`);
    } else {
      logger.warn(`[codexSetup] install failed: ${patch.error ?? 'unknown'}`);
    }
    this.pushProgress(session);
    void this.refresh();
  }

  private emitInstallingState(): void {
    const prev = this.cached;
    this.emit({
      ...this.baseState(),
      phase: 'installing',
      ...(prev?.binPath ? { binPath: prev.binPath } : {}),
    });
  }

  private pushProgress(session: SetupSession): void {
    const msg: WSMessage = {
      type: 'codex_setup_progress',
      timestamp: Date.now(),
      payload: toProgress(session),
    };
    broadcast(msg);
  }
}

/** `codex --version` 을 실제로 돌려 버전을 얻는다. 못 얻으면 undefined. */
async function probeCodexVersion(): Promise<string | undefined> {
  const res = await runCodexCli(['--version'], CODEX_SETUP_PROBE_TIMEOUT_MS);
  if (res.failure || res.code !== 0) return undefined;
  return parseCodexVersion(res.out);
}

/**
 * §4 (앱 전용 엔진) ④ — `GET /api/codex-installs`. Version 탭 코덱스 칸의 고르기 목록: 앱 전용(기본) · 고른 것 ·
 * PATH · 공식 독립 설치 위치, 각자 `--version` 으로 판을 확인한다(동시에). Claude 의 `getClaudeInstallsInfo` 와 같은 모양.
 */
export async function getCodexInstallsInfo(
  deps: {
    discover?: () => Array<{ binPath: string; source: CodexBinSource }>;
    activeBin?: () => string | null;
    overridePath?: () => string | null;
    managed?: () => ManagedEngineStatus | undefined;
    probe?: (binPath: string) => Promise<{ version: string | null; error?: string }>;
  } = {},
): Promise<CodexInstallsInfo> {
  const active = (deps.activeBin ?? getCodexBin)();
  const overridePath = (deps.overridePath ?? readCodexBinOverride)();
  const found = (deps.discover ?? discoverCodexBins)();
  const probe = deps.probe ?? (async (binPath: string) => {
    const r = await runCodexCli(['--version'], CODEX_SETUP_PROBE_TIMEOUT_MS, { binPath });
    const version = !r.failure && r.code === 0 ? parseCodexVersion(r.out) ?? null : null;
    if (version) return { version };
    return { version: null, error: r.failure === 'timeout' ? 'version check timed out' : r.failure === 'spawn' ? 'could not run' : `exit ${String(r.code)}` };
  });
  const installs: CodexInstall[] = await Promise.all(found.map(async (c): Promise<CodexInstall> => {
    const det = await probe(c.binPath);
    return {
      binPath: c.binPath,
      source: c.source,
      version: det.version,
      ...(det.error ? { detectError: det.error } : {}),
      active: !!active && samePath(c.binPath, active),
      selected: !!overridePath && samePath(c.binPath, overridePath),
    };
  }));
  let managed: ManagedEngineStatus | undefined;
  try {
    managed = (deps.managed ?? (() => managedEngineService.status('codex')))();
  } catch {
    managed = undefined;
  }
  return { installs, overridePath, ...(managed ? { managed } : {}), scannedAt: Date.now() };
}

function toProgress(s: SetupSession): CodexSetupProgress {
  return {
    setupId: s.setupId,
    status: s.status,
    output: s.output,
    ...(s.exitCode !== undefined ? { exitCode: s.exitCode } : {}),
    ...(s.binPath !== undefined ? { binPath: s.binPath } : {}),
    ...(s.version !== undefined ? { version: s.version } : {}),
    ...(s.error !== undefined ? { error: s.error } : {}),
  };
}

export const codexSetupService = new CodexSetupService();
