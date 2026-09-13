import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  CODEX_SETUP_INSTALL_COMMAND,
  CODEX_SETUP_DOCS_URL,
  CODEX_SETUP_PROBE_TIMEOUT_MS,
  CODEX_SETUP_INSTALL_TIMEOUT_MS,
  CODEX_SETUP_VERIFY_RETRY_INTERVAL_MS,
  CODEX_SETUP_VERIFY_RETRY_MAX,
  CODEX_SETUP_OUTPUT_MAX_CHARS,
} from '@vibisual/shared';
import type { CodexSetupState, CodexSetupProgress, WSMessage } from '@vibisual/shared';
import { getCodexBin, invalidateCodexBinCache, runCodexCli, parseCodexVersion } from './codexCli.js';
import { resolveBinary } from './binLocator.js';
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
 * **다른 점 하나**: 설치 명령이 세 OS 공통(npm 전역 설치)이라 플랫폼별 분기가 없다.
 * 그래서 `canAutoInstall` 은 "이 OS 를 지원하나"가 아니라 **"npm 이 있나"** 를 뜻한다.
 */

/**
 * 자동 설치를 시도할 수 있는가 = 이 기계에 npm 이 있는가.
 *
 * **판정기를 인자로 받는다** — 함수 안에서 직접 PATH 를 뒤지면 그 분기는 테스트에서 검증되지
 * 않는다(멀티플랫폼 규칙: 플랫폼 의존은 주입으로).
 */
export function isCodexAutoInstallSupported(hasNpm: (name: string) => boolean): boolean {
  return hasNpm('npm');
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

class CodexSetupService {
  private cached: CodexSetupState | null = null;
  private inflightRefresh: Promise<CodexSetupState> | null = null;
  private install: SetupSession | null = null;
  private listeners = new Set<StateListener>();
  /** npm 존재 판정기 — 테스트가 갈아 끼운다. */
  private npmProbe: (name: string) => boolean = (name) => {
    // 늦은 import 를 피하려고 여기서 직접 부른다(binLocator 는 자체 캐시를 갖는다).
    return resolveNpm(name);
  };

  get(): CodexSetupState | null {
    return this.cached;
  }

  getProgress(): CodexSetupProgress | null {
    return this.install ? toProgress(this.install) : null;
  }

  /** 테스트용 — npm 판정기 교체. */
  setNpmProbe(fn: (name: string) => boolean): void {
    this.npmProbe = fn;
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
      canAutoInstall: isCodexAutoInstallSupported(this.npmProbe),
      installCommand: CODEX_SETUP_INSTALL_COMMAND,
      docsUrl: CODEX_SETUP_DOCS_URL,
      checkedAt: Date.now(),
    };
  }

  /** 현재 실행본을 판정해 상태를 갱신한다. 실패해도 throw 하지 않는다. */
  async refresh(): Promise<CodexSetupState> {
    if (this.inflightRefresh) return this.inflightRefresh;
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

    if (!isCodexAutoInstallSupported(this.npmProbe)) {
      session.status = 'error';
      session.error = `npm was not found. Install Node.js first, then run: ${CODEX_SETUP_INSTALL_COMMAND}`;
      this.pushProgress(session);
      void this.refresh();
      return toProgress(session);
    }

    logger.info(`[codexSetup] installing: ${CODEX_SETUP_INSTALL_COMMAND}`);
    session.status = 'running';
    this.pushProgress(session);
    this.emitInstallingState();

    let child: ReturnType<typeof spawn>;
    try {
      // `npm` 은 Windows 에서 `npm.cmd` shim 이라 셸 경유가 필수다(Node 가 배치 파일을 직접
      //   exec 하지 못한다 — `buildCliInvocation` 이 아는 그 규칙).
      child = spawn(CODEX_SETUP_INSTALL_COMMAND, {
        shell: true,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        // POSIX 한정 detached — `shell:true` 라 child.pid 는 셸이고 진짜 설치는 그 아래 손자다.
        //   그룹 리더로 띄우지 않으면 타임아웃이 셸만 죽이고 설치는 계속 돈다.
        ...processGroupSpawnOptions(),
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
      killTree(child.pid);
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
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, CODEX_SETUP_VERIFY_RETRY_INTERVAL_MS));
      }
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
  if (res.failure) return undefined;
  return parseCodexVersion(res.out);
}

/** npm 이 PATH(보강 포함)에 있는가. binLocator 를 통해 본다 — Finder 로 띄운 mac 앱 대응. */
function resolveNpm(name: string): boolean {
  return resolveBinary(name) !== null;
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
