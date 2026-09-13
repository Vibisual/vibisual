/*
 * §5.3 #9-1 — 토큰 절약(토큰 축 J~P) 회귀 고정.
 *
 * 이 기능이 지켜야 하는 약속은 둘이고, 둘 다 **조용히 깨지는** 종류다:
 *  ① **안 켠 사용자에게는 아무 일도 없다** — env 키가 하나도 붙지 않아야 한다. 붙으면 이 기능을
 *     모르는 사용자의 스폰 동작이 바뀐다(그 사고는 화면에 아무 표시도 남기지 않는다).
 *  ② **켠 사용자에게는 실제로 걸린다** — 조립이 빠지거나 3층 해소가 뒤집히면 "설정은 되는데
 *     안 먹는다"가 된다. 그 모양의 사고가 이 저장소에 이미 넷 있었다(§4 설정 3층 테스트 참조).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildTokenSaverEnv,
  normalizeTokenSaverSettings,
  detectTokenSaverPreset,
  resolveTokenSaverNumber,
  shouldCompactAfterTurn,
  resolveEffectiveAutoCompact,
  AVAILABLE_AUTOCOMPACT_VALUES,
  DEFAULT_TOKEN_SAVER_SETTINGS,
  TOKEN_SAVER_PRESET_VALUES,
  TOKEN_SAVER_LIMITS,
  TOKEN_SAVER_TURN_BUDGET_FLOOR,
  TOKEN_SAVER_OUTPUT_FLOOR,
  type TokenSaverSettings,
} from '@vibisual/shared';

describe('§5.3 #9-1 (J~M) — 스폰 env 조립', () => {
  it('전 축이 꺼져 있으면 env 키를 하나도 만들지 않는다 (무변경 근거)', () => {
    expect(buildTokenSaverEnv(undefined, DEFAULT_TOKEN_SAVER_SETTINGS)).toEqual({});
    expect(buildTokenSaverEnv({}, DEFAULT_TOKEN_SAVER_SETTINGS)).toEqual({});
    // 전역 인자를 아예 안 넘겨도 같다 — 기본값이 "전 축 끔"이기 때문이다.
    expect(buildTokenSaverEnv({})).toEqual({});
  });

  it('전역만 켜도 CLI 가 아는 이름으로 나간다', () => {
    const env = buildTokenSaverEnv(undefined, TOKEN_SAVER_PRESET_VALUES.saver);
    expect(env['BASH_MAX_OUTPUT_LENGTH']).toBe('8000');
    expect(env['MAX_MCP_OUTPUT_TOKENS']).toBe('4000');
    expect(env['CLAUDE_CODE_MAX_OUTPUT_TOKENS']).toBe('8000');
    expect(env['MAX_THINKING_TOKENS']).toBe('4000');
    expect(env['CLAUDE_AUTOCOMPACT_PCT_OVERRIDE']).toBe('60');
    expect(env['DISABLE_NON_ESSENTIAL_MODEL_CALLS']).toBe('1');
  });

  it('balanced 는 문맥이 자라는 속도만 늦추고 생성·압축은 건드리지 않는다', () => {
    const env = buildTokenSaverEnv(undefined, TOKEN_SAVER_PRESET_VALUES.balanced);
    expect(env['BASH_MAX_OUTPUT_LENGTH']).toBe('20000');
    expect(env['CLAUDE_CODE_MAX_OUTPUT_TOKENS']).toBeUndefined();
    expect(env['MAX_THINKING_TOKENS']).toBeUndefined();
    expect(env['CLAUDE_AUTOCOMPACT_PCT_OVERRIDE']).toBeUndefined();
  });

  it('에이전트 값이 전역을 이긴다 — 단 0/미설정은 "전역을 따른다"는 뜻이다', () => {
    const global = { ...DEFAULT_TOKEN_SAVER_SETTINGS, bashMaxOutputChars: 20_000 };
    expect(buildTokenSaverEnv({ bashMaxOutputChars: 5_000 }, global)['BASH_MAX_OUTPUT_LENGTH']).toBe('5000');
    expect(buildTokenSaverEnv({ bashMaxOutputChars: 0 }, global)['BASH_MAX_OUTPUT_LENGTH']).toBe('20000');
    expect(buildTokenSaverEnv({}, global)['BASH_MAX_OUTPUT_LENGTH']).toBe('20000');
  });

  it('스위치는 켜는 쪽으로만 합쳐진다 — 에이전트가 전역 절약을 되살리지 못한다', () => {
    const on = { ...DEFAULT_TOKEN_SAVER_SETTINGS, disableNonEssentialModelCalls: true };
    expect(buildTokenSaverEnv({ disableNonEssentialModelCalls: false }, on)['DISABLE_NON_ESSENTIAL_MODEL_CALLS']).toBe('1');
    expect(buildTokenSaverEnv({ disableNonEssentialModelCalls: true }, DEFAULT_TOKEN_SAVER_SETTINGS)['DISABLE_NON_ESSENTIAL_MODEL_CALLS']).toBe('1');
    // 아무도 안 켰으면 키 자체가 없다 — 빈 문자열로 넣으면 판본에 따라 참으로 읽힌다.
    expect(buildTokenSaverEnv({}, DEFAULT_TOKEN_SAVER_SETTINGS)['DISABLE_NON_ESSENTIAL_MODEL_CALLS']).toBeUndefined();
  });

  it('CLI 가 받는 범위 밖으로는 나가지 않는다', () => {
    const env = buildTokenSaverEnv(
      { bashMaxOutputChars: 999_999, autoCompactPct: 300, maxOutputTokens: 1 },
      DEFAULT_TOKEN_SAVER_SETTINGS,
    );
    expect(env['BASH_MAX_OUTPUT_LENGTH']).toBe(String(TOKEN_SAVER_LIMITS.bashMaxOutputChars.max));
    expect(env['CLAUDE_AUTOCOMPACT_PCT_OVERRIDE']).toBe('100');
    // 너무 낮은 생성 상한은 답을 문장 중간에서 자른다 — 그건 절약이 아니라 다시 시키는 일이다.
    expect(env['CLAUDE_CODE_MAX_OUTPUT_TOKENS']).toBe(String(TOKEN_SAVER_OUTPUT_FLOOR));
  });

  it('resolveTokenSaverNumber 는 3층 해소 한 벌이다', () => {
    expect(resolveTokenSaverNumber(7, 3)).toBe(7);
    expect(resolveTokenSaverNumber(0, 3)).toBe(3);
    expect(resolveTokenSaverNumber(undefined, 3)).toBe(3);
    expect(resolveTokenSaverNumber(Number.NaN, 3)).toBe(3);
  });
});

describe('§5.3 #9-1 — 설정 정규화', () => {
  it('저장분이 없으면 전 축이 꺼진 기본값이다', () => {
    expect(normalizeTokenSaverSettings(undefined)).toEqual(DEFAULT_TOKEN_SAVER_SETTINGS);
    expect(normalizeTokenSaverSettings(null)).toEqual(DEFAULT_TOKEN_SAVER_SETTINGS);
  });

  it('켠 턴 예산은 바닥 아래로 못 내려간다 — 잦은 압축은 절약이 아니라 손해다', () => {
    expect(normalizeTokenSaverSettings({ sessionTurnBudget: 5 }).sessionTurnBudget).toBe(TOKEN_SAVER_TURN_BUDGET_FLOOR);
    // 0 은 바닥에 걸리지 않는다 — "그 축 끔"이라는 뜻이기 때문이다.
    expect(normalizeTokenSaverSettings({ sessionTurnBudget: 0 }).sessionTurnBudget).toBe(0);
  });

  it('범위 밖 값은 경계로 접힌다', () => {
    expect(normalizeTokenSaverSettings({ maxConcurrentAgents: -4 }).maxConcurrentAgents).toBe(0);
    expect(normalizeTokenSaverSettings({ autoCompactPct: 999 }).autoCompactPct).toBe(100);
    expect(normalizeTokenSaverSettings({ spawnStaggerMs: 10 ** 9 }).spawnStaggerMs)
      .toBe(TOKEN_SAVER_LIMITS.spawnStaggerMs.max);
  });

  it('preset 은 들어온 이름이 아니라 값에서 다시 판정한다', () => {
    // 어긋난 저장분(이름은 saver, 값은 전부 꺼짐)이 와도 화면이 거짓말하지 않는다.
    const lying = { ...DEFAULT_TOKEN_SAVER_SETTINGS, preset: 'saver' as const };
    expect(normalizeTokenSaverSettings(lying).preset).toBe('off');
    expect(normalizeTokenSaverSettings(TOKEN_SAVER_PRESET_VALUES.saver).preset).toBe('saver');
    expect(normalizeTokenSaverSettings({ ...TOKEN_SAVER_PRESET_VALUES.saver, maxConcurrentAgents: 9 }).preset).toBe('custom');
  });

  it('프리셋 세 벌은 정규화를 왕복해도 자기 자신이다', () => {
    for (const name of ['off', 'balanced', 'saver'] as const) {
      const round = normalizeTokenSaverSettings(TOKEN_SAVER_PRESET_VALUES[name]);
      expect(round).toEqual(TOKEN_SAVER_PRESET_VALUES[name]);
      expect(detectTokenSaverPreset(round)).toBe(name);
    }
  });

  it('절약 강도는 실제로 단조롭다 — saver 는 balanced 보다 조인다', () => {
    const b = TOKEN_SAVER_PRESET_VALUES.balanced;
    const sv = TOKEN_SAVER_PRESET_VALUES.saver;
    const tighter = (loose: number, tight: number): boolean => tight > 0 && (loose === 0 || tight <= loose);
    expect(tighter(b.bashMaxOutputChars, sv.bashMaxOutputChars)).toBe(true);
    expect(tighter(b.mcpMaxOutputTokens, sv.mcpMaxOutputTokens)).toBe(true);
    expect(tighter(b.maxConcurrentAgents, sv.maxConcurrentAgents)).toBe(true);
    expect(tighter(b.sessionTurnBudget, sv.sessionTurnBudget)).toBe(true);
    expect(sv.spawnStaggerMs).toBeGreaterThanOrEqual(b.spawnStaggerMs);
  });
});

describe('§5.3 #9-1 (P) — 턴 예산은 기존 압축 판정에 얹힌다', () => {
  it('예산이 꺼져 있으면 종전 판정 그대로다', () => {
    expect(shouldCompactAfterTurn({ requested: false, turnsSinceCompact: 9_999 })).toBe(false);
    expect(shouldCompactAfterTurn({ requested: false, turnsSinceCompact: 9_999, turnBudget: 0 })).toBe(false);
  });

  it('예산에 닿으면 컨텍스트를 못 재는 세션에서도 접는다', () => {
    // 컨텍스트 축은 "못 재면 거짓"이라, 턴 축이 없으면 이런 세션은 영영 안 접힌다.
    expect(shouldCompactAfterTurn({ requested: false, turnBudget: 80, turnsSinceCompact: 80 })).toBe(true);
    expect(shouldCompactAfterTurn({ requested: false, turnBudget: 80, turnsSinceCompact: 79 })).toBe(false);
  });

  it('에이전트가 직접 요청한 압축은 여전히 무조건 먹는다', () => {
    expect(shouldCompactAfterTurn({ requested: true, turnBudget: 0, turnsSinceCompact: 0 })).toBe(true);
  });
});

/*
 * N(동시 가동 상한)·O(스폰 시차)는 `index.ts` 안의 클로저라 밖에서 부를 수 없다. 그래서 **배선이
 * 살아 있는지**를 소스로 고정한다 — 게이트가 조용히 사라지면 상한을 걸어 둔 사용자에게는
 * "설정은 그대로인데 어느 날부터 안 먹는" 형태로만 보이기 때문이다(§4 설정 3층 검사와 같은 수법).
 */
