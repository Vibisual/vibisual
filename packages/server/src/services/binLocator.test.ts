import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  augmentedEnvIn,
  augmentedPathDirs,
  augmentedPathValue,
  binFileNames,
  isExecutableFileSync,
  knownBinDirs,
  needsLoginShellPath,
  parseLoginShellOutput,
  resolveBinary,
  resolveBinaryIn,
  splitPathValue,
  type BinLocatorContext,
} from './binLocator.js';

const IS_WIN = process.platform === 'win32';

/**
 * 이 테스트가 있는 이유: **Finder 로 띄운 macOS 앱은 PATH 가 넉 줄뿐**이라는 사고를
 * 우리 개발기(Windows)에서는 절대 재현할 수 없다. 그래서 플랫폼·env·존재확인을 전부 주입해
 * win/mac/linux 세 경우를 그 OS 에 가지 않고 여기서 고정한다.
 */

/** Finder/Dock 으로 띄운 macOS 앱이 실제로 받는 PATH(=launchd 기본). */
const LAUNCHD_MINIMAL_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

/**
 * 테스트용 가짜 홈. 실제 사용자 경로가 아니라 픽스처이며, 홈 경로를 여기 한 곳에 모아 두면
 * 각 기대값이 `${MAC_HOME}/...` 조합으로 읽혀 공개 커밋 스캐너의 홈경로 오탐도 이 세 줄로 끝난다.
 */
const WIN_HOME = 'C:\\Users\\tester'; // privacy-ok — 실제 홈이 아니라 테스트 픽스처
const MAC_HOME = '/Users/tester';
const NIX_HOME = '/home/tester';

function ctxFor(
  platform: NodeJS.Platform,
  opts: {
    pathValue?: string;
    present?: string[];
    home?: string;
    loginShellPath?: string | null;
    env?: NodeJS.ProcessEnv;
  } = {},
): BinLocatorContext {
  const home = opts.home ?? (platform === 'win32' ? WIN_HOME : MAC_HOME);
  const present = new Set(opts.present ?? []);
  return {
    platform,
    env: { PATH: opts.pathValue ?? '', ...(opts.env ?? {}) },
    home,
    isExecutableFile: (c) => present.has(c),
    loginShellPath: opts.loginShellPath ?? null,
  };
}

describe('splitPathValue', () => {
  it('windows 는 세미콜론, posix 는 콜론으로 자른다', () => {
    expect(splitPathValue('C:\\a;C:\\b', 'win32')).toEqual(['C:\\a', 'C:\\b']);
    expect(splitPathValue('/usr/bin:/bin', 'darwin')).toEqual(['/usr/bin', '/bin']);
  });

  it('fish 처럼 공백으로 이어 붙은 PATH 도 살려 낸다', () => {
    // fish 의 $PATH 는 리스트라 `echo "$PATH"` 가 공백 구분으로 나온다.
    expect(splitPathValue('/opt/homebrew/bin /usr/bin /bin', 'darwin')).toEqual([
      '/opt/homebrew/bin',
      '/usr/bin',
      '/bin',
    ]);
  });

  it('빈 항목은 버린다', () => {
    expect(splitPathValue('/usr/bin::/bin:', 'linux')).toEqual(['/usr/bin', '/bin']);
  });
});

