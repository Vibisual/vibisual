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
import { DEFAULT_AGENT_CONFIG, DEFAULT_AUTOCOMPACT, DEFAULT_AUTOCOMPACT_TOKENS, AVAILABLE_AUTOCOMPACT_VALUES, AVAILABLE_PERMISSION_MODES, toCliPermissionMode, AVAILABLE_AGENT_TOOLS, CLI_BUILTIN_TOOLS, LEGACY_AGENT_TOOLS, BACKFILL_AGENT_TOOLS, AGENT_TOOLS_BACKFILL_GEN } from '@vibisual/shared';

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

/**
 * §4 (CLI 사양 추종) — **무플래그로 CLI 기본에 맡기는 자리는 없다.**
 *
 * 2026-08-14 부터 CLI 무플래그 기본이 `auto`(분류기 자동 승인)로 바뀌었다. 그때까지 우리는
 * `'default'`(화면 이름 Manual)에 아무 플래그도 붙이지 않고 "CLI 기본 = Manual" 이라고 가정했기
 * 때문에, **화면에 "위험한 동작마다 확인" 이라고 적힌 에이전트가 자동 승인으로 돌았다.** 표시가
 * 틀린 게 아니라 사용자가 고른 승인 강도가 조용히 약해진 것이라 안전 문제다.
 *
 * 그래서 아래 검사들은 "무엇을 안 붙이는가"가 아니라 **"무엇이 반드시 나가는가"** 를 못 박는다.
 * 플랜·조직 정책·판올림으로 CLI 기본값이 또 바뀌어도 이 검사는 그대로 서 있는다.
 */
