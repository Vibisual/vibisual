/**
 * 멀티플랫폼 등록(audit) 회귀 — **정본에 없던 분기**들을 win/mac/linux 세 경우로 고정한다.
 *
 * 배경: `docs/rules/multiplatform.md` 는 2026-08-26 전수조사 결과를 §2 등록부에 실었지만,
 * 플랫폼 분기를 가진 파일 43개 중 22개는 그 등록부에 이름이 없었다. 그 22개를 훑어 나온 결함이
 * 이 파일이 지키는 계약이다. 전부 **같은 병**을 앓고 있었다 —
 * `process.platform` 을 함수 **안에서** 읽어, 그 분기가 Windows 개발기에서 영영 실행되지 않는 것.
 *
 * 그래서 고친 방식도 하나다: **플랫폼을 인자로 받게 만든다.** 그러면 실기가 없어도 세 OS 를 다 잰다.
 * 이 파일이 초록인 동안에는 그 22개를 다시 전수조사할 이유가 없다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isPathWithin } from '@vibisual/shared';
import { validatePathWithinRoot } from './pathValidator.js';
import { resolveWorkspacePath } from './workspaceExplorer.js';
import { aliveClaudePidsCommand, parseAliveClaudePids } from './sessionDiscovery.js';
import { unrealBuildPlatform } from './runConfigScanner.js';
import { npmCommand } from './claudeVersionService.js';
import { managedSettingsPath } from './hookInventoryService.js';
import { isAutoInstallSupported, buildSetupInstallCommand } from './claudeSetupService.js';

const THREE_OS = ['win32', 'darwin', 'linux'] as const;

// ─────────────────────────────────────────────────────────────────────────────
// ① 경로 경계 — 세 곳이 각자 적던 `win32 ? toLowerCase : 그대로` 를 한 곳으로 모았다.
// ─────────────────────────────────────────────────────────────────────────────
describe('isPathWithin — 경로 탈출 방어의 플랫폼 규칙', () => {
  it('세 OS 모두 루트 자신과 하위 경로는 안쪽이다', () => {
    for (const platform of THREE_OS) {
      expect(isPathWithin('/srv/proj', '/srv/proj', platform)).toBe(true);
      expect(isPathWithin('/srv/proj/src/a.ts', '/srv/proj', platform)).toBe(true);
    }
  });

  it('세 OS 모두 형제 폴더의 접두사 일치는 안쪽이 아니다 — `/srv/proj-other` 가 통과하면 안 된다', () => {
    for (const platform of THREE_OS) {
      expect(isPathWithin('/srv/proj-other/secret', '/srv/proj', platform)).toBe(false);
    }
  });

  it('win/mac 은 케이스만 다른 정상 경로를 받아들인다 — 그 파일시스템에서는 같은 폴더다', () => {
    // 이것이 예전 코드의 실제 결함이다. win32 만 접었으므로 **mac 에서 정상 요청이 사유 없이 거부**됐다.
    for (const platform of ['win32', 'darwin'] as const) {
      expect(isPathWithin('/Srv/Proj/src/a.ts', '/srv/proj', platform)).toBe(true);
    }
  });

  it('linux 는 케이스가 다르면 다른 폴더다 — 접으면 남의 폴더가 안쪽으로 통과한다', () => {
    expect(isPathWithin('/Srv/Proj/src/a.ts', '/srv/proj', 'linux')).toBe(false);
  });

  it('Windows 경로는 구분자가 섞여 있어도 같은 판정을 낸다', () => {
    expect(isPathWithin('C:\\proj\\src\\a.ts', 'C:/proj', 'win32')).toBe(true);
    expect(isPathWithin('C:/proj/src/a.ts', 'C:\\proj', 'win32')).toBe(true);
    // ⚠ 이 계약이 깨지는 전형적 원인은 `path.sep` 으로 경계를 잇는 것이다 —
    //   pathKey 는 구분자를 forward slash 로 접으므로 백슬래시를 찾으면 언제나 어긋난다.
    expect(isPathWithin('C:\\proj-other\\x', 'C:/proj', 'win32')).toBe(false);
  });

  it('드라이브 루트·POSIX 루트처럼 끝에 슬래시가 있는 루트도 어긋나지 않는다', () => {
    expect(isPathWithin('C:/x/y', 'C:/', 'win32')).toBe(true);
    expect(isPathWithin('/etc/hosts', '/', 'linux')).toBe(true);
  });
});

describe('경계 판정을 쓰는 두 창구 — 호스트 플랫폼에서의 계약', () => {
  // 세 OS 판정 자체는 위 순수 함수가 잰다. 여기서는 두 호출부가 그 판정에 **실제로 위임**하는지,
  // 그리고 되돌려주는 값이 원본 대소문자 그대로인지를 본다.
  const root = path.resolve('/srv/proj');

  it('validatePathWithinRoot — 상위로 빠져나가는 경로는 null', () => {
    expect(validatePathWithinRoot('../etc/passwd', root)).toBeNull();
    expect(validatePathWithinRoot('src/../../outside.txt', root)).toBeNull();
  });

  it('validatePathWithinRoot — 안쪽 경로는 해석된 절대경로를 그대로 돌려준다', () => {
    const got = validatePathWithinRoot('src/App.tsx', root);
    expect(got).toBe(path.resolve(root, 'src/App.tsx'));
    // 대소문자를 접어 돌려주면 화면 표시·파일 열기가 전부 어긋난다 — 판정에만 접는다.
    expect(got).toContain('App.tsx');
  });

  it('resolveWorkspacePath — 루트 탈출은 null, 안쪽은 원본 케이스 유지', () => {
    expect(resolveWorkspacePath(root, '../..')).toBeNull();
    const got = resolveWorkspacePath(root, 'src/Components');
    expect(got).not.toBeNull();
    expect(got?.rel).toBe('src/Components');
    expect(got?.abs).toContain('Components');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ② 살아 있는 claude 프로세스 목록 — POSIX 는 예전에 **빈 집합**이었다(조용한 열화).
// ─────────────────────────────────────────────────────────────────────────────
describe('aliveClaudePidsCommand / parseAliveClaudePids', () => {
  it('세 OS 모두 실제로 목록을 뽑는 명령을 낸다 — POSIX 가 빈손으로 돌아가지 않는다', () => {
    expect(aliveClaudePidsCommand('win32')).toContain('tasklist');
    for (const platform of ['darwin', 'linux'] as const) {
      expect(aliveClaudePidsCommand(platform)).toContain('ps ');
    }
  });

  it('Windows — tasklist CSV 에서 claude.exe PID 를 뽑는다', () => {
    const out = [
      '"claude.exe","1234","Console","1","120,000 K"',
      '"claude.exe","5678","Console","1","98,000 K"',
      '"node.exe","9999","Console","1","10,000 K"',
    ].join('\r\n');
    expect([...parseAliveClaudePids(out, 'win32')].sort((a, b) => a - b)).toEqual([1234, 5678]);
  });

  it('POSIX — `ps -Ao pid=,comm=` 출력에서 claude PID 만 뽑는다', () => {
    const out = [
      '  501 claude',
      '  777 node',
      '  902 claude-code',
      ' 1010 bash',
    ].join('\n');
    for (const platform of ['darwin', 'linux'] as const) {
      expect([...parseAliveClaudePids(out, platform)].sort((a, b) => a - b)).toEqual([501, 902]);
    }
  });

  it('mac 의 comm 이 경로째 올 때도 마지막 조각으로 판정한다', () => {
    const out = '  501 /opt/homebrew/bin/claude\n  777 /usr/bin/node';
    expect([...parseAliveClaudePids(out, 'darwin')]).toEqual([501]);
  });

  it('빈 출력·헤더만 있는 출력은 빈 집합 — 예외로 터지지 않는다', () => {
    for (const platform of THREE_OS) {
      expect(parseAliveClaudePids('', platform).size).toBe(0);
      expect(parseAliveClaudePids('\n\n   \n', platform).size).toBe(0);
    }
  });

  it('POSIX 파서가 Windows 출력을 claude 로 착각하지 않는다(그 반대도)', () => {
    const winOut = '"claude.exe","1234","Console","1","120,000 K"';
    expect(parseAliveClaudePids(winOut, 'linux').size).toBe(0);
    const posixOut = '  501 claude';
    expect(parseAliveClaudePids(posixOut, 'win32').size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ③ 외부 도구·설치 어휘 — OS 마다 이름이 다르다.
// ─────────────────────────────────────────────────────────────────────────────
describe('unrealBuildPlatform — UBT 가 받는 타깃 이름', () => {
  it('세 OS 가 각각 Win64 / Mac / Linux', () => {
    expect(unrealBuildPlatform('win32')).toBe('Win64');
    expect(unrealBuildPlatform('darwin')).toBe('Mac');
    expect(unrealBuildPlatform('linux')).toBe('Linux');
  });

  it('모르는 플랫폼은 Linux 로 떨어진다 — UBT 어휘에 없는 문자열을 넘기지 않는다', () => {
    expect(unrealBuildPlatform('freebsd' as NodeJS.Platform)).toBe('Linux');
  });
});

describe('npmCommand', () => {
  it('Windows 만 .cmd shim, POSIX 는 npm', () => {
    expect(npmCommand('win32')).toBe('npm.cmd');
    expect(npmCommand('darwin')).toBe('npm');
    expect(npmCommand('linux')).toBe('npm');
  });
});

describe('claude 자동 설치 — 세 OS 지원 여부와 명령', () => {
  it('세 OS 모두 자동 설치를 시도할 수 있다', () => {
    for (const platform of THREE_OS) {
      expect(isAutoInstallSupported(platform)).toBe(true);
    }
  });

  it('그 밖의 OS 는 자동 설치를 시도하지 않는다 — 수동 명령만 안내한다', () => {
    expect(isAutoInstallSupported('aix' as NodeJS.Platform)).toBe(false);
  });

  it('설치 명령이 win 과 POSIX 로 갈리고, mac/linux 는 같은 것을 쓴다', () => {
    const win = buildSetupInstallCommand('win32');
    const mac = buildSetupInstallCommand('darwin');
    const linux = buildSetupInstallCommand('linux');
    expect(win).not.toBe(mac);
    expect(mac).toBe(linux);
    for (const cmd of [win, mac, linux]) expect(cmd.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ④ 홈·설정 디렉터리 — 세 OS 의 managed-settings 위치가 전부 다르다.
// ─────────────────────────────────────────────────────────────────────────────
describe('managedSettingsPath — 관리자 설정의 플랫폼별 고정 위치', () => {
  it('Windows 는 PROGRAMDATA 아래', () => {
    const got = managedSettingsPath('win32', { PROGRAMDATA: 'D:\\ProgramData' });
    expect(got).toContain('ClaudeCode');
    expect(got).toContain('managed-settings.json');
    expect(got.startsWith('D:')).toBe(true);
  });

  it('Windows 에서 PROGRAMDATA 가 없으면 기본 위치로 떨어진다', () => {
    const got = managedSettingsPath('win32', {});
    expect(got).toContain('ProgramData');
    expect(got).toContain('managed-settings.json');
  });

  it('mac 은 /Library/Application Support 아래', () => {
    expect(managedSettingsPath('darwin', {})).toBe(
      '/Library/Application Support/ClaudeCode/managed-settings.json',
    );
  });

  it('linux 는 /etc/claude-code 아래', () => {
    expect(managedSettingsPath('linux', {})).toBe('/etc/claude-code/managed-settings.json');
  });

  it('세 OS 의 경로가 서로 겹치지 않는다', () => {
    const paths = THREE_OS.map((p) => managedSettingsPath(p, { PROGRAMDATA: 'C:/ProgramData' }));
    expect(new Set(paths).size).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ 데스크톱 창 아이콘 — 다섯 곳이 같은 삼항식을 각자 적고 있던 것을 하나로 모았다.
//    desktop 패키지는 electron 을 최상위에서 import 하므로 여기서 함수를 불러올 수 없다.
//    대신 "분기가 한 곳뿐인가"를 소스로 확인한다 — 넷을 빠뜨리는 사고가 바로 그 형태였다.
// ─────────────────────────────────────────────────────────────────────────────
describe('windowIconPath — 창 아이콘 분기가 한 곳으로 모여 있는가', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = path.resolve(here, '../../../desktop/src/main/windowManager.ts');

  it('BrowserWindow 생성부에 아이콘 삼항식이 흩어져 있지 않다', () => {
    if (!fs.existsSync(file)) return; // 서버 패키지만 떼어 돌리는 환경에서는 건너뛴다
    const src = fs.readFileSync(file, 'utf8');
    const inlineTernary = src.match(/icon:\s*join\([^)]*process\.platform/g) ?? [];
    expect(inlineTernary).toHaveLength(0);
    expect(src).toContain('export function windowIconPath(');
    // 헬퍼 본문 안에만 분기가 있다.
    expect(src.match(/'icon\.ico'/g) ?? []).toHaveLength(1);
  });
});
