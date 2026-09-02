import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  isNewerVersion,
  reduceUpdateState,
  type UpdateEvent,
  type UpdateState,
} from '@vibisual/shared';

/**
 * **받아 둔 업데이트는 체크 결과로 지워지지 않는다.**
 *
 * 실제로 겪은 흐름이다: 0.1.18 을 쓰는 중에 0.1.19 를 받아 두면 우상단에 파란
 * "재시작하여 업데이트" 가 뜬다. 그걸 안 누르고 계속 쓰면 4시간 뒤 주기 체크가 도는데,
 * 종전에는 그 체크가 `phase` 를 `checking` → (실패 시) `error` 로 밀어 버려 **버튼이 사라졌다.**
 * 디스크에는 0.1.19 가 멀쩡히 있는데 `quitAndInstall` 이 `phase !== 'downloaded'` 로 거절해서
 * 다음 성공 체크까지 못 깔았다.
 *
 * 여기 테스트들은 그 전이를 하나씩 못 박는다. `updaterManager` 는 electron 이 있어야 돌지만
 * 규칙은 순수 함수로 뽑혀 있어 세 OS 분기 없이 전부 재진다.
 */

const base = (over: Partial<UpdateState> = {}): UpdateState => ({
  phase: 'idle',
  currentVersion: '0.1.18',
  delivery: 'auto-install',
  ...over,
});

/** 0.1.19 를 다 받아 둔, 사용자가 버튼을 보고 있는 상태. */
const ready = (): UpdateState =>
  reduceUpdateState(base(), { kind: 'downloaded', version: '0.1.19' });

const run = (start: UpdateState, evs: UpdateEvent[]): UpdateState =>
  evs.reduce((s, e) => reduceUpdateState(s, e), start);

describe('버전 비교', () => {
  it('0.1.20 이 0.1.9 보다 새것이다 (문자열 비교면 뒤집힌다)', () => {
    expect(compareVersions('0.1.20', '0.1.9')).toBeGreaterThan(0);
    expect(isNewerVersion('0.1.20', '0.1.9')).toBe(true);
    expect(isNewerVersion('0.1.9', '0.1.20')).toBe(false);
  });

  it('같은 버전은 새것이 아니다 (주기 체크가 같은 것을 계속 물어온다)', () => {
    expect(isNewerVersion('0.1.19', '0.1.19')).toBe(false);
  });

  it('받아 둔 것이 없으면 무엇이든 새것이다', () => {
    expect(isNewerVersion('0.1.19', undefined)).toBe(true);
  });

  it('정식판이 프리릴리스보다 높다', () => {
    expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBeGreaterThan(0);
  });

  it('v 접두사와 자릿수 차이를 견딘다', () => {
    expect(compareVersions('v0.2', '0.1.20')).toBeGreaterThan(0);
    expect(compareVersions('0.1.20', 'v0.1.20')).toBe(0);
  });
});

describe('받아 둔 업데이트는 지워지지 않는다', () => {
  it('다 받으면 readyVersion 이 선다 — 설치의 유일한 근거다', () => {
    const s = ready();
    expect(s.phase).toBe('downloaded');
    expect(s.readyVersion).toBe('0.1.19');
    expect(s.newVersion).toBe('0.1.19');
    expect(s.percent).toBe(100);
  });

  it('주기 체크가 시작돼도 버튼이 사라지지 않는다', () => {
    const s = reduceUpdateState(ready(), { kind: 'checking' });
    // 종전에는 여기서 'checking' 이 되어 UpdateButton 이 null 을 그렸다(버튼 소멸).
    expect(s.phase).toBe('downloaded');
    expect(s.readyVersion).toBe('0.1.19');
  });

  it('오프라인에서 체크가 실패해도 설치할 수 있다 — 가장 크게 손해 보던 자리', () => {
    const s = run(ready(), [
      { kind: 'checking' },
      { kind: 'error', message: 'net::ERR_INTERNET_DISCONNECTED', at: 1 },
    ]);
    expect(s.phase).toBe('downloaded');
    expect(s.readyVersion).toBe('0.1.19');
    // 실패를 삼키지는 않는다 — 진단은 남되 버튼은 산다.
    expect(s.error).toContain('DISCONNECTED');
  });

  it('"새 것 없음"이 와도 이미 받아 둔 것은 남는다', () => {
    // 이걸 지우면 Windows 는 종료 시 autoInstallOnAppQuit 으로 그것을 깔면서
    // 화면만 "없다"고 말하는 어긋남이 된다.
    const s = reduceUpdateState(ready(), { kind: 'not-available', at: 7 });
    expect(s.phase).toBe('downloaded');
    expect(s.readyVersion).toBe('0.1.19');
    expect(s.checkedAt).toBe(7);
  });

  it('주기 체크가 같은 버전을 다시 알려와도 준비 완료가 대기로 강등되지 않는다', () => {
    // 앱은 0.1.18 로 돌고 있으므로 electron-updater 는 **매번** "0.1.19 있음"을 준다
    // (비교 대상이 받아 둔 것이 아니라 실행 중인 버전이라서다).
    const s = reduceUpdateState(ready(), { kind: 'available', version: '0.1.19' });
    expect(s.phase).toBe('downloaded');
    expect(s.newVersion).toBe('0.1.19');
  });
});

