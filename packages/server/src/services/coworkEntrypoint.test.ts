/**
 * **Cowork + VS Code 양쪽 훅 감지** 회귀 테스트 (§5.7 #24 (c) · §3.6 설치처).
 *
 * ## 무엇이 깨져 있었나
 *
 * §5.7 #24 의 (c) 조건은 `entrypoint === 'vscode'` 한 줄이었다. 그 조건이 뜻하려던 것은
 * "사용자가 직접 연 인터랙티브 세션"인데 **VS Code 라는 한 제품의 이름으로 적혀 있어서**,
 * 같은 성격인 Cowork(Claude Desktop 로컬 세션)가 들어오자 그대로 탈락했다.
 *
 * 그리고 Cowork 는 설정 홈을 **세션마다 따로** 잡아 우리 `~/.claude/settings.json` 도 보지 않는다
 * (anthropics/claude-code#63360 "not planned", 근본 원인 #40495). 두 증상의 원인은 하나다.
 *
 * ## 이 파일이 고정하는 계약
 *
 * 1. 기존 VS Code 판정은 **한 줄도 바뀌지 않는다**(회귀 방지).
 * 2. Cowork 판정은 `entrypoint` **문자열 추측에 의존하지 않는다** — 출처 홈이 정한다.
 * 3. 경로 규약은 **세 OS 전부** 계산된다. 실기가 없으므로 이 테스트가 유일한 검증 수단이다
 *    (CLAUDE.md 멀티플랫폼 규칙 — 플랫폼을 인자로 받는 이유가 바로 이것).
 */
import { describe, it, expect } from 'vitest';
import {
  claudeDesktopUserDataDir,
  coworkConfigHome,
  coworkSessionOutputsDir,
  coworkSessionRootDirs,
  entrypointFromConfigHome,
  isCoworkSessionDirName,
  isInteractiveEntrypoint,
  parseSessionEntrypoint,
  COWORK_SESSION_DIR_NAMES,
} from '@vibisual/shared';

describe('parseSessionEntrypoint — 실측 값', () => {
  // 실측(2026-09-11, `~/.claude/sessions/*.json`): claude-vscode 7건 · sdk-cli 1건.
  it('claude-vscode 는 vscode 다 (종전 동작 불변)', () => {
    expect(parseSessionEntrypoint('claude-vscode')).toBe('vscode');
  });

  it('sdk-cli 는 sdk 다 — cli 를 포함하지만 sdk 를 먼저 본다', () => {
    expect(parseSessionEntrypoint('sdk-cli')).toBe('sdk');
  });

  it('cowork 계열 문자열도 알아본다', () => {
    expect(parseSessionEntrypoint('cowork')).toBe('cowork');
    expect(parseSessionEntrypoint('claude-cowork')).toBe('cowork');
    expect(parseSessionEntrypoint('local-agent-mode')).toBe('cowork');
  });

  it('모르는 문자열은 unknown — 인터랙티브로 넘겨짚지 않는다', () => {
    expect(parseSessionEntrypoint('something-new')).toBe('unknown');
    expect(parseSessionEntrypoint(undefined)).toBe('unknown');
    expect(parseSessionEntrypoint(42)).toBe('unknown');
  });
});

describe('isInteractiveEntrypoint — §5.7 #24 (c) 정본', () => {
  it('vscode·cowork 만 버블 후보다', () => {
    expect(isInteractiveEntrypoint('vscode')).toBe(true);
    expect(isInteractiveEntrypoint('cowork')).toBe(true);
  });

  it('sdk·cli·unknown 은 제외 — 몇 초 살다 사라지는 워커가 버블이 되면 안 된다', () => {
    expect(isInteractiveEntrypoint('cli')).toBe(false);
    expect(isInteractiveEntrypoint('sdk')).toBe(false);
    expect(isInteractiveEntrypoint('unknown')).toBe(false);
  });
});

describe('entrypointFromConfigHome — 출처가 정한다(문자열 추측 ❌)', () => {
  it('Cowork 홈에서 읽었으면 파일에 뭐라 적혀 있든 cowork 다', () => {
    // Cowork 가 `entrypoint` 에 무엇을 적는지는 실측된 바 없다. 그래서 추측하지 않는다 —
    // 그 홈에서 읽었다는 사실 자체가 근거다. Anthropic 이 문자열을 바꿔도 이 판정은 안 흔들린다.
    expect(entrypointFromConfigHome('whatever-they-call-it', 'cowork')).toBe('cowork');
    expect(entrypointFromConfigHome(undefined, 'cowork')).toBe('cowork');
  });

  it('호스트 홈에서 읽었으면 파일에 적힌 문자열을 그대로 믿는다 (종전 동작)', () => {
    expect(entrypointFromConfigHome('claude-vscode', 'host')).toBe('vscode');
    expect(entrypointFromConfigHome('sdk-cli', 'host')).toBe('sdk');
  });
});

