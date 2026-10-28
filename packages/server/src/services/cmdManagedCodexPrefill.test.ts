import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODEX_MANAGED_TUI_ARGS, DEFAULT_AGENT_CONFIG, type AgentConfig } from '@vibisual/shared';

/**
 * §4 (앱 전용 엔진) ⑤ — CMD 의 코덱스도 앱 전용 사본을 띄운다: 있으면 그 절대 경로 + 시작 시 업데이트 확인 끄기, 없으면 맨 이름 `codex`(셸 PATH).
 * 우리 훅의 자식이 아니라는 성질(`--resume`·rules 없음)은 그대로다.
 */

let fakeHome: string;
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, default: { ...actual, homedir: () => process.env.__VIBI_FAKE_HOME__ ?? actual.homedir() } };
});

import { buildInteractiveCliPrefill } from './subAgentManager.js';

beforeAll(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-cmd-codex-'));
  process.env.__VIBI_FAKE_HOME__ = fakeHome;
});

afterAll(() => {
  delete process.env.__VIBI_FAKE_HOME__;
  fs.rmSync(fakeHome, { recursive: true, force: true });
});

const cfg = (over: Partial<AgentConfig> = {}): AgentConfig => ({ ...DEFAULT_AGENT_CONFIG, ...over });

describe('CMD 코덱스 줄', () => {
  it.each([
    ['win32', 'C:\\Windows\\System32\\cmd.exe', 'C:\\Users\\me\\.vibisual\\cli-engines\\codex\\versions\\0.164.0\\bin\\codex.exe'], // privacy-ok — 가상 경로
    ['darwin', '/bin/zsh', '/Users/me/.vibisual/cli-engines/codex/versions/0.164.0/bin/codex'], // privacy-ok — 가상 경로
    ['linux', '/bin/bash', '/home/me/.vibisual/cli-engines/codex/versions/0.164.0/bin/codex'], // privacy-ok — 가상 경로
  ] as const)('%s — 앱 전용 실행본이 있으면 그 경로 + 업데이트 확인 끄기', (platform, shell, bin) => {
    const r = buildInteractiveCliPrefill({ config: cfg({ cliKind: 'codex' }), claudeBinPath: 'claude', shell, platform, managedCodexBin: bin });
    expect(r.managed).toBe(false);
    expect(r.kind).toBe('codex');
    expect(r.prefill).toContain(bin.includes(' ') ? `"${bin}"` : bin);
    for (const a of CODEX_MANAGED_TUI_ARGS) expect(r.prefill).toContain(a);
    // 우리 훅의 자식이 아니다 — claude 인자 · 이어 받기는 붙지 않는다.
    expect(r.prefill).not.toContain('--resume');
    expect(r.prefill).not.toContain('--permission-mode');
  });

  it.each([
    ['win32', 'C:\\Windows\\System32\\cmd.exe', 'C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd'], // privacy-ok — 가상 경로
    ['darwin', '/bin/zsh', '/opt/homebrew/bin/codex'],
    ['linux', '/bin/bash', '/usr/local/bin/codex'],
  ] as const)('%s — 사용자가 보조로 고른 설치본이 있으면 그것이 먼저다(업데이트 확인 끄기는 붙이지 않는다)', (platform, shell, selected) => {
    const managedBin = '/x/.vibisual/cli-engines/codex/versions/0.164.0/bin/codex';
    const r = buildInteractiveCliPrefill({ config: cfg({ cliKind: 'codex' }), claudeBinPath: 'claude', shell, platform, managedCodexBin: managedBin, selectedCodexBin: selected });
    expect(r.prefill).toContain(selected);
    expect(r.prefill).not.toContain(managedBin);
    for (const a of CODEX_MANAGED_TUI_ARGS) expect(r.prefill).not.toContain(a);
  });

  it('앱 전용이 없으면 종전 맨 이름 그대로', () => {
    expect(buildInteractiveCliPrefill({ config: cfg({ cliKind: 'codex' }), claudeBinPath: 'claude', managedCodexBin: null }).prefill).toBe('codex');
    expect(buildInteractiveCliPrefill({ config: cfg({ cliKind: 'codex' }), claudeBinPath: 'claude' }).prefill).toBe('codex');
  });

  it('다른 CLI 갈래에는 영향이 없다', () => {
    expect(buildInteractiveCliPrefill({ config: cfg({ cliKind: 'gemini' }), claudeBinPath: 'claude', managedCodexBin: '/x/codex' }).prefill).toBe('gemini');
    expect(buildInteractiveCliPrefill({ config: cfg({ cliKind: 'shell' }), claudeBinPath: 'claude', managedCodexBin: '/x/codex' }).prefill).toBe('');
  });

  it('터미널 매니저가 앱 전용 코덱스 경로를 넘기고, 앱 전용 claude 를 띄우는 세션에 갱신 끄기를 얹는다', () => {
    const src = fs.readFileSync(fileURLToPath(new URL('../../../desktop/src/main/terminalManager.ts', import.meta.url)), 'utf8')
      .replace(/\r\n/g, '\n');
    expect(src).toContain("managedCodexBin: findManagedBin('codex')");
    expect(src).toContain('selectedCodexBin: codexBinOverride()');
    expect(src).toContain('...(managed ? claudeManagedEnvFor(binPath) : {})');
    expect(src).toContain("claudeManagedEnvFor(spec.env['VIBISUAL_CLAUDE_LOGIN_BIN'])");
  });
});
