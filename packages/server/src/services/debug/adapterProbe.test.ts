import { describe, it, expect } from 'vitest';

import { DEBUG_ADAPTERS } from '@vibisual/shared';

import { listDebugAdapters, commandFingerprint } from './adapterProbe.js';

/**
 * §5.5 #17-20 ⑩ — 어댑터 탐지는 종전에 `where`/`which` 한 번이었다.
 *
 * 그 둘은 **우리 프로세스의 PATH** 만 본다. Finder 로 띄운 macOS 앱의 PATH 는
 * `/usr/bin:/bin:/usr/sbin:/sbin` 넉 줄뿐이라 `~/go/bin/dlv`·`~/.cargo/bin/codelldb`·
 * Homebrew 의 `debugpy` 가 **깔려 있어도 전부 "없음"** 으로 나왔다. 이제 `binLocator` 가
 * 보강된 PATH + 알려진 설치 위치를 함께 본다.
 *
 * 이 파일은 **실제 PC 상태에 의존하지 않는 불변식**만 고정한다(어느 개발기에서 돌려도 같아야 한다).
 */

describe('listDebugAdapters', () => {
  const rows = listDebugAdapters();

  it('표의 모든 줄을 하나도 빼지 않고 돌려준다 — 없는 것도 "없음"으로 화면에 서야 한다', () => {
    expect(rows).toHaveLength(DEBUG_ADAPTERS.length);
    expect(rows.map((r) => r.runtime)).toEqual(DEBUG_ADAPTERS.map((s) => s.runtime));
  });

  it('cdp(런타임 내장)는 늘 available 이고 사유가 붙지 않는다', () => {
    for (const row of rows.filter((r) => r.backend === 'cdp')) {
      expect(row.available).toBe(true);
      expect(row.unavailableReason).toBeUndefined();
    }
  });

  it('delegated(붙을 어댑터가 없는 런타임)는 no-adapter 로 사유를 밝힌다', () => {
    const delegated = rows.filter((r) => r.backend === 'delegated');
    for (const row of delegated) {
      expect(row.available).toBe(false);
      expect(row.unavailableReason).toBe('no-adapter');
    }
  });

  it('available:false 면 **반드시** 사유가 붙는다 — "미설치"와 "못 찾음"을 화면이 갈라야 한다', () => {
    for (const row of rows.filter((r) => !r.available)) {
      expect(row.unavailableReason).toBeDefined();
    }
  });

  it('available:true 면 사유가 없고, cdp 가 아니면 절대경로를 함께 준다', () => {
    for (const row of rows.filter((r) => r.available)) {
      expect(row.unavailableReason).toBeUndefined();
      if (row.backend !== 'cdp') {
        expect(row.execPath).toBeTruthy();
        // `where` 가 여러 줄을 뱉던 시절의 "줄바꿈이 낀 경로"를 다시 만들지 않는다.
        expect(row.execPath ?? '').not.toMatch(/[\r\n]/);
      }
    }
  });

  it('설치 안내에 필요한 필드는 always-on', () => {
    for (const row of rows) {
      expect(row.licence).toBeTruthy();
      expect(row.installKey).toBeTruthy();
      expect(row.docsUrl).toMatch(/^https?:\/\//);
    }
  });
});

describe('commandFingerprint', () => {
  it('첫 번째 파일 이름을 고른다', () => {
    expect(commandFingerprint('dotnet run --project Foo/Foo.csproj')).toBe('Foo.csproj');
  });

  it('파일 이름이 없으면 첫 토큰', () => {
    expect(commandFingerprint('cargo run')).toBe('cargo');
  });

  it('플래그만 있으면 빈 문자열(억지로 만들어 내지 않는다)', () => {
    expect(commandFingerprint('--flag-only')).toBe('');
  });
});