describe('knownBinDirs', () => {
  it('macOS 는 Apple Silicon·Intel Homebrew 를 둘 다 든다', () => {
    const dirs = knownBinDirs(ctxFor('darwin'));
    expect(dirs).toContain('/opt/homebrew/bin');
    expect(dirs).toContain('/usr/local/bin');
    expect(dirs).toContain(`${MAC_HOME}/.local/bin`);
    expect(dirs).toContain(`${MAC_HOME}/go/bin`);
    expect(dirs).toContain(`${MAC_HOME}/.cargo/bin`);
    expect(dirs).toContain(`${MAC_HOME}/.dotnet/tools`);
  });

  it('linux 는 snap 을 든다', () => {
    const dirs = knownBinDirs(ctxFor('linux', { home: NIX_HOME }));
    expect(dirs).toContain('/snap/bin');
    expect(dirs).toContain('/usr/bin');
    expect(dirs).toContain(`${NIX_HOME}/.local/bin`);
  });

  it('windows 는 winget Links·npm 전역을 든다', () => {
    const dirs = knownBinDirs(
      ctxFor('win32', { env: { LOCALAPPDATA: `${WIN_HOME}\\AppData\\Local`, APPDATA: `${WIN_HOME}\\AppData\\Roaming` } }),
    );
    expect(dirs).toContain(`${WIN_HOME}\\AppData\\Local\\Microsoft\\WinGet\\Links`);
    expect(dirs).toContain(`${WIN_HOME}\\AppData\\Roaming\\npm`);
  });
});

describe('binFileNames', () => {
  it('windows 는 PATHEXT 변형을 붙인다', () => {
    const names = binFileNames('code', ctxFor('win32', { env: { PATHEXT: '.COM;.EXE;.BAT;.CMD' } }));
    expect(names).toContain('code');
    expect(names).toContain('code.exe');
    expect(names).toContain('code.cmd');
    expect(names).toContain('code.bat');
  });

  it('windows 에서 이미 확장자가 있으면 그대로 쓴다', () => {
    expect(binFileNames('code.cmd', ctxFor('win32'))).toEqual(['code.cmd']);
  });

  it('posix 는 이름 하나뿐', () => {
    expect(binFileNames('ffmpeg', ctxFor('darwin'))).toEqual(['ffmpeg']);
  });
});

describe('augmentedPathDirs', () => {
  it('macOS launchd 최소 PATH 에 Homebrew 를 보강한다', () => {
    const dirs = augmentedPathDirs(ctxFor('darwin', { pathValue: LAUNCHD_MINIMAL_PATH }));
    expect(dirs.slice(0, 4)).toEqual(['/usr/bin', '/bin', '/usr/sbin', '/sbin']); // 원래 PATH 가 먼저
    expect(dirs).toContain('/opt/homebrew/bin');
    expect(dirs).toContain('/usr/local/bin');
  });

  it('로그인 셸 PATH 는 알려진 위치보다 앞에 붙는다', () => {
    const dirs = augmentedPathDirs(
      ctxFor('darwin', { pathValue: LAUNCHD_MINIMAL_PATH, loginShellPath: '/opt/custom/bin:/opt/homebrew/bin' }),
    );
    expect(dirs.indexOf('/opt/custom/bin')).toBeGreaterThan(-1);
    expect(dirs.indexOf('/opt/custom/bin')).toBeLessThan(dirs.indexOf('/opt/local/bin'));
  });

  it('중복은 한 번만 남고 원래 PATH 순서를 밀어내지 않는다', () => {
    const dirs = augmentedPathDirs(ctxFor('darwin', { pathValue: '/opt/homebrew/bin:/usr/bin' }));
    expect(dirs.filter((d) => d === '/opt/homebrew/bin')).toHaveLength(1);
    expect(dirs[0]).toBe('/opt/homebrew/bin');
  });
});

