import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { riderToolboxRoots, scanToolboxCandidates } from './externalDebuggerService.js';

/**
 * §5.5 #17-20 ⑦ — JetBrains 가 지금 기본으로 미는 배포 창구는 **Toolbox** 다.
 *
 * 종전엔 Windows 만 채널 폴더를 순회하고 mac/Linux 는 `/Applications/Rider.app`,
 * `/usr/local/bin/rider` 같은 고정 경로 하나씩만 봤다 — Toolbox 로 깐 사용자는 멀쩡히
 * 설치돼 있는데도 화면에 "설치되어 있지 않음"이 떴다. 세 플랫폼의 레이아웃을 여기서 고정한다.
 */

/** 테스트용 가짜 홈 — 실제 사용자 경로가 아니라 픽스처다. */
const MAC_HOME = '/Users/t';
const NIX_HOME = '/home/t';
const WIN_HOME = 'C:/Users/t'; // privacy-ok — 실제 홈이 아니라 테스트 픽스처

let home: string;

function touch(...segments: string[]): string {
  const file = path.join(home, ...segments);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x');
  return file;
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-toolbox-'));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe('riderToolboxRoots', () => {
  it('mac 은 ~/Library/Application Support 아래 + .app 번들 안까지 들어간다', () => {
    const roots = riderToolboxRoots('darwin', MAC_HOME, {});
    expect(roots[0]?.root).toBe(path.join(MAC_HOME, 'Library', 'Application Support', 'JetBrains', 'Toolbox', 'apps', 'Rider'));
    // `.app` 은 폴더라 그 자리를 spawn 할 수 없다 — Contents/MacOS 까지 가야 한다.
    expect(roots[0]?.relatives).toContainEqual(['Rider.app', 'Contents', 'MacOS', 'rider']);
  });

  it('linux 는 ~/.local/share 아래', () => {
    const roots = riderToolboxRoots('linux', NIX_HOME, {});
    expect(roots[0]?.root).toBe(path.join(NIX_HOME, '.local', 'share', 'JetBrains', 'Toolbox', 'apps', 'Rider'));
  });

  it('windows 는 LOCALAPPDATA 아래', () => {
    const roots = riderToolboxRoots('win32', WIN_HOME, { LOCALAPPDATA: `${WIN_HOME}/AppData/Local` });
    expect(roots[0]?.root).toBe(path.join(`${WIN_HOME}/AppData/Local`, 'JetBrains', 'Toolbox', 'apps', 'Rider'));
  });

  it('windows 에 LOCALAPPDATA 가 없으면 훑을 자리도 없다', () => {
    expect(riderToolboxRoots('win32', WIN_HOME, {})).toEqual([]);
  });
});

describe('scanToolboxCandidates', () => {
  it('mac — 채널 폴더 안 .app 번들을 찾아낸다', () => {
    const bin = touch('Library', 'Application Support', 'JetBrains', 'Toolbox', 'apps', 'Rider', 'ch-0', 'Rider.app', 'Contents', 'MacOS', 'rider');
    expect(scanToolboxCandidates('darwin', home, {})).toContain(bin);
  });

  it('mac — 채널 아래 버전 폴더가 한 겹 더 있어도 찾아낸다', () => {
    const bin = touch('Library', 'Application Support', 'JetBrains', 'Toolbox', 'apps', 'Rider', 'ch-0', '253.1234.56', 'Rider.app', 'Contents', 'MacOS', 'rider');
    expect(scanToolboxCandidates('darwin', home, {})).toContain(bin);
  });

  it('linux — 채널 폴더 안 bin/rider.sh 를 찾아낸다', () => {
    const bin = touch('.local', 'share', 'JetBrains', 'Toolbox', 'apps', 'Rider', 'ch-0', 'bin', 'rider.sh');
    expect(scanToolboxCandidates('linux', home, {})).toContain(bin);
  });

  it('windows — 채널 폴더 안 rider64.exe 를 찾아낸다', () => {
    const bin = touch('AppData', 'Local', 'JetBrains', 'Toolbox', 'apps', 'Rider', 'ch-1', 'bin', 'rider64.exe');
    const found = scanToolboxCandidates('win32', home, { LOCALAPPDATA: path.join(home, 'AppData', 'Local') });
    expect(found).toContain(bin);
  });

  it('채널이 여럿이면 사전순 뒤쪽(=대체로 최신)이 앞에 선다', () => {
    touch('.local', 'share', 'JetBrains', 'Toolbox', 'apps', 'Rider', 'ch-0', 'bin', 'rider.sh');
    const newer = touch('.local', 'share', 'JetBrains', 'Toolbox', 'apps', 'Rider', 'ch-1', 'bin', 'rider.sh');
    expect(scanToolboxCandidates('linux', home, {})[0]).toBe(newer);
  });

  it('Toolbox 미설치면 빈 배열 (예외로 새지 않는다)', () => {
    expect(scanToolboxCandidates('darwin', home, {})).toEqual([]);
    expect(scanToolboxCandidates('linux', home, {})).toEqual([]);
  });
});