describe('받아 둔 사이에 더 새 버전이 올라왔을 때', () => {
  it('0.1.20 을 받아 교체한다 (사용자 시나리오 그대로)', () => {
    const s = run(ready(), [
      { kind: 'checking' },
      { kind: 'available', version: '0.1.20' },
      { kind: 'download-started', version: '0.1.20' },
      { kind: 'progress', percent: 42 },
      { kind: 'downloaded', version: '0.1.20' },
    ]);
    expect(s.phase).toBe('downloaded');
    expect(s.readyVersion).toBe('0.1.20');
    expect(s.newVersion).toBe('0.1.20');
    expect(s.error).toBeUndefined();
  });

  it('받는 동안에는 받아 둔 옛것이 근거로 남는다 (화면은 새것 진행률)', () => {
    const s = run(ready(), [
      { kind: 'available', version: '0.1.20' },
      { kind: 'download-started', version: '0.1.20' },
      { kind: 'progress', percent: 10 },
    ]);
    expect(s.phase).toBe('downloading');
    expect(s.newVersion).toBe('0.1.20'); // 받는 중인 것
    expect(s.readyVersion).toBe('0.1.19'); // 지금 누르면 깔릴 것
  });

  it('새것 받기가 실패하면 옛것으로 되돌아간다 — 실패 두 개를 만들지 않는다', () => {
    const s = run(ready(), [
      { kind: 'available', version: '0.1.20' },
      { kind: 'download-started', version: '0.1.20' },
      { kind: 'progress', percent: 99 },
      { kind: 'error', message: 'checksum mismatch', at: 3, errorCode: 'checksum-mismatch' },
    ]);
    expect(s.phase).toBe('downloaded');
    expect(s.readyVersion).toBe('0.1.19');
    // 화면이 약속하는 버전과 실제로 깔리는 것이 같아야 한다.
    expect(s.newVersion).toBe('0.1.19');
    expect(s.errorCode).toBe('checksum-mismatch');
  });

  it('피드가 뒤로 갔을 때 받아 둔 새것을 옛것으로 낮추지 않는다', () => {
    const s = run(ready(), [
      { kind: 'downloaded', version: '0.1.20' },
      { kind: 'available', version: '0.1.19' },
    ]);
    expect(s.readyVersion).toBe('0.1.20');
    expect(s.phase).toBe('downloaded');
  });
});

describe('받아 둔 것이 없을 때는 종전 그대로 말한다', () => {
  it('체크 → 없음 → up-to-date', () => {
    const s = run(base(), [{ kind: 'checking' }, { kind: 'not-available', at: 5 }]);
    expect(s.phase).toBe('up-to-date');
    expect(s.newVersion).toBeUndefined();
    expect(s.checkedAt).toBe(5);
  });

  it('체크 → 실패 → error (이때는 화면이 실패를 말해야 한다)', () => {
    const s = run(base(), [{ kind: 'checking' }, { kind: 'error', message: 'boom', at: 6 }]);
    expect(s.phase).toBe('error');
    expect(s.error).toBe('boom');
    expect(s.readyVersion).toBeUndefined();
  });

  it('self-install 준비 실패는 errorCode 를 실어 보낸다 (화면이 제 나라 말로 말하게)', () => {
    const s = reduceUpdateState(base({ delivery: 'self-install' }), {
      kind: 'error',
      message: 'no write permission: /Applications',
      errorCode: 'not-writable',
      at: 9,
    });
    expect(s.phase).toBe('error');
    expect(s.errorCode).toBe('not-writable');
  });

  it('체크가 성공하면 옛 실패 메시지가 남지 않는다', () => {
    const s = run(base(), [
      { kind: 'error', message: 'boom', at: 1 },
      { kind: 'checking' },
      { kind: 'available', version: '0.1.19' },
    ]);
    expect(s.phase).toBe('available');
    expect(s.error).toBeUndefined();
    expect(s.errorCode).toBeUndefined();
  });
});

describe('불변식', () => {
  it('currentVersion 과 delivery 는 어떤 이벤트로도 바뀌지 않는다', () => {
    const start = base({ currentVersion: '0.1.18', delivery: 'self-install' });
    const evs: UpdateEvent[] = [
      { kind: 'checking' },
      { kind: 'available', version: '0.1.19' },
      { kind: 'download-started', version: '0.1.19' },
      { kind: 'progress', percent: 50 },
      { kind: 'downloaded', version: '0.1.19' },
      { kind: 'not-available', at: 1 },
      { kind: 'error', message: 'x', at: 2 },
    ];
    for (const ev of evs) {
      const s = reduceUpdateState(start, ev);
      expect(s.currentVersion).toBe('0.1.18');
      expect(s.delivery).toBe('self-install');
    }
  });

  it('phase 가 downloaded 면 readyVersion 이 반드시 있다 (설치가 거절되지 않게)', () => {
    // updaterManager 의 quitAndInstall 이 이 둘을 함께 본다 — 한쪽만 서면 버튼이 죽는다.
    const paths: UpdateEvent[][] = [
      [{ kind: 'downloaded', version: '0.1.19' }],
      [{ kind: 'downloaded', version: '0.1.19' }, { kind: 'checking' }],
      [{ kind: 'downloaded', version: '0.1.19' }, { kind: 'not-available', at: 1 }],
      [{ kind: 'downloaded', version: '0.1.19' }, { kind: 'error', message: 'x', at: 1 }],
      [{ kind: 'downloaded', version: '0.1.19' }, { kind: 'available', version: '0.1.19' }],
    ];
    for (const evs of paths) {
      const s = run(base(), evs);
      if (s.phase === 'downloaded') expect(s.readyVersion).toBeTruthy();
    }
  });

  it('리듀서는 입력 상태를 건드리지 않는다', () => {
    const start = ready();
    const snapshot = JSON.stringify(start);
    reduceUpdateState(start, { kind: 'error', message: 'x', at: 1 });
    expect(JSON.stringify(start)).toBe(snapshot);
  });
});