describe('resolveBinaryIn', () => {
  it('mac: PATH 에 없어도 Homebrew 자리의 brew 를 찾아낸다', () => {
    const ctx = ctxFor('darwin', { pathValue: LAUNCHD_MINIMAL_PATH, present: ['/opt/homebrew/bin/brew'] });
    expect(resolveBinaryIn('brew', ctx)).toBe('/opt/homebrew/bin/brew');
  });

  it('mac: dlv 가 ~/go/bin 에 있으면 찾아낸다 (디버그 어댑터 "없음" 오진의 원인)', () => {
    const ctx = ctxFor('darwin', { pathValue: LAUNCHD_MINIMAL_PATH, present: [`${MAC_HOME}/go/bin/dlv`] });
    expect(resolveBinaryIn('dlv', ctx)).toBe(`${MAC_HOME}/go/bin/dlv`);
  });

  it('linux: snap 으로 깐 code 를 찾아낸다', () => {
    const ctx = ctxFor('linux', { home: NIX_HOME, pathValue: '/usr/bin:/bin', present: ['/snap/bin/code'] });
    expect(resolveBinaryIn('code', ctx)).toBe('/snap/bin/code');
  });

  it('windows: PATHEXT 를 붙여 .cmd 를 찾아낸다', () => {
    const ctx = ctxFor('win32', {
      pathValue: 'C:\\tools',
      env: { PATHEXT: '.COM;.EXE;.BAT;.CMD' },
      present: ['C:\\tools\\code.cmd'],
    });
    expect(resolveBinaryIn('code', ctx)).toBe('C:\\tools\\code.cmd');
  });

  it('PATH 가 알려진 위치보다 우선한다(사용자가 앞세운 버전을 존중)', () => {
    const ctx = ctxFor('darwin', {
      pathValue: '/opt/mine/bin:/usr/bin',
      present: ['/opt/mine/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg'],
    });
    expect(resolveBinaryIn('ffmpeg', ctx)).toBe('/opt/mine/bin/ffmpeg');
  });

  it('extraCandidates 는 마지막 방어선 — .app 번들 안 CLI 런처', () => {
    const bundle = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code';
    const ctx = ctxFor('darwin', { pathValue: LAUNCHD_MINIMAL_PATH, present: [bundle] });
    expect(resolveBinaryIn('code', ctx, [bundle])).toBe(bundle);
  });

  it('아무 데도 없으면 null (조용한 성공을 만들지 않는다)', () => {
    expect(resolveBinaryIn('nope', ctxFor('darwin', { pathValue: LAUNCHD_MINIMAL_PATH }))).toBeNull();
  });

  it('경로가 든 이름은 PATH 를 훑지 않고 그 자리만 본다', () => {
    const ctx = ctxFor('linux', { home: NIX_HOME, pathValue: '/usr/bin', present: ['/opt/x/tool'] });
    expect(resolveBinaryIn('/opt/x/tool', ctx)).toBe('/opt/x/tool');
    expect(resolveBinaryIn('/opt/y/tool', ctx)).toBeNull();
  });

  it('빈 이름은 null', () => {
    expect(resolveBinaryIn('   ', ctxFor('darwin'))).toBeNull();
  });
});

describe('augmentedEnvIn', () => {
  it('PATH 만 보강하고 나머지 변수는 그대로 둔다', () => {
    const ctx = ctxFor('darwin', { pathValue: LAUNCHD_MINIMAL_PATH });
    const out = augmentedEnvIn(ctx, { PATH: LAUNCHD_MINIMAL_PATH, LANG: 'ko_KR.UTF-8' });
    expect(out['LANG']).toBe('ko_KR.UTF-8');
    expect(out['PATH']).toContain('/opt/homebrew/bin');
    expect(out['PATH']?.startsWith(LAUNCHD_MINIMAL_PATH)).toBe(true);
  });

  it('windows 의 `Path` 케이스 변형을 하나로 접는다', () => {
    const ctx = ctxFor('win32', { pathValue: 'C:\\tools' });
    const out = augmentedEnvIn(ctx, { Path: 'C:\\tools', OTHER: '1' });
    expect(Object.keys(out).filter((k) => k.toLowerCase() === 'path')).toEqual(['PATH']);
    expect(out['PATH']).toContain('C:\\tools');
    expect(out['OTHER']).toBe('1');
  });

  it('base 를 안 주면 컨텍스트 env 를 쓴다', () => {
    const ctx = ctxFor('linux', { home: NIX_HOME, pathValue: '/usr/bin' });
    expect(augmentedEnvIn(ctx)['PATH']).toBe(augmentedPathValue(ctx));
  });
});

