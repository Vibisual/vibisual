import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodexConfigLayerValues, CodexEffectiveConfig } from '@vibisual/shared';
import { runCodexTurn, type CodexTurnArgs } from './codexRunner.js';
import { readCodexEffectiveConfigFor } from './codexConfigService.js';

vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(),
  spawn: vi.fn(),
}));
vi.mock('./codexCli.js', async (original) => ({
  ...await original<typeof import('./codexCli.js')>(),
  getCodexBin: () => process.execPath,
}));
// 이 PC 의 실제 `~/.codex/config.toml` 에 기대지 않는다 — 시험마다 겹을 정해 준다.
vi.mock('./codexConfigService.js', async (original) => ({
  ...await original<typeof import('./codexConfigService.js')>(),
  readCodexEffectiveConfigFor: vi.fn(),
}));

function configWith(values: CodexConfigLayerValues | null): CodexEffectiveConfig {
  return { cwd: process.cwd(), layers: values ? [{ source: 'user', path: 'config.toml', values }] : [], checkedAt: 0 };
}

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
}

let child: FakeChild;
beforeEach(() => {
  child = new FakeChild();
  vi.mocked(spawn).mockReset().mockReturnValue(child as unknown as ChildProcess);
  vi.mocked(readCodexEffectiveConfigFor).mockReset().mockReturnValue(configWith(null));
});
afterEach(() => child.emit('close', 0));

/**
 * §5.25 (F) — 코덱스 고급 설정이 **실제로 스폰된 인자**에 닿는가.
 *
 * 조립 함수(`buildCodexExecArgs`)만 시험하면 러너가 그 필드를 넘기지 않는 것을 못 잡는다. 추론 요약·
 * 성격·서비스 등급 셋이 바로 그렇게 화면·저장·턴 인자(`subAgentManager`)까지 오고도 러너의 호출에서
 * 빠져 **한 번도 CLI 에 닿지 않았다** — 설정 창에서 골라도 아무 일이 없었다. 그래서 러너를 통째로 돌린다.
 */
const SETTINGS = {
  reasoningSummary: 'detailed',
  personality: 'pragmatic',
  serviceTier: 'fast',
  webSearch: 'live',
  modelVerbosity: 'low',
  networkAccess: false,
  autoCompactTokenLimit: 90000,
} satisfies Partial<CodexTurnArgs>;

/** 위 설정이 나가야 할 `-c` 값(0.159.2 가 받는 키·값 — 설치본 무프롬프트 탐침으로 확인). */
const EXPECTED_OVERRIDES = [
  'model_reasoning_summary="detailed"',
  'personality="pragmatic"',
  'service_tier="fast"',
  'web_search=live',
  'model_verbosity=low',
  'sandbox_workspace_write.network_access=false',
  'model_auto_compact_token_limit=90000',
];

describe.each([undefined, 'existing-thread'])('runCodexTurn — 고급 설정이 스폰 인자에 닿는다 (resume: %s)', (resumeThreadId) => {
  function launch(settings: Partial<CodexTurnArgs>): readonly string[] {
    runCodexTurn({
      subAgentId: 'codex-overrides-test', cwd: process.cwd(), model: 'test-model', prompt: 'Test prompt',
      // 기본 모드 = 작업 폴더 쓰기 — 네트워크 설정은 그 샌드박스에서만 실린다.
      permissionMode: 'default',
      ...(resumeThreadId ? { resumeThreadId } : {}),
      ...settings,
      onEvent: vi.fn(), onThread: vi.fn(), onUsage: vi.fn(), onFileWrites: vi.fn(), onDone: vi.fn(),
    });
    expect(spawn).toHaveBeenCalledOnce();
    return vi.mocked(spawn).mock.calls[0]![1] as readonly string[];
  }

  it('추론 요약·성격·서비스 등급을 포함한 고급 설정이 전부 `-c` 로 실린다', () => {
    const args = launch(SETTINGS);
    for (const pair of EXPECTED_OVERRIDES) {
      const at = args.indexOf(pair);
      expect(at, pair).toBeGreaterThan(0);
      expect(args[at - 1], pair).toBe('-c');
    }
  });

  it('고르지 않은 설정은 싣지 않는다 — 사용자의 코덱스 설정을 그대로 따른다', () => {
    const args = launch({});
    expect(args.some((a) => /^(model_reasoning_summary|personality|service_tier)=/.test(a))).toBe(false);
  });
});

/**
 * Windows 샌드박스 판정이 **실제 스폰**까지 닿는가. 판정은 이 프로세스의 OS 로 갈리므로 OS 마다 다른 쪽을 잰다
 * (세 OS 의 조립 규칙 자체는 `codexRunner.test.ts` 가 `platform` 인자로 전부 잰다).
 */
describe('runCodexTurn — Windows 샌드박스 키가 비었는지가 스폰 인자에 닿는다', () => {
  function spawnArgs(): readonly string[] {
    runCodexTurn({
      subAgentId: 'codex-windows-sandbox-test', cwd: process.cwd(), model: 'test-model', prompt: 'Test prompt',
      permissionMode: 'default',
      onEvent: vi.fn(), onThread: vi.fn(), onUsage: vi.fn(), onFileWrites: vi.fn(), onDone: vi.fn(),
    });
    return vi.mocked(spawn).mock.calls[0]![1] as readonly string[];
  }

  it.runIf(process.platform === 'win32')('Windows — 어느 겹에도 없으면 unelevated 를 싣는다', () => {
    const args = spawnArgs();
    const at = args.indexOf('windows.sandbox="unelevated"');
    expect(at).toBeGreaterThan(0);
    expect(args[at - 1]).toBe('-c');
  });

  it.runIf(process.platform === 'win32')('Windows — 어느 겹에든 적혀 있으면 그대로 둔다(elevated 를 낮추지 않는다)', () => {
    vi.mocked(readCodexEffectiveConfigFor).mockReturnValue(configWith({ windowsSandbox: 'elevated' }));
    expect(spawnArgs().some((a) => a.startsWith('windows.sandbox='))).toBe(false);
  });

  it.runIf(process.platform !== 'win32')('Windows 가 아니면 설정 파일을 읽지도 싣지도 않는다', () => {
    expect(spawnArgs().some((a) => a.startsWith('windows.sandbox='))).toBe(false);
    expect(readCodexEffectiveConfigFor).not.toHaveBeenCalled();
  });
});
