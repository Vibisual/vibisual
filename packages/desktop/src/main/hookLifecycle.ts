// SCENARIO.md §3.6 「수명」 · §5.7 #24-3 — 훅은 앱이 켜져 있는 동안만 둔다(데스크톱 쪽 판정).
// 깔기·걷기는 서버 코어(`hookLifetime.ts`), 여기는 "언제 걷나"만 — 순수 함수라 `bootstrap.ts` 도 서버 코어 없이 정적으로 부르고,
// `platform` 을 인자로 받아 개발기 한 대에서 세 OS 판정을 다 시험한다.

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
 * - Windows: OS 종료·재시작·로그오프 때 `before-quit` 가 오지 않는다(Electron `app` 문서). 창의 `session-end` 안에서 동기로 걷는다.
 * - mac·linux: `powerMonitor` 의 `shutdown`. mac 은 `before-quit` 도 오지만 먼저 온 쪽만 걷는다(`createHookRetirement` — 한 번만).
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
 * - 깔았을 때만 — 잠금을 못 잡은 두 번째 실행, 설치를 건너뛴 실행(`VIBISUAL_SKIP_HOOK_INSTALL` · `VIBISUAL_HOME`),
 *   백엔드가 못 뜬 실행이 떠 있는 앱의 훅을 걷으면 안 된다.
 * - 한 번만 — 정상 종료와 OS 종료 신호가 겹쳐도 두 번째는 아무것도 안 한다.
 * - 던지지 않는다 — 종료 경로를 막으면 안 된다. 실패는 `onError` 로만.
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
