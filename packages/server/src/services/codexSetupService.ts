import { spawn } from 'node:child_process';
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
import type { CodexSetupState, CodexSetupProgress, WSMessage } from '@vibisual/shared';
import { getCodexBin, invalidateCodexBinCache, runCodexCli, parseCodexVersion } from './codexCli.js';
import { augmentedEnv } from './binLocator.js';
import { processGroupSpawnOptions, killTree } from './processTree.js';
import { broadcast } from '../broadcastBus.js';
import { logger } from '../logger.js';

/**
 * §5.25 (D) — 코덱스 CLI 설치 게이트의 서버 창구.
 *
 * `claudeSetupService` 의 대칭물이고 **같은 규약**을 따른다: 설치 명령 문자열은 한 곳에서만
 * 조립하고(화면 안내 = 실제 spawn), exit 0 을 성공으로 단정하지 않고 `--version` 이 실제로
 * 도는지로 판정하며, 설치가 끝나는 순간은 REST 응답이 아니라 리스너로 화면에 전한다.
 *
 * Node/npm 이 없는 새 PC 도 공식 standalone 인스톨러로 설치한다. 앱에 CLI 를 동봉하지 않는다.
 * 공식 명령: https://learn.chatgpt.com/docs/codex/cli
 */

/**
 * 플랫폼을 주입해 세 OS 를 시험한다. npm 존재 여부는 standalone 설치의 조건이 아니다.
 */
export function isCodexAutoInstallSupported(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32' || platform === 'darwin' || platform === 'linux';
}

/** 화면의 수동 설치 안내와 서버가 실행하는 명령은 같은 문자열을 쓴다. */
export function buildCodexSetupInstallCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? CODEX_SETUP_INSTALL_COMMAND_WIN : CODEX_SETUP_INSTALL_COMMAND_POSIX;
}

interface SetupSession {
  setupId: string;
  startedAt: number;
  status: CodexSetupProgress['status'];
  output: string;
  exitCode?: number;
  binPath?: string;
  version?: string;
  error?: string;
}

type StateListener = (state: CodexSetupState) => void;

export class CodexSetupService {
  private cached: CodexSetupState | null = null;
  private inflightRefresh: Promise<CodexSetupState> | null = null;
  private install: SetupSession | null = null;
  private listeners = new Set<StateListener>();

  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

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
    return {
      canAutoInstall: isCodexAutoInstallSupported(this.platform),
      installCommand: buildCodexSetupInstallCommand(this.platform),
      docsUrl: CODEX_SETUP_DOCS_URL,
      checkedAt: Date.now(),
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

  /**
   * 설치 실행. 이미 도는 중이면 같은 in-flight 진행 상태를 그대로 돌려준다
   * (여러 창에서 동시에 눌러도 설치는 한 번만).
   */
  startInstall(): CodexSetupProgress {
    if (this.install && (this.install.status === 'starting' || this.install.status === 'running')) {
      return toProgress(this.install);
    }

    const session: SetupSession = {
      setupId: randomUUID(),
      startedAt: Date.now(),
      status: 'starting',
      output: '',
    };
    this.install = session;

    const command = buildCodexSetupInstallCommand(this.platform);
    if (!isCodexAutoInstallSupported(this.platform)) {
      session.status = 'error';
      session.error = `Automatic install is not supported on ${this.platform}. See ${CODEX_SETUP_DOCS_URL}`;
      this.pushProgress(session);
      void this.refresh();
      return toProgress(session);
    }

    logger.info(`[codexSetup] installing: ${command}`);
    session.status = 'running';
    this.pushProgress(session);
    this.emitInstallingState();

    let child: ReturnType<typeof spawn>;
    try {
      // 공식 인스톨러의 파이프/PowerShell 명령을 그대로 실행한다.
      child = spawn(command, {
        shell: true,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        // 탐색과 실행은 같은 PATH 를 쓴다(Finder 의 최소 PATH 포함).
        // 설치 후 CLI 시작/기존 설치 제거 질문은 앱의 로그인 레일과 섞지 않는다.
        env: augmentedEnv({ ...process.env, CODEX_NON_INTERACTIVE: '1' }),
        // POSIX 한정 detached — `shell:true` 라 child.pid 는 셸이고 진짜 설치는 그 아래 손자다.
        //   그룹 리더로 띄우지 않으면 타임아웃이 셸만 죽이고 설치는 계속 돈다.
        ...processGroupSpawnOptions(this.platform),
      });
    } catch (err) {
      this.finishInstall(session, {
        status: 'error',
        error: `spawn failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      return toProgress(session);
    }

    const appendOutput = (chunk: unknown): void => {
      if (this.install !== session) return;
      const next = session.output + String(chunk);
      session.output =
        next.length > CODEX_SETUP_OUTPUT_MAX_CHARS ? next.slice(-CODEX_SETUP_OUTPUT_MAX_CHARS) : next;
      this.pushProgress(session);
    };
    child.stdout?.on('data', appendOutput);
    child.stderr?.on('data', appendOutput);

    const timer = setTimeout(() => {
      killTree(child.pid, this.platform);
      this.finishInstall(session, {
        status: 'error',
        error: `install timed out after ${CODEX_SETUP_INSTALL_TIMEOUT_MS}ms`,
      });
    }, CODEX_SETUP_INSTALL_TIMEOUT_MS);

    child.on('error', (err) => {
      clearTimeout(timer);
      this.finishInstall(session, { status: 'error', error: `spawn failed: ${err.message}` });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      session.exitCode = code ?? undefined;
      // exit 0 이어도 성공으로 단정하지 않는다 — `--version` 이 실제로 도는지가 유일한 근거다.
      void this.verifyAfterInstall(session);
    });

    return toProgress(session);
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
      error: tail || `installer exited with code ${String(session.exitCode)} but no working codex was found`,
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
