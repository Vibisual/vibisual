/**
 * 업데이트 상태 전이 SSOT. **`downloaded` 는 끈끈하다** — 체크 실패·"새 것 없음"·재체크 어느 것도 받아 둔 것을 지우지 않고, 더 새 판을 다 받았을 때만 바뀐다.
 * 이벤트마다 `phase` 를 덮으면 4시간 주기 체크의 `checking`→`error` 가 버튼을 지우고 `quitAndInstall`(`phase !== 'downloaded'` 면 거절)이 받아 둔 판을 못 깐다.
 * `readyVersion` 이 설치의 유일한 근거다(받는 중인 `newVersion` 과 다를 수 있다). electron-updater·`macSelfInstall` 의 신호를 같은 이벤트로 접어 여기서 상태로 바꾼다.
 */
import type { UpdateErrorCode, UpdateState } from './types.js';

/** electron-updater · self-install 양쪽이 내는 신호를 접은 공통 이벤트. */
export type UpdateEvent =
  /** 체크를 시작했다. */
  | { kind: 'checking' }
  /** 새 버전이 있다(아직 받기 전). */
  | { kind: 'available'; version: string; releaseNotes?: string }
  /** 새 버전이 없다. */
  | { kind: 'not-available'; at: number }
  /** 이 버전을 받기 시작했다. */
  | { kind: 'download-started'; version: string }
  /** 받는 중. */
  | { kind: 'progress'; percent: number; bytesPerSecond?: number }
  /** 이 버전을 다 받아 **설치 가능**해졌다. */
  | { kind: 'downloaded'; version: string }
  /** 실패했다. */
  | { kind: 'error'; message: string; at: number; errorCode?: UpdateErrorCode };

/**
 * 버전을 숫자로 비교한다(문자열이면 `0.1.9 > 0.1.20`). 숫자가 같으면 꼬리표(`-beta`) 있는 쪽이 낮다(semver 와 같은 방향).
 * @returns a > b 면 양수, 같으면 0, 작으면 음수
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): { nums: number[]; pre: string } => {
    const [core = '', ...rest] = String(v).trim().replace(/^v/, '').split('-');
    return {
      nums: core.split('.').map((p) => (Number.isFinite(Number(p)) ? Number(p) : 0)),
      pre: rest.join('-'),
    };
  };
  const x = parse(a);
  const y = parse(b);
  const len = Math.max(x.nums.length, y.nums.length);
  for (let i = 0; i < len; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d !== 0) return d;
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === '') return 1; // 정식판 > 프리릴리스
  if (y.pre === '') return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** `candidate` 가 `base` 보다 새것인가. `base` 가 없으면 항상 참. */
export function isNewerVersion(candidate: string, base: string | undefined): boolean {
  if (!base) return true;
  return compareVersions(candidate, base) > 0;
}

/**
 * 이벤트 하나를 상태에 적용한다(부작용 없음 — 브로드캐스트는 부르는 쪽).
 * 불변식: ① `readyVersion` 은 `downloaded` 이벤트로만 바뀐다 ② `phase === 'downloaded'` ⟺ 지금 누르면 `readyVersion` 이 깔린다 ③ `error` 는 실어 보내되 받아 둔 것을 쓸 권리는 남긴다.
 */
export function reduceUpdateState(prev: UpdateState, ev: UpdateEvent): UpdateState {
  const ready = prev.readyVersion;

  switch (ev.kind) {
    case 'checking':
      // 받아 둔 것이 있으면 화면을 흔들지 않는다 — 몇 초 뒤 돌아올 버튼을 없앴다가 다시
      // 그리는 것은 사용자에게 "사라졌다"로만 읽힌다. 체크는 조용히 뒤에서 돈다.
      if (ready) return { ...prev, error: undefined, errorCode: undefined };
      return { ...prev, phase: 'checking', error: undefined, errorCode: undefined };

    case 'available': {
      // 주기 체크는 **앱 버전**과 비교하므로, 이미 받아 둔 그 버전을 매번 다시 알려 온다
      // (0.1.18 로 돌면서 0.1.19 를 받아 뒀어도 4시간마다 "0.1.19 있음"이 온다).
      // 그것을 `available` 로 받아들이면 준비 완료 버튼이 대기 칩으로 강등된다.
      if (ready && !isNewerVersion(ev.version, ready)) {
        return { ...prev, phase: 'downloaded', newVersion: ready, error: undefined, errorCode: undefined };
      }
      return {
        ...prev,
        phase: 'available',
        newVersion: ev.version,
        releaseNotes: ev.releaseNotes ?? prev.releaseNotes,
        error: undefined,
        errorCode: undefined,
      };
    }

    case 'not-available':
      // 받아 둔 것이 있으면 "새 것 없음"에도 버튼을 지우지 않는다 — Windows 는 종료 시 자동 설치(`autoInstallOnAppQuit`)로 그것을 깔면서 화면만 "없다"고 말하게 된다.
      if (ready) return { ...prev, phase: 'downloaded', newVersion: ready, checkedAt: ev.at };
      return { ...prev, phase: 'up-to-date', newVersion: undefined, checkedAt: ev.at, error: undefined, errorCode: undefined };

    case 'download-started':
      return {
        ...prev,
        phase: 'downloading',
        newVersion: ev.version,
        percent: 0,
        bytesPerSecond: undefined,
        error: undefined,
        errorCode: undefined,
      };

    case 'progress':
      return { ...prev, phase: 'downloading', percent: ev.percent, bytesPerSecond: ev.bytesPerSecond };

    case 'downloaded':
      // 여기가 `readyVersion` 을 바꿀 수 있는 **유일한** 자리다.
      return {
        ...prev,
        phase: 'downloaded',
        newVersion: ev.version,
        readyVersion: ev.version,
        percent: 100,
        bytesPerSecond: undefined,
        error: undefined,
        errorCode: undefined,
      };

    case 'error':
      // 받아 둔 것이 있으면 그 자리로 되돌린다. 오프라인에서 주기 체크가 실패했다는 이유로
      // **이미 받아 둔 업데이트를 못 깔게 되는** 것이 종전의 가장 큰 손해였다.
      if (ready) {
        return {
          ...prev,
          phase: 'downloaded',
          newVersion: ready,
          percent: 100,
          bytesPerSecond: undefined,
          error: ev.message,
          errorCode: ev.errorCode,
          checkedAt: ev.at,
        };
      }
      return {
        ...prev,
        phase: 'error',
        error: ev.message,
        errorCode: ev.errorCode,
        percent: undefined,
        bytesPerSecond: undefined,
        checkedAt: ev.at,
      };

    default: {
      // 이벤트 종류를 늘리고 여기 분기를 안 만들면 컴파일이 막힌다.
      const unhandled: never = ev;
      void unhandled;
      return prev;
    }
  }
}