describe('세 OS 경로 규약 — 실기가 없으니 여기서만 검증된다', () => {
  it('win32 — %APPDATA%\\Claude', () => {
    const dir = claudeDesktopUserDataDir('win32', { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }); // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    expect(dir).toBe('C:/Users/me/AppData/Roaming/Claude'); // privacy-ok — 실제 홈이 아니라 테스트 픽스처
  });

  it('win32 — APPDATA 가 없으면 USERPROFILE 로 조립한다', () => {
    const dir = claudeDesktopUserDataDir('win32', { USERPROFILE: 'C:\\Users\\me' }); // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    expect(dir).toBe('C:/Users/me/AppData/Roaming/Claude'); // privacy-ok — 실제 홈이 아니라 테스트 픽스처
  });

  it('darwin — ~/Library/Application Support/Claude', () => {
    const dir = claudeDesktopUserDataDir('darwin', { HOME: '/Users/me' });
    expect(dir).toBe('/Users/me/Library/Application Support/Claude'); // privacy-ok — 실제 홈이 아니라 테스트 픽스처
  });

  it('linux — XDG_CONFIG_HOME 우선, 없으면 ~/.config', () => {
    expect(claudeDesktopUserDataDir('linux', { HOME: '/home/me' })).toBe('/home/me/.config/Claude'); // privacy-ok — 실제 홈이 아니라 테스트 픽스처
    expect(claudeDesktopUserDataDir('linux', { HOME: '/home/me', XDG_CONFIG_HOME: '/home/me/cfg' })) // privacy-ok — 실제 홈이 아니라 테스트 픽스처
      .toBe('/home/me/cfg/Claude'); // privacy-ok — 실제 홈이 아니라 테스트 픽스처
  });

  it('환경변수가 아예 없으면 null — 없는 경로를 지어내지 않는다', () => {
    expect(claudeDesktopUserDataDir('win32', {})).toBeNull();
    expect(claudeDesktopUserDataDir('darwin', {})).toBeNull();
    expect(claudeDesktopUserDataDir('linux', {})).toBeNull();
  });

  it('루트는 신·구 이름 둘 다 낸다 — 한쪽만 보면 이름이 바뀐 시점 기준으로 한쪽이 통째로 안 보인다', () => {
    const roots = coworkSessionRootDirs('darwin', { HOME: '/Users/me' });
    expect(roots).toHaveLength(COWORK_SESSION_DIR_NAMES.length);
    expect(roots[0]).toContain('claude-code-sessions');
    expect(roots.some((r) => r.includes('local-agent-mode-sessions'))).toBe(true);
  });
});

describe('세션 디렉터리 이름 판정', () => {
  it('local- 접두사 uuid 와 맨 uuid 를 받는다 (실측 형태)', () => {
    expect(isCoworkSessionDirName('local-29ba2755-f6ed-4d05-8804-2a075d39eae6')).toBe(true);
    expect(isCoworkSessionDirName('29ba2755-f6ed-4d05-8804-2a075d39eae6')).toBe(true);
  });

  it('세션이 아닌 이름은 거른다 — 그 아래를 훑으면 수만 개 디렉터리가 된다', () => {
    expect(isCoworkSessionDirName('cowork_plugins')).toBe(false);
    expect(isCoworkSessionDirName('outputs')).toBe(false);
    expect(isCoworkSessionDirName('.claude')).toBe(false);
    expect(isCoworkSessionDirName('local-not-a-uuid')).toBe(false);
  });
});

describe('세션 안의 자리', () => {
  const sessionDir = '/Library/Application Support/Claude/claude-code-sessions/org/user/local-29ba2755-f6ed-4d05-8804-2a075d39eae6';

  it('설정 홈은 세션 아래 .claude — 우리 훅을 심을 자리다', () => {
    expect(coworkConfigHome(sessionDir)).toBe(`${sessionDir}/.claude`);
  });

  it('cwd 는 세션 아래 outputs', () => {
    expect(coworkSessionOutputsDir(sessionDir)).toBe(`${sessionDir}/outputs`);
  });
});