describe('스폰 인자 — 권한 모드', () => {
  it("`'default'`(화면 이름 Manual)는 `--permission-mode manual` 로 **명시**된다 — 무플래그 ❌", () => {
    const args = buildInteractiveClaudeArgs(cfg({ permissionMode: 'default' }));
    expect(valueOf(args, '--permission-mode')).toBe('manual');
  });

  it('설정이 비어 있어도 manual 로 떨어진다 — 옛 설정이 자동 승인으로 승격되지 않는다', () => {
    const args = buildInteractiveClaudeArgs(cfg({ permissionMode: '' }));
    expect(valueOf(args, '--permission-mode')).toBe('manual');
  });

  it('저장값 `default` 는 CLI 로 새 나가지 않는다 — CLI 선택지에 없는 값이다', () => {
    const args = buildInteractiveClaudeArgs(cfg({ permissionMode: 'default' }));
    expect(args).not.toContain('default');
  });

  it('bypassPermissions 는 전용 플래그로 나간다', () => {
    const args = buildInteractiveClaudeArgs(cfg({ permissionMode: 'bypassPermissions' }));
    expect(args).toContain('--dangerously-skip-permissions');
    expect(args).not.toContain('--permission-mode');
  });

  it.each(['acceptEdits', 'plan', 'auto', 'dontAsk'])('%s 는 CLI 값 그대로 전달된다', (mode) => {
    expect(valueOf(buildInteractiveClaudeArgs(cfg({ permissionMode: mode })), '--permission-mode')).toBe(mode);
  });

  // 알 수 없는 값이 저장돼 있어도 스폰을 죽이지 않는다 — CLI 는 선택지 밖 값을 거부하고 즉시 끝난다.
  it('모르는 값은 플래그를 흘리지 않는다 — 그 에이전트가 영영 못 뜨는 일이 없게', () => {
    expect(buildInteractiveClaudeArgs(cfg({ permissionMode: 'notARealMode' }))).not.toContain('--permission-mode');
  });

  // 우리 목록의 모든 값이 CLI 가 실제로 받는 값으로 옮겨지는지 — 새 모드를 추가하면서
  //   변환표를 안 고치면 여기서 걸린다(그 모드는 조용히 플래그 없이 나가 버린다).
  it('선택 가능한 모드는 전부 CLI 표현을 갖는다', () => {
    for (const mode of AVAILABLE_PERMISSION_MODES) {
      if (mode === 'bypassPermissions') continue; // 전용 플래그 경로
      expect(toCliPermissionMode(mode)).toBeTruthy();
    }
  });
});
describe('스폰 인자 — 신규 CLI 옵션', () => {
  it('전부 미설정이면 해당 플래그가 하나도 붙지 않는다 — 종전과 같은 인자로 뜬다', () => {
    const args = buildInteractiveClaudeArgs(cfg());
    for (const flag of ['--setting-sources', '--safe-mode', '--betas', '--exclude-dynamic-system-prompt-sections']) {
      expect(args).not.toContain(flag);
    }
  });

  // §4 (CLI 사양 추종) — 내장 기본은 **꺼짐**이다(2026-09-02 사용자 지시). 압축은 접을 때마다
  //   대화 전체를 다시 먹이는 요약 호출 1회가 나가는 **유료 축**이라, 사용자가 고른 적 없는 채로
  //   켜져 있으면 안 된다. 종전에는 여기서 400k 가 항상 실렸다.
  it('자동 압축은 기본이 꺼짐이라 미설정이면 플래그가 나가지 않는다', () => {
    expect(buildInteractiveClaudeArgs(cfg())).not.toContain('--autocompact');
  });

  // ⚠ 이 검사가 무너지면 **꺼 둔 에이전트가 전부 못 뜬다** — CLI 는 `--autocompact off` 를
  //   `argument 'off' is invalid` 로 거부하고 **즉시 종료**한다(실측 2.1.252). `off` 는 우리 축의
  //   값이지 CLI 의 값이 아니며, 꺼짐은 "플래그를 싣지 않는 것"으로만 표현된다.
  it("'off' 는 CLI 값이 아니라 무플래그다 — 그대로 실으면 스폰이 즉사한다", () => {
    const args = buildInteractiveClaudeArgs(cfg({ autoCompact: 'off' }), { userAutoCompact: '400000' });
    expect(args).not.toContain('--autocompact');
    expect(args).not.toContain('off');
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
    // 공백뿐인 자동 압축은 "미설정"이므로 빈 플래그를 흘리지 않고 내장 기본(=꺼짐)으로 떨어진다.
    expect(args).not.toContain('--autocompact');
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

    it('둘 다 미설정이면 내장 기본 = 꺼짐이라 플래그가 나가지 않는다', () => {
      expect(buildInteractiveClaudeArgs(cfg(), {})).not.toContain('--autocompact');
    });

    // 드롭다운에 실제로 서 있어야 사용자가 되돌릴 수 있다 — 꺼짐(내장 기본)과 켜기 권장값(400k) 둘 다.
    it('내장 기본값과 켜기 권장값은 둘 다 선택 목록 안의 값이다', () => {
      expect(AVAILABLE_AUTOCOMPACT_VALUES).toContain(DEFAULT_AUTOCOMPACT);
      expect(AVAILABLE_AUTOCOMPACT_VALUES).toContain(DEFAULT_AUTOCOMPACT_TOKENS);
    });

    it("'auto' 는 명시값이라 그대로 실린다 — 종전처럼 CLI 판단에 맡기는 자리", () => {
      const args = buildInteractiveClaudeArgs(cfg({ autoCompact: 'auto' }), { userAutoCompact: '100000' });
      expect(valueOf(args, '--autocompact')).toBe('auto');
    });

    // CLI 는 범위 밖 값을 무시하지 않고 `argument … is invalid` 로 즉시 종료한다(실측 2.1.247).
    //   저장분이 오염돼도 그 에이전트가 영영 못 뜨는 일이 없도록 내장 기본으로 떨어뜨린다.
    it.each(['50000', '2000000', 'abc'])('CLI 가 거부할 값(%s)은 스폰을 죽이지 않고 내장 기본(꺼짐)으로 떨어진다', (bad) => {
      const args = buildInteractiveClaudeArgs(cfg({ autoCompact: bad }), { userAutoCompact: bad });
      expect(args).not.toContain('--autocompact');
      expect(args).not.toContain(bad);
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

/**
 * §4 (CLI 사양 추종) 규약 (3) — **목록에 없는 내장 도구는 그 에이전트에게 존재하지 않는다.**
 *
 * `--tools` 를 항상 명시하기 때문에 이 목록이 곧 능력의 상한인데, 빠뜨려도 화면·타입·저장은 전부
 * 멀쩡해서 어느 검사에도 걸리지 않는다. 실제로 22종만 올라 있어 **공식 표 45종 중 26종이 통째로
 * 없었고**, 그중에는 IDE 를 표방하면서 빠져 있던 `LSP`, 목표 창의 원본인 `Task*`, 윈도우 주력인데
 * 빠져 있던 `PowerShell` 이 있었다. 그 구멍이 다시 생기지 않게 공식 표를 대조본으로 못 박는다.
 */
describe('도구 목록 — 공식 표 추종', () => {
  it('공식 표 45종이 전부 선택 가능 목록에 있다', () => {
    const missing = CLI_BUILTIN_TOOLS.filter((t) => !AVAILABLE_AGENT_TOOLS.includes(t));
    expect(missing).toEqual([]);
  });

  it('목록의 이름은 공식 표이거나 명시된 legacy 뿐이다 — 오타가 조용히 섞이지 않는다', () => {
    const known = new Set([...CLI_BUILTIN_TOOLS, ...LEGACY_AGENT_TOOLS]);
    expect(AVAILABLE_AGENT_TOOLS.filter((t) => !known.has(t))).toEqual([]);
  });

  it('중복이 없다', () => {
    expect(new Set(AVAILABLE_AGENT_TOOLS).size).toBe(AVAILABLE_AGENT_TOOLS.length);
  });

  it('기본 설정은 목록 전체를 갖는다', () => {
    expect(DEFAULT_AGENT_CONFIG.tools).toEqual([...AVAILABLE_AGENT_TOOLS]);
  });

  it('그 도구들이 실제로 `--tools` 로 나간다', () => {
    const args = buildInteractiveClaudeArgs(cfg());
    const tools = (valueOf(args, '--tools') ?? '').split(',');
    for (const t of CLI_BUILTIN_TOOLS) expect(tools).toContain(t);
  });
});

/**
 * §4 (CLI 사양 추종) — **백필은 한 번만 돈다.**
 *
 * 세대 도장이 없던 시절의 백필은 복원·병합 때마다 돌아서 사용자가 끈 도구를 되살렸다. 목록이
 * 45종으로 커진 지금 그 동작은 "모든 해제 선택이 재시작마다 되돌아간다"가 된다. 도장이 그 자리를 막는다.
 */
describe('도구 백필 — 세대 도장', () => {
  it('기본 설정에는 현행 세대 도장이 찍혀 있다', () => {
    expect(DEFAULT_AGENT_CONFIG.toolsBackfillGen).toBe(AGENT_TOOLS_BACKFILL_GEN);
  });

  it('새 도구를 넣으면서 세대를 안 올리면 이미 백필받은 설정은 그 도구를 영영 못 갖는다', () => {
    // 목록이 커졌는데 세대가 1 에 머물러 있으면 이 검사가 먼저 걸린다.
    expect(AGENT_TOOLS_BACKFILL_GEN).toBeGreaterThanOrEqual(2);
  });

  it('백필 대상은 선택 가능 목록 전체다 — 손으로 나열하다 빠뜨리는 자리를 없앤다', () => {
    expect([...BACKFILL_AGENT_TOOLS]).toEqual([...AVAILABLE_AGENT_TOOLS]);
  });
});

describe('스폰 인자 — 미지의 플래그 차단', () => {  /**
   * 이 함수가 낼 수 있는 플래그 전부. **설치된 CLI 의 `--help` 로 실재를 확인한 것만** 올린다
   * (확인 방법: `claude <플래그> --print` 를 프롬프트 없이 실행 — 통과하면 "Input must be provided",
   * 없는 플래그면 "unknown option"). 새 플래그를 달면서 이 목록을 고치지 않으면 이 검사가 막는다.
   */
  const ALLOWED = new Set([
    '--model', '--permission-mode', '--dangerously-skip-permissions', '--effort',
    '--tools', '--disallowedTools', '--allowedTools', '--mcp-config', '--settings',
    '--worktree', '--autocompact', '--exclude-dynamic-system-prompt-sections',
    '--setting-sources', '--safe-mode', '--betas', '--append-system-prompt',
    '--agents', '--plugin-dir',
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
      agentDefinitions: [{ name: 'reviewer', description: '검토', prompt: '너는 검토자다' }],
      pluginDirs: ['C:/plugins/a'],
    }), { includeRules: true });
    const flags = args.filter((a) => a.startsWith('--'));
    expect(flags.length).toBeGreaterThan(0);
    for (const f of flags) expect(ALLOWED).toContain(f);
  });
});

/**
 * §4 (CLI 사양 추종) — 세션 한정 서브에이전트 정의(`--agents`).
 *
 * 우리 축은 순서 있는 배열이고 CLI 는 이름을 키로 하는 객체를 받는다 — 뒤집는 자리가 하나뿐이라
 * 여기서 못 박는다. 특히 **반쯤 채운 정의를 넘기지 않는 것**이 중요하다: `description`/`prompt` 중
 * 하나만 있는 항목을 그대로 넘기면 CLI 가 인자 파싱에서 거부해 그 에이전트가 통째로 못 뜬다.
 */
describe('스폰 인자 — 세션 한정 서브에이전트(--agents)', () => {
  const parse = (args: string[]): Record<string, Record<string, unknown>> =>
    JSON.parse(valueOf(args, '--agents') ?? '{}') as Record<string, Record<string, unknown>>;

  it('미설정이면 플래그가 아예 없다', () => {
    expect(buildInteractiveClaudeArgs(cfg())).not.toContain('--agents');
    expect(buildInteractiveClaudeArgs(cfg({ agentDefinitions: [] }))).not.toContain('--agents');
  });

  it('이름을 키로 하는 객체로 뒤집힌다', () => {
    const args = buildInteractiveClaudeArgs(cfg({
      agentDefinitions: [
        { name: 'reviewer', description: '코드 검토', prompt: '너는 검토자다', tools: ['Read', 'Grep'], model: 'sonnet' },
      ],
    }));
    expect(parse(args)).toEqual({
      reviewer: { description: '코드 검토', prompt: '너는 검토자다', tools: ['Read', 'Grep'], model: 'sonnet' },
    });
  });

  it('선택 필드는 비면 키 자체가 안 실린다', () => {
    const args = buildInteractiveClaudeArgs(cfg({
      agentDefinitions: [{ name: 'debugger', description: '디버깅', prompt: '너는 디버거다', tools: [], model: '  ' }],
    }));
    expect(parse(args)['debugger']).toEqual({ description: '디버깅', prompt: '너는 디버거다' });
  });

  it('이름은 CLI 규칙(소문자·하이픈)으로 다듬어 나간다', () => {
    const args = buildInteractiveClaudeArgs(cfg({
      agentDefinitions: [{ name: '  Code Reviewer:v2  ', description: 'd', prompt: 'p' }],
    }));
    expect(Object.keys(parse(args))).toEqual(['code-reviewer-v2']);
  });

  it('필수 항목이 빈 정의는 통째로 버린다 — 스폰을 죽이지 않는다', () => {
    const args = buildInteractiveClaudeArgs(cfg({
      agentDefinitions: [
        { name: 'ok', description: 'd', prompt: 'p' },
        { name: '', description: 'd', prompt: 'p' },
        { name: 'nodesc', description: '   ', prompt: 'p' },
        { name: 'noprompt', description: 'd', prompt: '' },
      ],
    }));
    expect(Object.keys(parse(args))).toEqual(['ok']);
  });

  it('쓸 만한 정의가 하나도 없으면 빈 객체 대신 플래그를 안 붙인다', () => {
    const args = buildInteractiveClaudeArgs(cfg({
      agentDefinitions: [{ name: '', description: '', prompt: '' }],
    }));
    expect(args).not.toContain('--agents');
  });

  it('이름이 겹치면 먼저 적은 것이 남는다(뒤엣것이 조용히 덮지 않는다)', () => {
    const args = buildInteractiveClaudeArgs(cfg({
      agentDefinitions: [
        { name: 'dup', description: '첫째', prompt: 'p1' },
        { name: 'DUP', description: '둘째', prompt: 'p2' },
      ],
    }));
    expect(parse(args)).toEqual({ dup: { description: '첫째', prompt: 'p1' } });
  });
});

/**
 * §4 (CLI 사양 추종) — 세션 한정 플러그인(`--plugin-dir`).
 * **반복 플래그**라 경로마다 한 번씩 붙는다 — 쉼표로 이으면 CLI 가 그 전체를 폴더 이름 하나로 읽는다.
 */
describe('스폰 인자 — 세션 한정 플러그인(--plugin-dir)', () => {
  const dirsOf = (args: string[]): string[] =>
    args.flatMap((a, i) => (a === '--plugin-dir' ? [args[i + 1] ?? ''] : []));

  it('미설정이면 플래그가 없다', () => {
    expect(buildInteractiveClaudeArgs(cfg())).not.toContain('--plugin-dir');
    expect(buildInteractiveClaudeArgs(cfg({ pluginDirs: [] }))).not.toContain('--plugin-dir');
  });

  it('경로마다 플래그가 한 번씩 반복된다', () => {
    const args = buildInteractiveClaudeArgs(cfg({ pluginDirs: ['C:/a', '/srv/plugins/b', 'C:/c.zip'] }));
    expect(dirsOf(args)).toEqual(['C:/a', '/srv/plugins/b', 'C:/c.zip']);
  });

  it('빈 줄·중복은 걸러내되 경로 글자는 손대지 않는다(리눅스는 대소문자를 구분한다)', () => {
    const args = buildInteractiveClaudeArgs(cfg({ pluginDirs: ['  /p/A  ', '', '/p/A', '/p/a'] }));
    expect(dirsOf(args)).toEqual(['/p/A', '/p/a']);
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
