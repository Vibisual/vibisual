/**
 * platform.test.ts — 플랫폼 판정 SSOT 회귀.
 *
 * 여기서 못 박는 것은 세 가지다:
 *  ① mac 단축키 라벨(`⌘S`)과 그 외(`Ctrl+S`)가 **같은 입력에서 갈린다**.
 *  ② 경로 키가 Linux 에서는 케이스를 보존하고 Windows/macOS 에서만 접힌다.
 *  ③ 판정 불가(`unknown`)일 때는 **접는 쪽**으로 물러선다 — 종전 동작이라 회귀가 없다.
 */
import { describe, it, expect } from 'vitest';
import { pathKey } from '@vibisual/shared';
import { detectOs, formatShortcut } from './platform.js';

describe('detectOs — 플랫폼 문자열 판정', () => {
  it('macOS 계열을 darwin 으로 본다', () => {
    for (const raw of ['macOS', 'MacIntel', 'Mac68K', 'iPhone', 'iPad', 'Darwin']) {
      expect(detectOs(raw), raw).toBe('darwin');
    }
  });

  it('Darwin 이 Windows 로 새지 않는다 — 문자열에 "win" 이 들어 있어 순서가 뒤집히면 바로 오판이다', () => {
    expect(detectOs('Darwin')).toBe('darwin');
  });

  it('Windows 계열을 win32 로 본다', () => {
    for (const raw of ['Windows', 'Win32', 'Win64', 'WinCE']) {
      expect(detectOs(raw), raw).toBe('win32');
    }
  });

  it('Linux·Android 계열을 linux 로 본다', () => {
    for (const raw of ['Linux', 'Linux x86_64', 'Linux armv8l', 'Android', 'X11', 'FreeBSD']) {
      expect(detectOs(raw), raw).toBe('linux');
    }
  });

  it('빈 문자열·모르는 값은 unknown', () => {
    expect(detectOs('')).toBe('unknown');
    expect(detectOs('   ')).toBe('unknown');
    expect(detectOs('SomeFutureOS')).toBe('unknown');
  });
});

describe('formatShortcut — 단축키 라벨', () => {
  it('mac 이면 Ctrl 이 ⌘ 로 바뀌고, 아니면 그대로다', () => {
    expect(formatShortcut('Ctrl+S', true)).toBe('⌘S');
    expect(formatShortcut('Ctrl+S', false)).toBe('Ctrl+S');
  });

  it('편집창 우클릭 힌트 전부가 mac 표기로 간다', () => {
    const combos = ['Ctrl+X', 'Ctrl+C', 'Ctrl+V', 'Ctrl+A', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+S', 'Ctrl+F'];
    expect(combos.map((c) => formatShortcut(c, true)))
      .toEqual(['⌘X', '⌘C', '⌘V', '⌘A', '⌘Z', '⌘Y', '⌘S', '⌘F']);
    expect(combos.map((c) => formatShortcut(c, false))).toEqual(combos);
  });

  it('Enter 는 mac 에서 ↩', () => {
    expect(formatShortcut('Ctrl+Enter', true)).toBe('⌘↩');
    expect(formatShortcut('Ctrl+Enter', false)).toBe('Ctrl+Enter');
  });

  it('모디파이어가 여럿이면 Apple 순서(⌃⌥⇧⌘)로 선다', () => {
    expect(formatShortcut('Ctrl+Shift+Z', true)).toBe('⇧⌘Z');
    expect(formatShortcut('Shift+Ctrl+Z', true)).toBe('⇧⌘Z');
    expect(formatShortcut('Ctrl+Alt+Shift+P', true)).toBe('⌥⇧⌘P');
  });

  // §5.5 #17-37 ③ — mac 에서 Cmd+Tab 은 OS 앱 전환이라 그 자리만 **진짜 Control** 이다.
  it('Control 토큰은 mac 에서 ⌃ — 세션 탭 전환(Ctrl+Tab)이 ⌘Tab 으로 잘못 안내되지 않는다', () => {
    expect(formatShortcut('Control+Tab', true)).toBe('⌃⇥');
    expect(formatShortcut('Control+Tab', false)).toBe('Ctrl+Tab');
    expect(formatShortcut('Control+Shift+Tab', true)).toBe('⌃⇧⇥');
    expect(formatShortcut('Control+Shift+Tab', false)).toBe('Ctrl+Shift+Tab');
  });

  it('Ctrl 은 그대로 ⌘ 다 — 예외는 Control 토큰 하나뿐', () => {
    expect(formatShortcut('Ctrl+Tab', true)).toBe('⌘⇥');
  });

  it('PageUp/PageDown 은 mac 기호(⇞·⇟)로', () => {
    expect(formatShortcut('Ctrl+PageDown', true)).toBe('⌘⇟');
    expect(formatShortcut('Ctrl+PageUp', true)).toBe('⌘⇞');
    expect(formatShortcut('Ctrl+PageDown', false)).toBe('Ctrl+PageDown');
  });

  it('Alt·Shift 단독도 기호로', () => {
    expect(formatShortcut('Alt+1', true)).toBe('⌥1');
    expect(formatShortcut('Shift+Tab', true)).toBe('⇧⇥');
  });

  it('이미 Cmd/Meta 로 적힌 조합도 같은 결과 — 표기가 두 벌로 갈리지 않는다', () => {
    expect(formatShortcut('Cmd+S', true)).toBe('⌘S');
    expect(formatShortcut('Meta+S', true)).toBe('⌘S');
    expect(formatShortcut('Ctrl+Cmd+S', true)).toBe('⌘S');
  });

  it('키가 `+` 자신이어도 쪼개지지 않는다 — 확대 단축키(Ctrl++)', () => {
    expect(formatShortcut('Ctrl++', false)).toBe('Ctrl++');
    expect(formatShortcut('Ctrl++', true)).toBe('⌘+');
    expect(formatShortcut('Ctrl+0', true)).toBe('⌘0');
  });

  it('빈 문자열은 그대로 — 라벨 자리에 undefined 를 흘리지 않는다', () => {
    expect(formatShortcut('', true)).toBe('');
    expect(formatShortcut('', false)).toBe('');
  });
});

describe('경로 키 — Linux 는 접지 않는다', () => {
  const upper = 'C:/Repos/Feature-X/';
  const lower = 'c:/repos/feature-x';

  it('win32/darwin 에서는 케이스만 다른 두 경로가 같은 키다', () => {
    expect(pathKey(upper, 'win32')).toBe(pathKey(lower, 'win32'));
    expect(pathKey(upper, 'darwin')).toBe(pathKey(lower, 'darwin'));
  });

  it('linux 에서는 서로 다른 키다 — 실재하는 두 폴더가 한 항목으로 뭉개지면 안 된다', () => {
    expect(pathKey(upper, 'linux')).not.toBe(pathKey(lower, 'linux'));
    expect(pathKey('/repos/app/Feature-X', 'linux')).toBe('/repos/app/Feature-X');
  });

  it('구분자·끝 슬래시는 플랫폼과 무관하게 정규화된다', () => {
    expect(pathKey('/repos/app/proj/', 'linux')).toBe('/repos/app/proj');
    expect(pathKey('C:\\Repos\\P\\', 'win32')).toBe('c:/repos/p');
  });
});
