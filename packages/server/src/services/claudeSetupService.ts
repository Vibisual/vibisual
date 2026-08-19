import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { ClaudeSetupState, ClaudeSetupProgress, WSMessage } from '@vibisual/shared';
import {
  CLAUDE_SETUP_INSTALL_COMMAND_WIN,
  CLAUDE_SETUP_INSTALL_COMMAND_POSIX,
  CLAUDE_SETUP_DOCS_URL,
  CLAUDE_SETUP_INSTALL_TIMEOUT_MS,
  CLAUDE_SETUP_VERIFY_RETRY_INTERVAL_MS,
  CLAUDE_SETUP_VERIFY_RETRY_MAX,
  CLAUDE_SETUP_OUTPUT_MAX_CHARS,
} from '@vibisual/shared';
import { logger } from '../logger.js';
import { broadcast } from '../broadcastBus.js';
import { getClaudeBin, invalidateClaudeBinCache } from './claudeBin.js';
import { probeClaudeBinVersion } from './claudeVersionService.js';

/**
 * §4 (첫 실행 설치 온보딩) — `claude` CLI 가 아예 없는 사람에게 깔아 주는 서버 창구.
 *
 * **왜 필요한가**: 앱만 내려받은 사람은 CLI 가 없어도 화면에서 아무 신호를 못 받았다 —
 * §4 v4.82 `LoginWindow` 는 `error`(판정 불가)면 뜨지 않도록 의도적으로 설계돼 있고,
 * §5.7 #23-1 버전 게이트는 `isOutdated` 로만 발화하는데 미설치는 `current=null` 이라 항상 false 다.
 * 그래서 "없다"를 **1급 상태**(`ClaudeSetupState.phase`)로 세우고, 클라가 그것만 보고
 * 권장형 게이트를 띄우게 한다.
 *
 * **왜 npm 이 아니라 네이티브 인스톨러인가**: 기존 `claudeVersionService.installLatestClaude` 는
 * `npm install -g` 라 Node/npm 이 이미 있는 사람 전용이다. 설치 파일만 받은 신규 사용자에게는
 * 통하지 않으므로, Node 가 필요 없는 **공식 네이티브 인스톨러**를 쓴다. 그 설치 위치
 * (`~/.local/bin`)는 `claudeBin` 이 이미 아는 경로라 설치 직후 탐지는 기존 배선이 그대로 받는다.
 *
 * **왜 PTY 가 아니라 서버 spawn 인가**: 로그인은 브라우저 왕복·코드 입력이 있어 PTY 가 필요했지만
 * 인스톨러는 대화형 입력이 없다. 서버 spawn 이면 §4 v3.16 모바일 웹처럼 터미널 transport 가 없는
 * 창에서도 설치가 돌고, 진행 상황을 모든 창에 같은 값으로 push 할 수 있다
 * (§5.7 #23-1 `installLatestClaude` 의 in-flight 세션 + WS 진행 push 패턴 재사용).
 *
 * 영속화 ❌ — 설치 여부는 디스크를 보면 아는 파생 사실이고 프로젝트가 아니라 기기에 매인 값이라
 * `ProjectCheckpoint` 에 넣지 않는다(런타임 캐시 + `GraphSnapshot.claudeSetup` 전달).
 */

const IS_WIN = process.platform === 'win32';

/** 자동 설치를 시도할 수 있는 플랫폼인가. 그 밖(예: 미지원 OS)이면 수동 명령만 안내한다. */
export function isAutoInstallSupported(): boolean {
  return process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux';
}

/**
 * 이 플랫폼의 공식 네이티브 인스톨러 명령.
 * **화면의 "직접 설치" 안내와 서버가 실제로 spawn 하는 명령이 같은 문자열**이어야 안내와 동작이
 * 어긋나지 않으므로, 조립은 여기 한 곳에서만 한다.
 */
export function buildSetupInstallCommand(): string {
  return IS_WIN ? CLAUDE_SETUP_INSTALL_COMMAND_WIN : CLAUDE_SETUP_INSTALL_COMMAND_POSIX;
}

interface SetupSession {
  setupId: string;
  startedAt: number;
  status: ClaudeSetupProgress['status'];
  output: string;
  exitCode?: number;
  binPath?: string;
  version?: string;
  error?: string;
}

type StateListener = (state: ClaudeSetupState) => void;

class ClaudeSetupService {
  private cached: ClaudeSetupState | null = null;
  /** 동시 호출 합류 — 부팅 폴링·REST·게이트가 겹쳐도 probe 는 한 번만 돈다. */
  private inflightRefresh: Promise<ClaudeSetupState> | null = null;
  private install: SetupSession | null = null;
  private listeners = new Set<StateListener>();

  get(): ClaudeSetupState | null {
    return this.cached;
  }

  getProgress(): ClaudeSetupProgress | null {
    return this.install ? toProgress(this.install) : null;
  }

