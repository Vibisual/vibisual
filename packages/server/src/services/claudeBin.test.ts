import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * §4 (실행본 자가 복구) — 앱이 도는 중에 `claude` 실행본이 **앱 밖에서** 바뀌는 경우를 다룬다.
 *
 * 실제 사고(2026-08-19): VS Code 가 확장을 `anthropic.claude-code-2.1.234-…` → `…-2.1.235-…` 로
 * 갈아치우며 옛 폴더를 통째로 지웠는데, 지연 캐시가 죽은 경로를 계속 돌려줘 모든 spawn 이
 * `ENOENT`(Windows libuv `-4058`) 로 죽었다. 앱을 껐다 켜기 전에는 복구되지 않았다.
 *
 * 홈 디렉터리는 mock 없이 갈아끼운다 — `os.homedir()` 는 Windows 에서 `USERPROFILE`,
 * POSIX 에서 `HOME` 환경변수를 먼저 본다. 그래야 `vi.mock('node:os')` 호이스팅 함정을 피하면서
 * 실제 파일시스템 위에서 "폴더가 사라졌다"를 그대로 재현할 수 있다.
 */

const IS_WIN = process.platform === 'win32';
const BIN_FILE = IS_WIN ? 'claude.exe' : 'claude';

type ClaudeBinModule = typeof import('./claudeBin.js');

let tmpHome: string;
let mod: ClaudeBinModule;
const ENV_KEYS = ['USERPROFILE', 'HOME', 'PATH', 'APPDATA'] as const;
let envBackup: Record<string, string | undefined>;

/** 확장 번들 하나를 만든다 — `<home>/<ide>/extensions/anthropic.claude-code-<ver>/resources/native-binary/claude`. */
function makeExtensionBin(version: string, ide = '.vscode'): string {
  const extRoot = path.join(tmpHome, ide, 'extensions', `anthropic.claude-code-${version}-win32-x64`);
  const dir = path.join(extRoot, 'resources', 'native-binary');
  fs.mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, BIN_FILE);
  fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n');
  if (!IS_WIN) fs.chmodSync(bin, 0o755);
  return bin;
}

/** 확장 폴더를 통째로 지운다 — VS Code 가 갱신 때 하는 짓 그대로. */
function removeExtension(version: string, ide = '.vscode'): void {
  fs.rmSync(path.join(tmpHome, ide, 'extensions', `anthropic.claude-code-${version}-win32-x64`), {
    recursive: true,
    force: true,
  });
}

/**
 * VS Code 가 갱신 때 옛 번들에 하는 다른 짓 — 폴더는 그대로 두고 `<extensions>/.obsolete` 에
 * 폐기 표시만 적는다(다음 VS Code 시작 때 지운다). 실측 파일 모양 그대로: `{"<폴더 이름>": true}`.
 */
function markObsolete(versions: string[], ide = '.vscode'): void {
  const extDir = path.join(tmpHome, ide, 'extensions');
  fs.mkdirSync(extDir, { recursive: true });
  fs.writeFileSync(
    path.join(extDir, '.obsolete'),
    JSON.stringify(Object.fromEntries(versions.map((v) => [`anthropic.claude-code-${v}-win32-x64`, true]))),
  );
}

/** PATH 에 올라 있는 설치본 하나(npm 전역·Homebrew 같은 부류) — PATH 를 그 디렉터리로 바꾼다. */
function makePathBin(): string {
  const dir = path.join(tmpHome, 'pathbin');
  fs.mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, BIN_FILE);
  fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n');
  if (!IS_WIN) fs.chmodSync(bin, 0o755);
  process.env['PATH'] = dir;
  return bin;
}

/** 공식 네이티브 인스톨러 위치(`~/.local/bin`)의 실행본. */
function makeNativeBin(): string {
  const dir = path.join(tmpHome, '.local', 'bin');
  fs.mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, BIN_FILE);
  fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n');
  if (!IS_WIN) fs.chmodSync(bin, 0o755);
  return bin;
}

