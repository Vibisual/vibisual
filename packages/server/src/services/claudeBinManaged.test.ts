import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLAUDE_MANAGED_SPAWN_ENV, MANAGED_ENGINE_ROLLBACK_MARK } from '@vibisual/shared';

/**
 * §4 (앱 전용 엔진) ④⑤ — 순서 `사용자 지정 → 앱 전용 → 네이티브 → VS Code 확장 → PATH` 와, 앱 전용 사본을 띄울 때만 `DISABLE_UPDATES=1` 이 얹히는지.
 * 홈은 `claudeBin.test.ts` 처럼 환경변수로 갈아 끼운다(실제 홈의 설치본을 줍지 않게).
 */

const IS_WIN = process.platform === 'win32';
const BIN_FILE = IS_WIN ? 'claude.exe' : 'claude';

type ClaudeBinModule = typeof import('./claudeBin.js');

let tmpHome: string;
let mod: ClaudeBinModule;
const ENV_KEYS = ['USERPROFILE', 'HOME', 'PATH', 'APPDATA'] as const;
let envBackup: Record<string, string | undefined>;

function writeBin(file: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '#!/bin/sh\nexit 0\n');
  if (!IS_WIN) fs.chmodSync(file, 0o755);
  return file;
}

function makeManaged(version: string, opts: { rolledBack?: boolean } = {}): string {
  const dir = path.join(tmpHome, '.vibisual', 'cli-engines', 'claude', 'versions', version);
  const bin = writeBin(path.join(dir, BIN_FILE));
  if (opts.rolledBack) fs.writeFileSync(path.join(dir, MANAGED_ENGINE_ROLLBACK_MARK), 'x');
  return bin;
}

const makeNative = (): string => writeBin(path.join(tmpHome, '.local', 'bin', BIN_FILE));
const makeExtension = (version: string): string =>
  writeBin(path.join(tmpHome, '.vscode', 'extensions', `anthropic.claude-code-${version}-win32-x64`, 'resources', 'native-binary', BIN_FILE));

function writeOverride(binPath: string): void {
  fs.mkdirSync(path.join(tmpHome, '.vibisual'), { recursive: true });
  fs.writeFileSync(path.join(tmpHome, '.vibisual', 'user-defaults.json'), JSON.stringify({ claudeBinPath: binPath }));
}

beforeEach(async () => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-claudebin-managed-'));
  envBackup = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env['USERPROFILE'] = tmpHome;
  process.env['HOME'] = tmpHome;
  process.env['PATH'] = '';
  process.env['APPDATA'] = path.join(tmpHome, 'AppData', 'Roaming');
  vi.resetModules();
  mod = await import('./claudeBin.js');
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = envBackup[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('쓰는 순서 — 앱 전용이 남의 설치본보다 앞선다', () => {
  it('VS Code 확장 · 네이티브가 있어도 앱 전용 사본을 쓴다', () => {
    makeExtension('2.1.300');
    makeNative();
    const managed = makeManaged('2.1.310');
    expect(mod.resolveClaudeBin()).toEqual({ binPath: managed, source: 'managed' });
  });

  it('앱 전용이 없으면 종전 순서(네이티브 → VS Code 확장)로 떨어진다', () => {
    const ext = makeExtension('2.1.300');
    expect(mod.resolveClaudeBin()).toEqual({ binPath: ext, source: 'vscode-extension' });
    const native = makeNative();
    expect(mod.resolveClaudeBin()).toEqual({ binPath: native, source: 'native' });
  });

  it('되돌린 판은 건너뛰고 앞 판을 쓴다', () => {
    const older = makeManaged('2.1.305');
    makeManaged('2.1.310', { rolledBack: true });
    expect(mod.resolveClaudeBin().binPath).toBe(older);
  });

  it('사용자가 Version 탭에서 고른 자기 설치본은 앱 전용보다 앞선다(병행)', () => {
    makeManaged('2.1.310');
    const ext = makeExtension('2.1.300');
    writeOverride(ext);
    expect(mod.resolveClaudeBin()).toEqual({ binPath: ext, source: 'vscode-extension' });
  });

  it('앱 전용 폴더 안을 가리키는 옛 선택은 "자동"과 같다 — 옛 판 경로로 굳지 않는다', () => {
    const oldManaged = makeManaged('2.1.300');
    const newManaged = makeManaged('2.1.310');
    writeOverride(oldManaged);
    expect(mod.resolveClaudeBin()).toEqual({ binPath: newManaged, source: 'managed' });
  });

  it('설치본 목록 맨 앞에 앱 전용 판들이 선다(지금 판 먼저)', () => {
    makeNative();
    const prev = makeManaged('2.1.305');
    const active = makeManaged('2.1.310');
    const all = mod.discoverAllClaudeBins();
    expect(all.slice(0, 2)).toEqual([
      { binPath: active, source: 'managed' },
      { binPath: prev, source: 'managed' },
    ]);
    expect(all.some((c) => c.source === 'native')).toBe(true);
  });

  it('앱 전용 판이 생기면 캐시를 버린 다음 스폰부터 그 판이다(재시작 불필요)', () => {
    const ext = makeExtension('2.1.300');
    expect(mod.getClaudeBin().binPath).toBe(ext);
    const managed = makeManaged('2.1.310');
    mod.invalidateClaudeBinCache(); // 서비스가 판을 바꾸면 부른다(onActiveChanged)
    expect(mod.getClaudeBin()).toEqual({ binPath: managed, source: 'managed' });
  });
});

describe('자체 갱신 끄기 — 앱 전용 실행본을 띄울 때만', () => {
  it('앱 전용이면 DISABLE_UPDATES=1 을 얹는다', () => {
    const managed = makeManaged('2.1.310');
    expect(mod.claudeManagedEnvFor(managed)).toEqual({ ...CLAUDE_MANAGED_SPAWN_ENV });
    const env = mod.claudeSpawnEnv({ PATH: 'x', LANG: 'en_US.UTF-8' }, managed);
    expect(env).toMatchObject({ PATH: 'x', LANG: 'en_US.UTF-8', DISABLE_UPDATES: '1' });
  });

  it('사용자 설치본(네이티브 · 확장 · 맨 이름)에는 얹지 않고 받은 환경을 그대로 돌려준다', () => {
    const base = { PATH: 'x' };
    expect(mod.claudeSpawnEnv(base, makeNative())).toBe(base);
    expect(mod.claudeSpawnEnv(base, makeExtension('2.1.300'))).toBe(base);
    expect(mod.claudeSpawnEnv(base, 'claude')).toBe(base);
    expect(mod.claudeManagedEnvFor(makeNative())).toEqual({});
  });

  it('바이너리를 주지 않으면 지금 쓰는 실행본으로 판정한다', () => {
    makeManaged('2.1.310');
    expect(mod.claudeSpawnEnv({})).toMatchObject({ DISABLE_UPDATES: '1' });
  });
});
