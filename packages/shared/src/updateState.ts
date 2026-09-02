/**
 * 업데이트 상태 전이 SSOT — **무엇이 지금 설치 가능한가**를 잃지 않는 규칙.
 *
 * ## 왜 리듀서로 뽑았나
 *
 * 종전에는 `updaterManager` 가 electron-updater 이벤트마다 `patchState({ phase: … })` 를
 * 직접 불렀다. 그래서 **주기 체크(4시간)가 이미 받아 둔 업데이트를 지워 버렸다.** 실제 흐름:
 *
 * 1. 0.1.18 을 쓰는 중에 0.1.19 를 받아 둔다 → `phase:'downloaded'` → 파란 "재시작하여 업데이트".
 * 2. 사용자가 안 누르고 계속 쓴다. 4시간 뒤 주기 체크가 돈다.
 * 3. `checking-for-update` → `phase:'checking'` → **버튼이 사라진다**(UpdateButton 은
 *    available/downloading/downloaded 가 아니면 `null` 을 그린다).
 * 4. 그때 네트워크가 끊겨 있으면 `error` → `phase:'error'` → 버튼은 **돌아오지 않는다.**
 *    받아 둔 0.1.19 는 디스크에 멀쩡히 있는데 설치할 길이 없어진다
 *    (`quitAndInstall` 이 `phase !== 'downloaded'` 면 거절한다).
 *    다음 성공 체크까지 4시간을 더 기다려야 버튼이 돌아온다.
 *
 * 그래서 규칙을 하나로 못 박는다: **`downloaded` 는 끈끈하다(sticky).** 체크가 실패하든,
 * "새 것 없음"이 오든, 다시 체크를 시작하든 — **받아 둔 것을 지우지 않는다.** 그것을 대체할 수
 * 있는 것은 **더 새 버전을 실제로 다 받았을 때** 하나뿐이다.
 *
 * ## `newVersion` 과 `readyVersion` 을 나눈 이유
 *
 * 종전에는 `newVersion` 하나가 두 가지 뜻을 겸했다 — "발견된 것"과 "설치 준비된 것". 그런데
 * 0.1.19 를 받아 둔 채 0.1.20 을 받는 동안 두 값은 **다르다.** 겸하게 두면 0.1.20 다운로드가
 * 실패했을 때 무엇으로 되돌아가야 하는지 알 수 없고, mac 에서는 화면이 "0.1.20 준비 완료"라고
 * 말하면서 실제로는 0.1.19 번들을 교체하는 어긋남이 생긴다.
 * `readyVersion` = **지금 이 순간 설치하면 깔리는 그 버전**. 이 필드만이 설치의 근거다.
 *
 * ## 플랫폼
 *
 * 전 플랫폼 공통이다. 갈리는 것은 **누가 받는가**(Windows/Linux = electron-updater,
 * 무서명 mac = 우리 `macSelfInstall`)뿐이고, 두 경로가 내는 신호를 같은 이벤트로 접어 여기
 * 한 곳에서 상태로 바꾼다. 순수 함수라 세 OS 분기 없이 단위 테스트로 전부 확인된다.
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
 * `0.1.20` 과 `0.1.9` 를 사람이 읽는 대로 비교한다(문자열 비교면 `0.1.9 > 0.1.20` 이 된다).
 *
 * 숫자가 아닌 꼬리표(`1.0.0-beta`)는 숫자 부분까지만 보고 같으면 **꼬리표가 있는 쪽을 낮게**
 * 친다 — 정식판이 프리릴리스보다 높다는 semver 의 통상 규칙과 같은 방향이다.
 *
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
 * 이벤트 하나를 상태에 적용한다. **부작용 없음** — 부르는 쪽이 결과를 브로드캐스트한다.
 *
 * 핵심 불변식 셋:
 * 1. `readyVersion` 이 있으면 **어떤 체크 결과로도 지워지지 않는다.** `downloaded` 이벤트만
 *    바꿀 수 있다.
 * 2. `phase === 'downloaded'` ⟺ 지금 누르면 `readyVersion` 이 깔린다. 화면과 실제가 어긋나지
 *    않게 하는 자리다.
 * 3. 실패는 **삼키지 않는다** — `error` 는 그대로 실어 보내되, 받아 둔 것이 있으면 그것을 쓸
 *    권리까지 빼앗지는 않는다(진단은 남고 버튼은 산다).
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
      // 받아 둔 것이 있는데 "새 것 없음"이 왔다 — 피드가 잠시 흔들렸거나 그 릴리스가 내려간
      // 것이다. 어느 쪽이든 **이미 디스크에 있는 것**은 여전히 설치 가능하다. 여기서 버튼을
      // 지우면 Windows 는 종료 시 자동 설치(`autoInstallOnAppQuit`)로 그것을 깔면서 화면만
      // "없다"고 말하는 어긋남이 된다.
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