describe('§5.3 #9-1 (N·O) — dispatch 게이트 배선', () => {
  const source = (): string => readFileSync(new URL('../index.ts', import.meta.url), 'utf8');

  it('dispatch 직전에 게이트를 통과한다', () => {
    expect(source()).toContain('if (!tokenSaverAdmits(next, sessionId)) continue;');
  });

  it('턴이 끝나면 기다리던 다른 세션을 깨운다', () => {
    const s = source();
    expect(s).toContain('pumpTokenSaverQueues();');
    // 턴 종료 콜백과 설정 저장 두 곳에서 부른다 — 후자가 없으면 "상한을 올렸는데 아무 일도 안 난다".
    expect(s.split('pumpTokenSaverQueues();').length - 1).toBeGreaterThanOrEqual(2);
  });

  it('사용자가 직접 치는 터미널은 슬롯으로 세지 않는다', () => {
    expect(source()).toContain("cfg?.executionMode === 'interactive-terminal'");
  });

  it('스폰 시차 시계는 실제로 나간 뒤에만 돈다', () => {
    expect(source()).toContain('if (freshSpawn) lastFreshSpawnAt = Date.now();');
  });
});

/*
 * J~M 은 **클로드 CLI 로 나가는 두 경로**(헤드리스 · CMD 인터랙티브 PTY)에 모두 붙어야 한다.
 * 한쪽만 붙으면 "설정 창에서 켰는데 터미널 세션에는 안 걸린다"가 되고, 그건 화면에 표시되지 않는다.
 */