  /**
   * 상태가 바뀔 때 알림 — `index.ts` 가 `graphManager.setClaudeSetup` + `broadcastSnapshot` 을 건다.
   * 설치는 비동기로 끝나므로, 끝나는 순간을 REST 응답이 아니라 이 경로로 화면에 전달한다.
   */
  onChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(state: ClaudeSetupState): void {
    this.cached = state;
    for (const l of this.listeners) {
      try {
        l(state);
      } catch (err) {
        logger.warn(`[claudeSetup] listener failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /** 현재 실행본을 판정해 상태를 갱신한다. 실패해도 throw 하지 않는다. */
  async refresh(): Promise<ClaudeSetupState> {
    if (this.inflightRefresh) return this.inflightRefresh;
    this.inflightRefresh = this.probe().finally(() => {
      this.inflightRefresh = null;
    });
    return this.inflightRefresh;
  }

  private async probe(): Promise<ClaudeSetupState> {
    const bin = getClaudeBin();
    const det = await probeClaudeBinVersion(bin.binPath);
    const base = {
      canAutoInstall: isAutoInstallSupported(),
      installCommand: buildSetupInstallCommand(),
      docsUrl: CLAUDE_SETUP_DOCS_URL,
      checkedAt: Date.now(),
    };

    if (det.version) {
      // 쓸 수 있는 실행본이 있다 — 직전 설치 실패 기록이 있어도 여기서 해소된다.
      const next: ClaudeSetupState = {
        ...base,
        phase: 'ready',
        binPath: bin.binPath,
        version: det.version,
        source: bin.source,
      };
      this.emit(next);
      return next;
    }

    // 설치가 도는 중이면 "없음"이 아니라 "설치 중"이다(게이트가 진행 화면을 유지하도록).
    const running = this.install && (this.install.status === 'starting' || this.install.status === 'running');
    const failed = this.install?.status === 'error';
    const next: ClaudeSetupState = {
      ...base,
      phase: running ? 'installing' : failed ? 'failed' : 'missing',
      source: 'unknown',
      ...(failed && this.install?.error ? { error: this.install.error } : {}),
    };
    this.emit(next);
    return next;
  }

  /**
   * 네이티브 인스톨러 실행. 이미 도는 중이면 같은 in-flight 진행 상태를 그대로 돌려준다
   * (여러 창에서 동시에 눌러도 설치는 한 번만).
   */
  startInstall(): ClaudeSetupProgress {
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

    if (!isAutoInstallSupported()) {
      session.status = 'error';
      session.error = `Automatic install is not supported on ${process.platform}. Run: ${buildSetupInstallCommand()}`;
      this.pushProgress(session);
      void this.refresh();
      return toProgress(session);
    }

    const command = buildSetupInstallCommand();
    logger.info(`[claudeSetup] installing via native installer: ${command}`);
    session.status = 'running';
    this.pushProgress(session);
    this.emitInstallingState();

    let child: ReturnType<typeof spawn>;
    try {
      // 두 플랫폼 명령 모두 셸 문법(파이프)을 쓰므로 shell 실행이 필요하다.
      child = spawn(command, {
        shell: true,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
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
        next.length > CLAUDE_SETUP_OUTPUT_MAX_CHARS ? next.slice(-CLAUDE_SETUP_OUTPUT_MAX_CHARS) : next;
      this.pushProgress(session);
    };
    child.stdout?.on('data', appendOutput);
    child.stderr?.on('data', appendOutput);

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      this.finishInstall(session, {
        status: 'error',
        error: `install timed out after ${CLAUDE_SETUP_INSTALL_TIMEOUT_MS}ms`,
      });
    }, CLAUDE_SETUP_INSTALL_TIMEOUT_MS);

    child.on('error', (err) => {
      clearTimeout(timer);
      this.finishInstall(session, { status: 'error', error: `spawn failed: ${err.message}` });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      session.exitCode = code ?? undefined;
      // exit 0 이어도 곧바로 성공으로 단정하지 않는다 — 실제로 `--version` 이 도는지가 유일한 근거다.
      void this.verifyAfterInstall(session);
    });

    return toProgress(session);
  }

  /**
   * 설치 직후 검증. 인스톨러가 끝나도 파일 flush·런처 배치가 한 박자 늦을 수 있어
   * 바로 실패로 단정하지 않고 짧은 간격으로 몇 번 더 확인한다.
   */
  private async verifyAfterInstall(session: SetupSession): Promise<void> {
    for (let attempt = 0; attempt < CLAUDE_SETUP_VERIFY_RETRY_MAX; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, CLAUDE_SETUP_VERIFY_RETRY_INTERVAL_MS));
      }
      // 방금 깔린 실행본은 캐시된 해석 결과(대개 폴백 'claude')와 다르다 — 매 시도마다 다시 푼다.
      // 이게 있어야 **재시작 없이** 바로 로그인·에이전트 실행으로 넘어갈 수 있다.
      invalidateClaudeBinCache();
      const bin = getClaudeBin();
      const det = await probeClaudeBinVersion(bin.binPath);
      if (det.version) {
        this.finishInstall(session, {
          status: 'done',
          binPath: bin.binPath,
          version: det.version,
        });
        return;
      }
    }
    const tail = session.output.trim().slice(-300);
    this.finishInstall(session, {
      status: 'error',
      error: tail || `installer exited with code ${String(session.exitCode)} but no working claude was found`,
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
      logger.info(`[claudeSetup] installed ${patch.version ?? '?'} at ${patch.binPath ?? '?'}`);
    } else {
      logger.warn(`[claudeSetup] install failed: ${patch.error ?? 'unknown'}`);
    }
    this.pushProgress(session);
    void this.refresh();
  }

  /** 설치 시작 시점의 상태(=installing)를 화면에 먼저 반영한다. */
  private emitInstallingState(): void {
    const prev = this.cached;
    this.emit({
      canAutoInstall: isAutoInstallSupported(),
      installCommand: buildSetupInstallCommand(),
      docsUrl: CLAUDE_SETUP_DOCS_URL,
      checkedAt: Date.now(),
      phase: 'installing',
      ...(prev?.binPath ? { binPath: prev.binPath } : {}),
    });
  }

  private pushProgress(session: SetupSession): void {
    const msg: WSMessage = {
      type: 'claude_setup_progress',
      timestamp: Date.now(),
      payload: toProgress(session),
    };
    broadcast(msg);
  }
}

function toProgress(s: SetupSession): ClaudeSetupProgress {
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

export const claudeSetupService = new ClaudeSetupService();
