/**
 * §4 (CLI 사양 추종) — **설정이 만들어 내는 claude 인자가 설치된 CLI 의 사양과 맞는가.**
 *
 * 이 자리는 조용히 썩는다. CLI 는 모르는 플래그를 무시하지 않고 `error: unknown option` 으로 **즉시 종료**
 * 하므로, 사라진 플래그 하나가 그 설정을 켠 에이전트 전체를 못 뜨게 만든다. 실제로 그렇게 됐다 —
 * `--isolation <값>` 은 CLI 2.1.223 에 존재하지 않는데 우리는 계속 붙이고 있었고, **Isolation=worktree 로
 * 설정한 커스텀 에이전트는 스폰되는 족족 인자 파싱 단계에서 죽었다**. 화면·타입·저장은 전부 멀쩡했기 때문에
 * 어느 검사에도 걸리지 않았다.
 *
 * 그래서 여기서는 "값이 저장되는가"가 아니라 **"어떤 플래그가 나가는가"** 를 못 박는다. 특히 마지막 검사는
 * 이 함수가 낼 수 있는 플래그를 명시 목록으로 고정한다 — 새 플래그를 다는 사람이 그 목록을 함께 고치게 해서,
 * 설치본에서 확인하지 않은 플래그가 스폰 인자에 조용히 섞이는 길을 막는다.
 *
 * `buildConfigArgs` 는 모듈 내부 함수라 **헤드리스·CMD 두 경로가 공유하는 공개 입구**
 * `buildInteractiveClaudeArgs` 로 관찰한다(같은 조립 결과를 그대로 물려받는다).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentConfig } from '@vibisual/shared';
import { DEFAULT_AGENT_CONFIG, DEFAULT_AUTOCOMPACT_TOKENS, AVAILABLE_AUTOCOMPACT_VALUES } from '@vibisual/shared';

// Fast 모드·자기 기억은 `--settings` **파일**로 나간다 — 사용자 홈(`~/.vibisual`)에 쓰지 않도록
// `os.homedir()` 만 임시 폴더로 돌린다(다른 테스트가 실제 app-state 를 더럽혔던 선례를 반복하지 않는다).
let fakeHome: string;
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, default: { ...actual, homedir: () => process.env.__VIBI_FAKE_HOME__ ?? actual.homedir() } };
});

import { buildInteractiveClaudeArgs, buildBashTimeoutEnv } from './subAgentManager.js';

beforeAll(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-cliargs-'));
  process.env.__VIBI_FAKE_HOME__ = fakeHome;
});

afterAll(() => {
  delete process.env.__VIBI_FAKE_HOME__;
  try {
    fs.rmSync(fakeHome, { recursive: true, force: true });
  } catch {
    /* 임시 폴더 정리 실패는 테스트 결과와 무관 */
  }
});

const cfg = (over: Partial<AgentConfig> = {}): AgentConfig => ({ ...DEFAULT_AGENT_CONFIG, ...over });