describe('§5.3 #9-1 (J~M) — 두 스폰 경로에 모두 배선됐다', () => {
  it('헤드리스 스폰 env 조립이 부른다', () => {
    const s = readFileSync(new URL('./subAgentManager.ts', import.meta.url), 'utf8');
    expect(s).toContain('Object.assign(env, buildAgentTokenSaverEnv(config));');
  });

  it('CMD 인터랙티브 PTY 도 같은 함수를 쓴다', () => {
    const s = readFileSync(new URL('../../../desktop/src/main/terminalManager.ts', import.meta.url), 'utf8');
    expect(s).toContain('buildAgentTokenSaverEnv(spec.config)');
  });
});

/*
 * 전역 설정은 머신 단위(`AppState`)다 — 프로젝트 체크포인트에 새지 않아야 한다(§3.2.2 와 같은 갈래).
 */
describe('§5.3 #9-1 — 설정이 사는 자리', () => {
  it('AppState 를 통과하고 ProjectCheckpoint 로 새지 않는다', () => {
    const types = readFileSync(new URL('../../../shared/src/types.ts', import.meta.url), 'utf8');
    const appState = types.slice(types.indexOf('export interface AppState {'));
    expect(appState.slice(0, appState.indexOf('\n}')).includes('tokenSaver?: TokenSaverSettings')).toBe(true);
    const checkpoint = types.slice(types.indexOf('export interface ProjectCheckpoint {'));
    expect(checkpoint.slice(0, checkpoint.indexOf('\n}')).includes('tokenSaver')).toBe(false);
  });

  it('저장 왕복이 값을 바꾸지 않는다', () => {
    const custom: TokenSaverSettings = normalizeTokenSaverSettings({
      ...TOKEN_SAVER_PRESET_VALUES.balanced,
      maxConcurrentAgents: 3,
    });
    expect(normalizeTokenSaverSettings(JSON.parse(JSON.stringify(custom)) as TokenSaverSettings)).toEqual(custom);
  });
});

