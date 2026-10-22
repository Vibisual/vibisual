// SCENARIO.md §3.6 「수명」 · §5.7 #24-3 — **훅은 앱이 켜져 있는 동안만 둔다** (데스크톱 쪽 판정).
//
// 깔기·걷기 자체는 서버 코어(`hookLifetime.ts`)가 한다. 여기는 "언제 걷나"만 정한다 — 순수 함수라 시작 진입점
// (`bootstrap.ts`)도 정적으로 부를 수 있고(서버 코어를 끌어오지 않는다), `platform` 을 인자로 받아 개발기 한 대에서
// 세 OS 판정을 다 돈다(CLAUDE.md 멀티플랫폼 규칙).

/** 제거기가 앱을 부를 때 붙이는 인자. `build/installer.nsh` 의 `customUnInit` 이 같은 글자를 쓴다. */
export const HOOK_CLEANUP_ARG = '--vibisual-remove-hooks';

/** 이번 실행이 제거기의 정리 모드인가 — 창·잠금·서버 없이 우리 훅만 걷고 끝낸다. */
export function isHookCleanupRun(argv: readonly string[]): boolean {
  return argv.includes(HOOK_CLEANUP_ARG);
}

/** 걷는 계기 — 로그에 남긴다. */
export type HookRetireReason = 'quit' | 'os-session-end' | 'os-shutdown';

/**
 * OS 종료·로그오프를 어느 신호로 받는가.
 *
 * - **Windows**: OS 종료·재시작·로그오프 때는 `before-quit` 가 오지 않는다(Electron `app` 문서의 주의). 창의
 *   `session-end` 가 그 순간에 온다 — 그 안에서 동기로 걷는다.
 * - **mac·linux**: `powerMonitor` 의 `shutdown`. mac 은 시스템 종료 때 앱에 종료를 보내 `before-quit` 도 오지만,
 *   먼저 오는 쪽이 걷고 뒤는 아무것도 안 한다(`createHookRetirement` — 한 번만).
 */
export function osEndSignals(platform: NodeJS.Platform): { windowSessionEnd: boolean; powerMonitorShutdown: boolean } {
  return {
    windowSessionEnd: platform === 'win32',
    powerMonitorShutdown: platform === 'darwin' || platform === 'linux',
  };
}

export interface HookRetirement {
  /** 이 프로세스가 훅을 깔았다. */
  markInstalled(): void;
  /** 끌 때 부른다. 이 프로세스가 깔았을 때 **한 번만** 걷는다. 실제로 걷으러 갔으면 true. */
  retire(reason: HookRetireReason): boolean;
}

/**
 * 끌 때 걷기의 문지기.
 *
 * - **깔았을 때만** — 단일 인스턴스 잠금을 못 잡고 끝나는 두 번째 실행, 훅 설치를 건너뛴 실행
 *   (`VIBISUAL_SKIP_HOOK_INSTALL` · `VIBISUAL_HOME`), 백엔드가 못 뜬 실행이 떠 있는 앱의 훅을 걷으면 안 된다.
 * - **한 번만** — 정상 종료와 OS 종료 신호가 겹쳐 와도 두 번째는 아무것도 하지 않는다.
 * - **실패를 던지지 않는다** — 종료 경로를 막으면 안 된다. 실패는 `onError` 로만 알린다.
 */
export function createHookRetirement(
  retire: (reason: HookRetireReason) => void,
  onError?: (error: unknown) => void,
): HookRetirement {
  let installed = false;
  let retired = false;
  return {
    markInstalled(): void {
      installed = true;
    },
    retire(reason: HookRetireReason): boolean {
      if (!installed || retired) return false;
      retired = true;
      try {
        retire(reason);
      } catch (error) {
        onError?.(error);
      }
      return true;
    },
  };
}