describe('needsLoginShellPath', () => {
  it('mac launchd 최소 PATH 면 읽어야 한다', () => {
    expect(needsLoginShellPath({ platform: 'darwin', env: { PATH: LAUNCHD_MINIMAL_PATH }, home: MAC_HOME })).toBe(true);
  });

  it('이미 Homebrew 가 PATH 에 있으면 셸을 띄우지 않는다', () => {
    expect(
      needsLoginShellPath({ platform: 'darwin', env: { PATH: `/opt/homebrew/bin:${LAUNCHD_MINIMAL_PATH}` }, home: MAC_HOME }),
    ).toBe(false);
  });

  it('linux 기본 PATH(/usr/local/bin 포함)면 띄우지 않는다', () => {
    expect(
      needsLoginShellPath({ platform: 'linux', env: { PATH: '/usr/local/bin:/usr/bin:/bin' }, home: NIX_HOME }),
    ).toBe(false);
  });

  it('windows 는 절대 셸을 띄우지 않는다', () => {
    expect(needsLoginShellPath({ platform: 'win32', env: { PATH: 'C:\\Windows' }, home: WIN_HOME })).toBe(false);
  });
});

describe('parseLoginShellOutput', () => {
  it('배너·MOTD 가 섞여도 표식 줄만 뽑는다', () => {
    const out = ['Welcome to your shell!', 'Last login: ...', '__VIBISUAL_PATH__/opt/homebrew/bin:/usr/bin', ''].join('\n');
    expect(parseLoginShellOutput(out)).toBe('/opt/homebrew/bin:/usr/bin');
  });

  it('표식이 없으면 null', () => {
    expect(parseLoginShellOutput('nothing here\n')).toBeNull();
  });

  it('표식만 있고 값이 비면 null', () => {
    expect(parseLoginShellOutput('__VIBISUAL_PATH__\n')).toBeNull();
  });
});

// ─── 실제 파일시스템 판정 (주입이 아니라 진짜 fs 를 쓰는 유일한 부분) ───

describe('isExecutableFileSync', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-binloc-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('평범한 파일은 있다고 답한다', () => {
    const f = path.join(dir, IS_WIN ? 'tool.exe' : 'tool');
    fs.writeFileSync(f, 'x');
    if (!IS_WIN) fs.chmodSync(f, 0o755);
    expect(isExecutableFileSync(f)).toBe(true);
  });

  it('폴더는 실행 파일이 아니다', () => {
    expect(isExecutableFileSync(dir)).toBe(false);
  });

  it('없는 경로는 false', () => {
    expect(isExecutableFileSync(path.join(dir, 'nope'))).toBe(false);
  });

  it.runIf(!IS_WIN)('POSIX 는 실행 권한이 없으면 false', () => {
    const f = path.join(dir, 'not-exec');
    fs.writeFileSync(f, 'x');
    fs.chmodSync(f, 0o644);
    expect(isExecutableFileSync(f)).toBe(false);
  });

  /**
   * Windows 앱 실행 별칭 회귀 — `%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe` 는 재분석
   * 지점이라 `statSync` 가 EACCES 로 죽고 `existsSync` 도 false 다(2026-08-26 실측). 그런데
   * `spawn` 은 정상 실행한다. 이 보정이 빠지면 ffmpeg 설치 대행(`winget install`)이 통째로 죽는다.
   */
  it.runIf(IS_WIN)('Windows: where.exe 가 찾는 것은 우리도 찾아야 한다 (winget 앱 실행 별칭)', () => {
    let fromWhere: string | null = null;
    try {
      const out = execFileSync('where.exe', ['winget'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      fromWhere = out.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? null;
    } catch {
      fromWhere = null; // 이 PC 엔 winget 이 없다 — 검사할 것도 없다
    }
    if (!fromWhere) return;
    expect(resolveBinary('winget')).not.toBeNull();
  });
});