/*
 * §5.3 #9-1 (Q) — 압축 창 조이기. 실측이 가리킨 **단일 최대 지렛대**라 규칙이 어긋나면 손해가 가장 크다.
 *
 * 지켜야 하는 것 셋: ① 미설정이면 종전 그대로, ② **조이는 방향으로만**, ③ 스폰과 턴 경계 판정이
 * **같은 값**을 본다(어긋나면 CLI 는 200k 에서 접는데 우리는 400k 기준으로 쏴 우리 차례가 안 온다).
 */
describe('§5.3 #9-1 (Q) — 압축 창 해소', () => {
  it('절약이 미설정이면 종전 3층 결과 그대로다', () => {
    expect(resolveEffectiveAutoCompact(undefined, '400000', '')).toBe('400000');
    expect(resolveEffectiveAutoCompact(undefined, '400000', undefined)).toBe('400000');
    expect(resolveEffectiveAutoCompact('200000', '400000', '')).toBe('200000');
  });

  it('더 작은 창이 이긴다 — 절약은 조이기만 한다', () => {
    expect(resolveEffectiveAutoCompact(undefined, '400000', '200000')).toBe('200000');
    // 절약이 더 느슨하면 아무 일도 하지 않는다(푸는 일은 없다).
    expect(resolveEffectiveAutoCompact('200000', '400000', '400000')).toBe('200000');
    expect(resolveEffectiveAutoCompact('100000', undefined, '500000')).toBe('100000');
  });

  it('꺼져 있던 자리는 절약이 켠다 — 절약을 켠 것이 곧 "접어라"다', () => {
    expect(resolveEffectiveAutoCompact('off', 'off', '100000')).toBe('100000');
  });

  it("'auto' 보다 숫자가 조이는 값이다", () => {
    expect(resolveEffectiveAutoCompact('auto', undefined, '200000')).toBe('200000');
    // 반대로 절약이 'auto' 면 조이는 값이 아니라 무시된다.
    expect(resolveEffectiveAutoCompact('200000', undefined, 'auto')).toBe('200000');
  });

  it('CLI 눈금 밖 값은 무시한다 — 목록 밖이면 스폰이 즉시 죽는다', () => {
    expect(resolveEffectiveAutoCompact(undefined, '400000', '150000')).toBe('400000');
    expect(resolveEffectiveAutoCompact(undefined, '400000', '0')).toBe('400000');
    // 정규화도 같은 판정을 쓴다 — 저장분에 목록 밖 값이 들어와도 '' 로 되돌아간다.
    expect(normalizeTokenSaverSettings({ autoCompactWindow: '150000' }).autoCompactWindow).toBe('');
    expect(normalizeTokenSaverSettings({ autoCompactWindow: 'off' }).autoCompactWindow).toBe('');
  });

  it('프리셋 값은 CLI 가 받는 눈금 안이다', () => {
    for (const name of ['balanced', 'saver'] as const) {
      const v = TOKEN_SAVER_PRESET_VALUES[name].autoCompactWindow;
      expect(AVAILABLE_AUTOCOMPACT_VALUES.includes(v)).toBe(true);
      expect(v).not.toBe('off');
    }
    // saver 가 balanced 보다 조인다(단조).
    expect(Number(TOKEN_SAVER_PRESET_VALUES.saver.autoCompactWindow))
      .toBeLessThan(Number(TOKEN_SAVER_PRESET_VALUES.balanced.autoCompactWindow));
  });

  it('턴 경계 판정도 같은 창을 본다', () => {
    // 창 200k → 발동선은 그 아래. 그 위에서 끝난 턴은 접어야 한다.
    expect(shouldCompactAfterTurn({
      requested: false, userAutoCompact: '400000', tokenSaverAutoCompact: '200000',
      contextUsed: 180_000, contextMax: 1_000_000,
    })).toBe(true);
    // 같은 사용량이라도 절약이 없으면(400k 기준) 아직 이르다.
    expect(shouldCompactAfterTurn({
      requested: false, userAutoCompact: '400000', tokenSaverAutoCompact: '',
      contextUsed: 180_000, contextMax: 1_000_000,
    })).toBe(false);
  });
});

describe('§5.3 #9-1 (Q) — 스폰과 판정이 같은 함수를 본다', () => {
  const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');

  it('스폰 인자 조립이 해소 함수를 쓴다', () => {
    expect(read('./subAgentManager.ts'))
      .toContain('resolveEffectiveAutoCompact(config.autoCompact, ctx?.userAutoCompact, ctx?.tokenSaverAutoCompact)');
  });

  it('헤드리스·CMD 두 경로 모두 절약 값을 싣는다', () => {
    const s = read('./subAgentManager.ts');
    expect(s.split('tokenSaverAutoCompact: appStateGetTokenSaver().autoCompactWindow').length - 1).toBe(2);
  });

  it('턴 경계 판정도 같은 값을 넘긴다', () => {
    expect(read('../index.ts')).toContain('tokenSaverAutoCompact: appStateGetTokenSaver().autoCompactWindow');
  });
});