/** 옵션창 Version 탭이 저장하는 override. */
function writeOverride(binPath: string): void {
  fs.mkdirSync(path.join(tmpHome, '.vibisual'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpHome, '.vibisual', 'user-defaults.json'),
    JSON.stringify({ claudeBinPath: binPath }, null, 2),
  );
}

beforeEach(async () => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-claudebin-'));
  envBackup = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env['USERPROFILE'] = tmpHome;
  process.env['HOME'] = tmpHome;
  process.env['PATH'] = ''; // 진짜로 깔린 claude 를 줍지 않도록 — 테스트는 tmpHome 안만 본다.
  process.env['APPDATA'] = path.join(tmpHome, 'AppData', 'Roaming');

  // 모듈 상태(지연 캐시 · 모듈 로드 시 굳는 override 파일 경로)를 매번 새로 세운다.
  vi.resetModules();
  mod = await import('./claudeBin.js');
});

afterEach(() => {
  vi.useRealTimers();
  for (const k of ENV_KEYS) {
    const v = envBackup[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('getClaudeBin — 확장 자동 갱신 추종', () => {
  it('확장이 새 버전 폴더로 갈아치워지면 다음 호출이 새 번들을 잡는다', () => {
    const oldBin = makeExtensionBin('2.1.234');
    expect(mod.getClaudeBin()).toEqual({ binPath: oldBin, source: 'vscode-extension' });

    // VS Code 갱신 재현 — 새 폴더 생성 + 옛 폴더 삭제.
    const newBin = makeExtensionBin('2.1.235');
    removeExtension('2.1.234');

    // 종전에는 캐시가 죽은 경로를 계속 돌려줘 여기서 spawn ENOENT 가 났다.
    expect(mod.getClaudeBin()).toEqual({ binPath: newBin, source: 'vscode-extension' });
  });

  it('VS Code 가 옛 번들을 지우지 않고 폐기 표시만 해도 다음 호출이 새 번들로 옮겨 간다', () => {
    const oldBin = makeExtensionBin('2.1.285');
    expect(mod.getClaudeBin().binPath).toBe(oldBin);

    // 실측 사고(2026-10-04) 재현 — 2.1.288 이 깔리고 2.1.285 는 `.obsolete` 에만 적힌 채 폴더가 남는다.
    const newBin = makeExtensionBin('2.1.288');
    markObsolete(['2.1.285']);

    // 종전에는 옛 파일이 그대로 있어 캐시가 2.1.285 를 계속 돌려줬다(VS Code 를 다시 켤 때까지).
    expect(mod.getClaudeBin()).toEqual({ binPath: newBin, source: 'vscode-extension' });
  });

  it('최후 수단으로 든 폐기 번들은 간격을 두고 다시 찾아 새 설치본으로 옮겨 간다', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    const doomed = makeExtensionBin('2.1.285');
    markObsolete(['2.1.285']);

    const first = mod.getClaudeBin();
    expect(first).toEqual({ binPath: doomed, source: 'vscode-extension' });
    expect(mod.getClaudeBin()).toBe(first); // 간격 안에서는 매 호출 전수 재탐색 ❌

    const newBin = makeExtensionBin('2.1.288');
    vi.setSystemTime(1_000_000 + 1_001);
    expect(mod.getClaudeBin()).toEqual({ binPath: newBin, source: 'vscode-extension' });
  });

  it('실행본이 그대로면 같은 값을 계속 돌려준다(불필요한 재해석 ❌)', () => {
    const bin = makeExtensionBin('2.1.235');
    const first = mod.getClaudeBin();
    expect(first.binPath).toBe(bin);
    expect(mod.getClaudeBin()).toBe(first); // 같은 객체 = 캐시 명중
  });

  it('아무것도 못 찾으면 낙관적 폴백 그대로 — 설치되면 그 뒤 호출이 잡는다', () => {
    expect(mod.getClaudeBin()).toEqual({ binPath: 'claude', source: 'path' });

    const native = makeNativeBin();
    // 폴백은 stat 할 대상이 없어 간격(TTL)으로만 재탐색한다 — ENOENT 신고가 오면 즉시 버린다.
    expect(mod.noteClaudeSpawnFailure(Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }))).toBe(true);
    expect(mod.getClaudeBin()).toEqual({ binPath: native, source: 'native' });
  });
});

describe('resolveClaudeBin — override 승계', () => {
  it('override 가 살아 있으면 그대로 쓴다', () => {
    const bin = makeExtensionBin('2.1.235');
    makeNativeBin(); // 네이티브가 있어도 override 가 최우선
    writeOverride(bin);
    expect(mod.resolveClaudeBin()).toEqual({ binPath: bin, source: 'vscode-extension' });
  });

  it('override 가 갱신으로 사라진 확장이면 같은 확장의 최신 번들로 승계하고 그 값을 되쓴다', () => {
    const oldBin = makeExtensionBin('2.1.234');
    writeOverride(oldBin);

    const newBin = makeExtensionBin('2.1.235');
    removeExtension('2.1.234');

    const written: string[] = [];
    mod.setClaudeBinOverrideWriter((p) => written.push(p));

    expect(mod.resolveClaudeBin()).toEqual({ binPath: newBin, source: 'vscode-extension' });
    expect(written).toEqual([newBin]); // Version 탭의 selected 판정이 어긋나지 않도록 되쓴다
  });

  it('되쓰기 창구가 없어도 승계 자체는 동작한다', () => {
    const oldBin = makeExtensionBin('2.1.234');
    writeOverride(oldBin);
    const newBin = makeExtensionBin('2.1.235');
    removeExtension('2.1.234');

    expect(mod.resolveClaudeBin().binPath).toBe(newBin);
  });

  it('승계할 번들이 없으면 종전대로 자동 우선순위로 폴백한다', () => {
    const oldBin = makeExtensionBin('2.1.234');
    writeOverride(oldBin);
    const native = makeNativeBin();
    removeExtension('2.1.234');

    expect(mod.resolveClaudeBin()).toEqual({ binPath: native, source: 'native' });
  });

  it('다른 IDE 의 확장으로는 건너뛰지 않는다 — 승계는 같은 extensions 디렉터리 안에서만', () => {
    const cursorBin = makeExtensionBin('2.1.234', '.cursor');
    writeOverride(cursorBin);
    const vscodeNew = makeExtensionBin('2.1.235', '.vscode');
    removeExtension('2.1.234', '.cursor');

    // 같은 `.cursor` 안에 승계 대상이 없으므로 자동 우선순위(= 최신 확장)로 폴백한다.
    // 승계였다면 사용자가 고르지도 않은 IDE 의 번들을 "그 선택의 후계"로 삼는 셈이 된다.
    expect(mod.succeedStaleExtensionOverride(cursorBin)).toBeNull();
    expect(mod.resolveClaudeBin()).toEqual({ binPath: vscodeNew, source: 'vscode-extension' });
  });

  it('확장 번들이 아닌 경로는 승계 대상이 아니다', () => {
    expect(mod.succeedStaleExtensionOverride(path.join(tmpHome, '.local', 'bin', BIN_FILE))).toBeNull();
  });

  it('override 번들이 폐기 표시되면 폴더가 남아 있어도 같은 확장의 최신 번들로 승계하고 그 값을 되쓴다', () => {
    const oldBin = makeExtensionBin('2.1.285');
    writeOverride(oldBin);
    const newBin = makeExtensionBin('2.1.288');
    markObsolete(['2.1.285']);

    const written: string[] = [];
    mod.setClaudeBinOverrideWriter((p) => written.push(p));

    // 종전에는 옛 파일이 살아 있다는 이유로 override 를 그대로 써, 사용자가 고른 확장이 갱신돼도 옛 버전에 묶였다.
    expect(mod.resolveClaudeBin()).toEqual({ binPath: newBin, source: 'vscode-extension' });
    expect(written).toEqual([newBin]);
  });

  it('폐기 표시됐어도 이을 번들이 없으면(확장 제거 대기) 사용자가 고른 번들을 그대로 쓴다', () => {
    const bin = makeExtensionBin('2.1.285');
    writeOverride(bin);
    makeNativeBin();
    markObsolete(['2.1.285']);

    const written: string[] = [];
    mod.setClaudeBinOverrideWriter((p) => written.push(p));

    expect(mod.resolveClaudeBin()).toEqual({ binPath: bin, source: 'vscode-extension' });
    expect(written).toEqual([]);
  });
});

describe('확장 번들 고르기 — 버전 순서와 폐기 표시', () => {
  it('버전은 숫자로 비교한다 — 2.1.288 이 2.1.99 보다, 2.1.1000 이 2.1.999 보다 새것이다', () => {
    makeExtensionBin('2.1.99');
    const b288 = makeExtensionBin('2.1.288');
    // 종전 문자열 정렬은 '9' > '2' 라 2.1.99 를 최신으로 골랐다.
    expect(mod.resolveClaudeBin().binPath).toBe(b288);

    makeExtensionBin('2.1.999');
    const b1000 = makeExtensionBin('2.1.1000');
    expect(mod.resolveClaudeBin().binPath).toBe(b1000);
  });

  it('폐기 표시된 번들은 Version 탭 설치본 목록에 올리지 않는다', () => {
    makeExtensionBin('2.1.285');
    const newBin = makeExtensionBin('2.1.288');
    markObsolete(['2.1.285']);

    // tmpHome 밖(시스템 Homebrew 등)에 진짜 설치본이 있는 기계에서도 흔들리지 않게 이 시험의 것만 본다.
    const mine = mod.discoverAllClaudeBins().filter((c) => c.binPath.startsWith(tmpHome));
    expect(mine).toEqual([{ binPath: newBin, source: 'vscode-extension' }]);
  });

  it('폐기 번들은 최후 수단 — 그것뿐이면 쓰지만 다른 설치본이 생기면 그쪽이 먼저다', () => {
    const doomed = makeExtensionBin('2.1.285');
    markObsolete(['2.1.285']);
    // bare 'claude'(= spawn ENOENT) 로 떨어뜨리면 아직 도는 실행본을 버리게 된다.
    expect(mod.resolveClaudeBin()).toEqual({ binPath: doomed, source: 'vscode-extension' });

    const pathBin = makePathBin();
    expect(mod.resolveClaudeBin()).toEqual({ binPath: pathBin, source: 'path' });
  });

  it('.obsolete 가 깨져 있으면 폐기 표시가 없는 것으로 본다(종전 동작)', () => {
    const bin = makeExtensionBin('2.1.285');
    fs.writeFileSync(path.join(tmpHome, '.vscode', 'extensions', '.obsolete'), '{not json');
    expect(mod.resolveClaudeBin()).toEqual({ binPath: bin, source: 'vscode-extension' });
  });
});

describe('classifyClaudeBinSource', () => {
  it('구분자가 `/` 로 저장된 override 도 확장 번들로 알아본다', () => {
    const withSlashes = `${tmpHome.replace(/\\/g, '/')}/.vscode/extensions/anthropic.claude-code-2.1.235-win32-x64/resources/native-binary/${BIN_FILE}`;
    expect(mod.classifyClaudeBinSource(withSlashes)).toBe('vscode-extension');
  });

  it('네이티브 설치 위치가 확장보다 먼저 판정된다', () => {
    expect(mod.classifyClaudeBinSource(path.join(tmpHome, '.local', 'bin', BIN_FILE))).toBe('native');
  });
});

describe('noteClaudeSpawnFailure', () => {
  it('ENOENT 면 true — 캐시를 버렸다는 뜻이다', () => {
    expect(mod.noteClaudeSpawnFailure(Object.assign(new Error('spawn x ENOENT'), { code: 'ENOENT' }))).toBe(true);
  });

  it('ENOENT 가 아니면 false — 멀쩡한 캐시를 건드리지 않는다', () => {
    const bin = makeExtensionBin('2.1.235');
    const first = mod.getClaudeBin();
    expect(mod.noteClaudeSpawnFailure(Object.assign(new Error('spawn EACCES'), { code: 'EACCES' }))).toBe(false);
    expect(mod.noteClaudeSpawnFailure(undefined)).toBe(false);
    expect(mod.getClaudeBin()).toBe(first);
    expect(first.binPath).toBe(bin);
  });
});