/** `--flag value` 에서 값 하나를 꺼낸다. 없으면 undefined. */
const valueOf = (args: string[], flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

describe('스폰 인자 — 격리(worktree)', () => {
  it('worktree 는 `--worktree` 로 나간다 — 사라진 `--isolation` 은 절대 나가지 않는다', () => {
    const args = buildInteractiveClaudeArgs(cfg({ isolation: 'worktree' }));
    expect(args).toContain('--worktree');
    expect(args).not.toContain('--isolation');
  });

  it("`'none'` 이면 워크트리 플래그가 아예 없다 — 부모 cwd 에서 돈다", () => {
    const args = buildInteractiveClaudeArgs(cfg({ isolation: 'none' }));
    expect(args).not.toContain('--worktree');
    expect(args).not.toContain('--isolation');
  });

  it('미설정도 워크트리를 만들지 않는다', () => {
    expect(buildInteractiveClaudeArgs(cfg())).not.toContain('--worktree');
  });
});

describe('스폰 인자 — 권한 모드', () => {
  it("`'default'`(화면 이름 Manual)는 CLI 기본이라 플래그를 붙이지 않는다", () => {
    expect(buildInteractiveClaudeArgs(cfg({ permissionMode: 'default' }))).not.toContain('--permission-mode');
  });

  it('bypassPermissions 는 전용 플래그로 나간다', () => {
    const args = buildInteractiveClaudeArgs(cfg({ permissionMode: 'bypassPermissions' }));
    expect(args).toContain('--dangerously-skip-permissions');
    expect(args).not.toContain('--permission-mode');
  });

  it.each(['acceptEdits', 'plan', 'auto', 'dontAsk'])('%s 는 CLI 값 그대로 전달된다', (mode) => {
    expect(valueOf(buildInteractiveClaudeArgs(cfg({ permissionMode: mode })), '--permission-mode')).toBe(mode);
  });
});

describe('스폰 인자 — 신규 CLI 옵션', () => {
  it('전부 미설정이면 해당 플래그가 하나도 붙지 않는다 — 종전과 같은 인자로 뜬다', () => {
    const args = buildInteractiveClaudeArgs(cfg());
    for (const flag of ['--setting-sources', '--safe-mode', '--betas', '--exclude-dynamic-system-prompt-sections']) {
      expect(args).not.toContain(flag);
    }
  });

  // §4 (CLI 사양 추종) — `--autocompact` 만 예외다. 미설정을 "플래그 없음"으로 두면 CLI 기본이
  //   모델 창 전체라 `[1m]` 스폰에서 압축이 100만 토큰에서야 걸린다(= 실질적으로 압축 없음).
  it('자동 압축은 미설정이어도 내장 기본값으로 항상 실린다', () => {
    expect(valueOf(buildInteractiveClaudeArgs(cfg()), '--autocompact')).toBe(DEFAULT_AUTOCOMPACT_TOKENS);
  });

  it('설정하면 그대로 실린다', () => {
    const args = buildInteractiveClaudeArgs(cfg({
      autoCompact: '200000',
      settingSources: ['user', 'project'],
      safeMode: true,
      betas: ['beta-a', 'beta-b'],
      excludeDynamicSystemPromptSections: true,
    }));
    expect(valueOf(args, '--autocompact')).toBe('200000');
    expect(valueOf(args, '--setting-sources')).toBe('user,project');
    expect(args).toContain('--safe-mode');
    expect(args).toContain('--exclude-dynamic-system-prompt-sections');
    // `--betas` 는 가변 인자(공백 구분)라 값이 이어 붙는다.
    expect(args.slice(args.indexOf('--betas') + 1, args.indexOf('--betas') + 3)).toEqual(['beta-a', 'beta-b']);
  });

  it('빈 값·빈 배열은 미설정과 같다 — 빈 플래그를 흘리지 않는다', () => {
    const args = buildInteractiveClaudeArgs(cfg({ autoCompact: '   ', settingSources: [], betas: ['', '  '] }));
    // 공백뿐인 자동 압축은 "미설정"이므로 빈 플래그를 흘리지 않고 내장 기본으로 떨어진다.
    expect(valueOf(args, '--autocompact')).toBe(DEFAULT_AUTOCOMPACT_TOKENS);
    expect(args).not.toContain('--setting-sources');
    expect(args).not.toContain('--betas');
  });

  describe('자동 압축 3층 해소 — 에이전트 → 설정 창 → 내장 기본', () => {
    it('에이전트 설정이 있으면 그것이 이긴다', () => {
      const args = buildInteractiveClaudeArgs(cfg({ autoCompact: '500000' }), { userAutoCompact: '100000' });
      expect(valueOf(args, '--autocompact')).toBe('500000');
    });

    it('에이전트가 미설정이면 설정 창 전역 기본을 따른다 — 이미 만들어진 에이전트도 함께 바뀐다', () => {
      const args = buildInteractiveClaudeArgs(cfg(), { userAutoCompact: '1000000' });
      expect(valueOf(args, '--autocompact')).toBe('1000000');
    });

    it('둘 다 미설정이면 내장 기본 400k', () => {
      expect(valueOf(buildInteractiveClaudeArgs(cfg(), {}), '--autocompact')).toBe('400000');
    });

    // 드롭다운에 400k 가 실제로 서 있어야 사용자가 기본값을 되돌릴 수 있다.
    it('내장 기본값은 선택 목록 안의 값이다', () => {
      expect(AVAILABLE_AUTOCOMPACT_VALUES).toContain(DEFAULT_AUTOCOMPACT_TOKENS);
    });

    it("'auto' 는 명시값이라 그대로 실린다 — 종전처럼 CLI 판단에 맡기는 자리", () => {
      const args = buildInteractiveClaudeArgs(cfg({ autoCompact: 'auto' }), { userAutoCompact: '100000' });
      expect(valueOf(args, '--autocompact')).toBe('auto');
    });

    // CLI 는 범위 밖 값을 무시하지 않고 `argument … is invalid` 로 즉시 종료한다(실측 2.1.247).
    //   저장분이 오염돼도 그 에이전트가 영영 못 뜨는 일이 없도록 내장 기본으로 떨어뜨린다.
    it.each(['50000', '2000000', 'abc'])('CLI 가 거부할 값(%s)은 스폰을 죽이지 않고 내장 기본으로 떨어진다', (bad) => {
      const args = buildInteractiveClaudeArgs(cfg({ autoCompact: bad }), { userAutoCompact: bad });
      expect(valueOf(args, '--autocompact')).toBe(DEFAULT_AUTOCOMPACT_TOKENS);
    });
  });

  it('`--fallback-model` 은 여기서 나가지 않는다 — `--print` 전용이라 헤드리스 스폰부가 붙인다', () => {
    expect(buildInteractiveClaudeArgs(cfg({ fallbackModel: 'sonnet' }))).not.toContain('--fallback-model');
  });
});

/**
 * §4 (Fast 모드) — **플래그가 아니라 설정 파일로 나가는 축.**
 *
 * 헤드리스 스폰은 CLI 가 Agent SDK 세션으로 분류해 Fast 를 스스로 막고
 * (`fast_mode_disabled_reason: 'sdk_opt_in_required'`), `--settings` 가 만드는 `flagSettings` 층에
 * 들어온 opt-in 만 인정한다. 그런데 그 `--settings` 는 **두 번 주면 앞엣것이 통째로 죽으므로**
 * 기억 설정과 반드시 한 장으로 합쳐져야 한다 — 아래 마지막 검사가 그 자리를 지킨다.
 */
describe('스폰 인자 — Fast 모드', () => {
  /** `--settings` 로 나간 파일의 본문. 플래그가 없으면 null. */
  const settingsBody = (args: string[]): Record<string, unknown> | null => {
    const i = args.indexOf('--settings');
    if (i < 0) return null;
    return JSON.parse(fs.readFileSync(args[i + 1]!, 'utf8')) as Record<string, unknown>;
  };

  it('미설정이면 설정 파일이 아예 안 붙는다 — 종전과 같은 인자로 뜬다', () => {
    expect(buildInteractiveClaudeArgs(cfg())).not.toContain('--settings');
  });

  it('Opus + 켬 이면 `--settings` 파일에 `fastMode: true` 로 실린다', () => {
    const args = buildInteractiveClaudeArgs(cfg({ model: 'opus', fastMode: true }));
    expect(args).toContain('--settings');
    expect(settingsBody(args)).toEqual({ fastMode: true });
  });

  it('`--fast` 같은 플래그는 절대 나가지 않는다 — 그런 플래그는 CLI 에 없다', () => {
    const args = buildInteractiveClaudeArgs(cfg({ model: 'opus', fastMode: true }));
    expect(args).not.toContain('--fast');
    expect(args).not.toContain('--fast-mode');
  });

  it.each(['sonnet', 'haiku'])('%s 에서는 켜도 아무것도 안 붙는다 — CLI 가 사유도 없이 무시하는 조합', (model) => {
    expect(buildInteractiveClaudeArgs(cfg({ model, fastMode: true }))).not.toContain('--settings');
  });

  it('풀ID 핀이 alias 를 이긴다 — 옛 Opus 를 핀하면 Fast 가 실리지 않는다', () => {
    const args = buildInteractiveClaudeArgs(cfg({ model: 'opus', modelVersion: 'claude-opus-4-7', fastMode: true }));
    expect(args).not.toContain('--settings');
  });

  it('1M 변형은 접미사일 뿐이라 그대로 실린다', () => {
    const args = buildInteractiveClaudeArgs(cfg({ model: 'opus', modelVersion: 'claude-opus-5', fastMode: true }));
    expect(settingsBody(args)).toEqual({ fastMode: true });
  });

  it('기억과 함께 켜도 `--settings` 는 **정확히 한 번** — 두 번이면 앞엣것이 죽는다', () => {
    const args = buildInteractiveClaudeArgs(cfg({
      model: 'opus',
      fastMode: true,
      memory: 'user',
    }));
    expect(args.filter((a) => a === '--settings')).toHaveLength(1);
    const body = settingsBody(args);
    expect(body?.fastMode).toBe(true);
    expect(typeof body?.autoMemoryDirectory).toBe('string');
  });
});

describe('스폰 인자 — 미지의 플래그 차단', () => {
  /**
   * 이 함수가 낼 수 있는 플래그 전부. **설치된 CLI 의 `--help` 로 실재를 확인한 것만** 올린다
   * (확인 방법: `claude <플래그> --print` 를 프롬프트 없이 실행 — 통과하면 "Input must be provided",
   * 없는 플래그면 "unknown option"). 새 플래그를 달면서 이 목록을 고치지 않으면 이 검사가 막는다.
   */
  const ALLOWED = new Set([
    '--model', '--permission-mode', '--dangerously-skip-permissions', '--effort',
    '--tools', '--disallowedTools', '--allowedTools', '--mcp-config', '--settings',
    '--worktree', '--autocompact', '--exclude-dynamic-system-prompt-sections',
    '--setting-sources', '--safe-mode', '--betas', '--append-system-prompt',
  ]);

  it('모든 설정을 켜도 목록 밖 플래그는 나오지 않는다', () => {
    const args = buildInteractiveClaudeArgs(cfg({
      model: 'opus',
      permissionMode: 'acceptEdits',
      effort: 'high',
      isolation: 'worktree',
      disallowedTools: ['Bash'],
      autoCompact: 'auto',
      settingSources: ['local'],
      safeMode: true,
      betas: ['b1'],
      excludeDynamicSystemPromptSections: true,
      fastMode: true,
      memory: 'user',
      rules: '규칙',
    }), { includeRules: true });
    const flags = args.filter((a) => a.startsWith('--'));
    expect(flags.length).toBeGreaterThan(0);
    for (const f of flags) expect(ALLOWED).toContain(f);
  });
});

/**
 * §4 (CLI 사양 추종) — Bash 타임아웃은 **플래그가 아니라 env** 로 나간다.
 *
 * 그래서 위의 "허용 플래그 목록" 검사에 걸리지 않는 축이고, 대신 여기서 못 박는다.
 * 특히 미설정일 때 **키 자체가 없어야** 한다 — 빈 문자열이나 '0' 이 실리면 CLI 가 그 값을 믿고
 * 타임아웃을 0 으로 잡아, 설정하지 않은 사람의 Bash 가 즉시 죽는다.
 */
describe('스폰 env — Bash 타임아웃', () => {
  it('미설정이면 키가 아예 없다 — 종전과 같은 env 로 뜬다', () => {
    expect(buildBashTimeoutEnv(cfg())).toEqual({});
  });

  it('설정하면 ms 문자열로 나간다', () => {
    expect(buildBashTimeoutEnv(cfg({ bashDefaultTimeoutMs: 300_000, bashMaxTimeoutMs: 3_600_000 })))
      .toEqual({ BASH_DEFAULT_TIMEOUT_MS: '300000', BASH_MAX_TIMEOUT_MS: '3600000' });
  });

  it('한쪽만 설정하면 그 키만 나간다 — 둘은 직교 축이다', () => {
    expect(buildBashTimeoutEnv(cfg({ bashMaxTimeoutMs: 1_800_000 })))
      .toEqual({ BASH_MAX_TIMEOUT_MS: '1800000' });
  });

  it('범위 밖(0 · 음수 · 24시간 초과)은 미설정으로 떨어진다', () => {
    expect(buildBashTimeoutEnv(cfg({ bashDefaultTimeoutMs: 0, bashMaxTimeoutMs: -1 }))).toEqual({});
    expect(buildBashTimeoutEnv(cfg({ bashMaxTimeoutMs: 86_400_001 }))).toEqual({});
  });
});
