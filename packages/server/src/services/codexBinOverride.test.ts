import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { managedEngineDirIn } from './managedEngineLayout.js';

vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { classifyCodexBinSourceIn, codexBinOverride, readCodexBinOverride } from './codexCli.js';

/**
 * §4 (앱 전용 엔진) ④ — 코덱스도 기본은 앱 전용이고, Version 탭에서 다른 설치본을 **보조로** 고를 수 있다
 * (Claude 의 `claudeBinPath` 와 같은 규칙). 설정 파일은 임시 폴더에 따로 쓴다(실제 `~/.vibisual` 을 읽지 않는다).
 */

let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vib-codex-override-'));
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('고른 경로 읽기', () => {
  it('codexBinPath 를 읽고, 비었거나 없거나 깨졌으면 고른 것이 없다', () => {
    const file = path.join(dir, 'user-defaults.json');
    fs.writeFileSync(file, JSON.stringify({ codexBinPath: '  /opt/codex/bin/codex  ' }));
    expect(readCodexBinOverride(file)).toBe('/opt/codex/bin/codex');
    fs.writeFileSync(file, JSON.stringify({ codexBinPath: '' }));
    expect(readCodexBinOverride(file)).toBeNull();
    fs.writeFileSync(file, '{not json');
    expect(readCodexBinOverride(file)).toBeNull();
    expect(readCodexBinOverride(path.join(dir, 'missing.json'))).toBeNull();
  });
});

describe('쓸 수 있는 보조 선택', () => {
  it('파일이 있으면 그 경로를 쓴다', () => {
    const bin = path.join(dir, process.platform === 'win32' ? 'codex.exe' : 'codex');
    fs.writeFileSync(bin, 'x');
    expect(codexBinOverride(bin)).toBe(bin);
  });

  it('사라진 파일을 고른 채면 기본으로 떨어진다', () => {
    expect(codexBinOverride(path.join(dir, 'gone', 'codex'))).toBeNull();
  });

  it('앱 전용 판을 가리키는 옛 선택은 "기본"과 같다 — 판 경로로 굳히면 앱이 판을 바꿔도 옛 판에 남는다', () => {
    const managed = path.join(managedEngineDirIn(os.homedir(), 'codex'), 'versions', '0.164.0', 'bin', 'codex');
    expect(codexBinOverride(managed)).toBeNull();
  });

  it('고른 것이 없으면 null', () => {
    expect(codexBinOverride(null)).toBeNull();
  });
});

describe('출처 판정', () => {
  it.each([
    ['win32', 'C:\\Users\\me\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe'], // privacy-ok — 가상 경로
    ['darwin', '/Users/me/.local/bin/codex'], // privacy-ok — 가상 경로
    ['linux', '/home/me/.local/bin/codex'], // privacy-ok — 가상 경로
  ] as const)('%s — 앱 전용 · 공식 독립 설치 위치 · PATH 를 가른다', (_platform, standalone) => {
    const isManaged = (p: string): boolean => p.includes('cli-engines');
    expect(classifyCodexBinSourceIn('/x/.vibisual/cli-engines/codex/versions/1/bin/codex', [standalone], isManaged)).toBe('managed');
    expect(classifyCodexBinSourceIn(standalone, [standalone], isManaged)).toBe('standalone');
    expect(classifyCodexBinSourceIn('/usr/local/lib/node_modules/@openai/codex/bin/codex', [standalone], isManaged)).toBe('path');
  });
});
