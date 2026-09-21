import { describe, it, expect } from 'vitest';
import {
  CONFIG_TRIM_PROTECTED,
  CONFIG_TRIM_RULES,
  CONFIG_TRIM_RULE_BY_ID,
  CONFIG_TRIM_RUN_MAX_PER_PROJECT,
  CONFIG_TRIM_RUN_SNAPSHOT_MAX,
  CONFIG_TRIM_SCOPE_ORDER,
  CONFIG_TRIM_VALUE_MAX,
  appendConfigTrimRun,
  applyConfigTrimSettingsPatch,
  computeConfigTrim,
  configTrimActiveAnywhere,
  configTrimContextOf,
  configTrimRunsForSnapshot,
  configTrimScopeStates,
  configTrimSummaryFingerprint,
  describeConfigValue,
  isConfigTrimRuleId,
  normalizeConfigTrimRuns,
  normalizeConfigTrimSettings,
  resolveConfigTrimEnabled,
  withConfigTrimScope,
} from '@vibisual/shared';
import type { AgentConfig, ConfigTrimRun, ConfigTrimSettings } from '@vibisual/shared';

/**
 * §5.3 #10-5 — 설정 덜어내기. 켬/끔 3단 판정 + 규칙 표 + 저장 계약.
 *
 * 못 박는 계약:
 *  ① 기본은 꺼짐 — 아무 단도 정하지 않았으면 이 기능이 없던 때와 **한 글자도** 다르지 않다.
 *  ② 좁은 단이 이긴다(세션 → 에이전트 → 프로젝트). 세션의 명시적 false 가 프로젝트 켬을 이긴다.
 *  ③ 덜어내기는 **사본**만 깎는다 — 원본 `AgentConfig` 은 읽기만 한다.
 *  ④ 모르면 덜어내지 않는다 — 판정 재료가 없으면 배제 목록에 사유와 함께 세운다.
 *  ⑤ 손대지 않는 칸(필수·위험·사용자가 적은 값)은 규칙이 뭐라 해도 살아남는다.
 */

function cfg(p: Partial<AgentConfig> = {}): AgentConfig {
  return { model: 'opus', tools: ['Read', 'Bash'], permissionMode: 'default', skills: [], ...p };
}

function run(p: Partial<ConfigTrimRun> = {}): ConfigTrimRun {
  return {
    runId: 'ct-1', agentId: 'a1', subAgentId: 's1', commandId: 'c1',
    engine: 'claude', startedAt: 1000, trimmed: [], excluded: [], ...p,
  };
}

describe('§5.3 #10-5 ① 기본은 꺼짐 · ② 좁은 단이 이긴다', () => {
  it('설정이 없거나 비어 있으면 꺼짐이다', () => {
    expect(resolveConfigTrimEnabled(undefined)).toBe(false);
    expect(resolveConfigTrimEnabled({})).toBe(false);
    expect(resolveConfigTrimEnabled({}, { agentId: 'a1', subAgentId: 's1' })).toBe(false);
    expect(configTrimActiveAnywhere(undefined)).toBe(false);
    expect(configTrimActiveAnywhere({ enabledAgents: { a1: false } })).toBe(false);
  });

  it('세 단의 차례는 세션 → 에이전트 → 프로젝트다', () => {
    expect([...CONFIG_TRIM_SCOPE_ORDER]).toEqual(['project', 'agent', 'session']);
    const s: ConfigTrimSettings = { enabledProject: true, enabledAgents: { a1: false } };
    expect(resolveConfigTrimEnabled(s, { agentId: 'a1' })).toBe(false);
    expect(resolveConfigTrimEnabled(s, { agentId: 'other' })).toBe(true);
    const s2: ConfigTrimSettings = { ...s, enabledSessions: { s1: true } };
    expect(resolveConfigTrimEnabled(s2, { agentId: 'a1', subAgentId: 's1' })).toBe(true);
    expect(resolveConfigTrimEnabled(s2, { agentId: 'a1', subAgentId: 's2' })).toBe(false);
  });
});

describe('§5.3 #10-5 스위치는 한 길로만 바뀐다', () => {
  it('null 을 주면 그 칸을 지워 윗단을 물려받는다', () => {
    const on = withConfigTrimScope({ enabledProject: true }, 'agent', 'a1', false);
    expect(resolveConfigTrimEnabled(on, { agentId: 'a1' })).toBe(false);
    const cleared = withConfigTrimScope(on, 'agent', 'a1', null);
    expect(cleared.enabledAgents).toBeUndefined();
    expect(resolveConfigTrimEnabled(cleared, { agentId: 'a1' })).toBe(true);
  });

  it('id 없는 에이전트·세션 칸은 아무 것도 바꾸지 않는다', () => {
    const before: ConfigTrimSettings = { enabledProject: true };
    expect(withConfigTrimScope(before, 'session', '', true)).toEqual(before);
    expect(withConfigTrimScope(before, 'agent', undefined, true)).toEqual(before);
  });

  it('화면이 그리는 세 줄은 id 가 있을 때만 만질 수 있다', () => {
    const states = configTrimScopeStates({ enabledProject: true }, { agentId: 'a1' });
    expect(states.map((s) => s.scope)).toEqual(['project', 'agent', 'session']);
    expect(states[1]?.available).toBe(true);
    expect(states[1]?.inherited).toBe(true);
    expect(states[1]?.effective).toBe(true);
    expect(states[2]?.available).toBe(false);
  });
});

describe('§5.3 #10-5 설정 patch 와 저장', () => {
  it('patch 는 규칙 끄기 한 칸만 받는다 — 스위치를 patch 로 덮을 수 없다', () => {
    const bad = applyConfigTrimSettingsPatch({}, { enabledProject: true }, 5);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.field).toBe('enabledProject');
    const bad2 = applyConfigTrimSettingsPatch({}, { disabledRules: ['nope'] }, 5);
    expect(bad2.ok).toBe(false);
    if (!bad2.ok) expect(bad2.field).toBe('disabledRules');
  });

  it('null·빈 배열은 그 칸을 지우고, 보낸 칸만 바뀐다', () => {
    const first = applyConfigTrimSettingsPatch({ enabledProject: true }, { disabledRules: ['effort-default'] }, 7);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.settings.disabledRules).toEqual(['effort-default']);
    expect(first.settings.enabledProject).toBe(true);
    expect(first.settings.updatedAt).toBe(7);
    const cleared = applyConfigTrimSettingsPatch(first.settings, { disabledRules: null }, 9);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.settings.disabledRules).toBeUndefined();
    expect(cleared.settings.enabledProject).toBe(true);
  });

  it('바깥에서 온 설정은 모양이 어긋난 칸만 버리고 접힌다', () => {
    const s = normalizeConfigTrimSettings({
      enabledProject: 'yes', enabledAgents: { a1: true, '': true, a2: 'no' },
      disabledRules: ['effort-default', 'nope', 'effort-default'], updatedAt: 'later',
    });
    expect(s.enabledProject).toBeUndefined();
    expect(s.enabledAgents).toEqual({ a1: true });
    expect(s.disabledRules).toEqual(['effort-default']);
    expect(s.updatedAt).toBeUndefined();
  });

  it('런은 같은 id 를 덮어쓰고 상한을 넘으면 오래된 것부터 버린다', () => {
    let runs: ConfigTrimRun[] = [];
    for (let i = 0; i < CONFIG_TRIM_RUN_MAX_PER_PROJECT + 5; i += 1) {
      runs = appendConfigTrimRun(runs, run({ runId: `ct-${i}`, startedAt: i }));
    }
    expect(runs.length).toBe(CONFIG_TRIM_RUN_MAX_PER_PROJECT);
    expect(runs[0]?.runId).toBe('ct-5');
    const again = appendConfigTrimRun(runs, run({ runId: 'ct-5', startedAt: 999 }));
    expect(again.length).toBe(CONFIG_TRIM_RUN_MAX_PER_PROJECT);
    expect(again.filter((r) => r.runId === 'ct-5').length).toBe(1);
    expect(configTrimRunsForSnapshot(again).length).toBe(CONFIG_TRIM_RUN_SNAPSHOT_MAX);
    expect(normalizeConfigTrimRuns([{ runId: '', agentId: 'a' }, run()]).length).toBe(1);
  });
});

describe('§5.3 #10-5 ③ 사본만 깎는다 · ④ 모르면 안 덜어낸다', () => {
  it('원본은 읽기만 한다 — 덜어낸 것은 새 사본에서만 사라진다', () => {
    const original = Object.freeze(cfg({ presetId: 'p1', effort: 'default', thinking: true }));
    const r = computeConfigTrim(original, configTrimContextOf({ engine: 'claude', config: original }));
    expect(r.config).not.toBe(original);
    expect(original.presetId).toBe('p1');
    expect(original.effort).toBe('default');
    const gone = r.trimmed.map((t) => t.field).sort();
    expect(gone).toEqual(['effort', 'presetId', 'thinking']);
    expect(r.config.presetId).toBeUndefined();
    expect(r.config.thinking).toBeUndefined();
    expect(r.trimmed.find((t) => t.field === 'presetId')?.before).toBe('p1');
  });

  it('판정 재료가 없으면 덜어내지 않고 배제 목록에 세운다', () => {
    const config = cfg({ modelVersion: 'claude-opus-4-20990101' });
    const blind = computeConfigTrim(config, { engine: 'claude' });
    expect(blind.trimmed.map((t) => t.field)).not.toContain('modelVersion');
    const unknown = blind.excluded.find((e) => e.field === 'modelVersion');
    expect(unknown?.keep).toBe('unknown');
    expect(unknown?.ruleId).toBe('model-version-gone');
    const known = computeConfigTrim(config, { engine: 'claude', knownModelIds: ['claude-opus-4-1'] });
    expect(known.trimmed.map((t) => t.field)).toContain('modelVersion');
    expect(known.config.modelVersion).toBeUndefined();
  });
});

describe('§5.3 #10-5 ⑤ 손대지 않는 칸 · 규칙 끄기', () => {
  it('필수 네 칸과 사용자가 적은 값은 규칙이 뭐라 해도 살아남는다', () => {
    const config = cfg({ rules: '항상 한국어로', color: '#ff0000' });
    const r = computeConfigTrim(config, configTrimContextOf({ engine: 'claude', config }));
    for (const f of ['model', 'tools', 'permissionMode', 'skills', 'rules', 'color']) {
      expect(r.trimmed.map((t) => t.field)).not.toContain(f);
      expect(r.config[f as keyof AgentConfig]).toBeDefined();
    }
    expect(r.excluded.find((e) => e.field === 'model')?.keep).toBe('required');
    expect(r.excluded.find((e) => e.field === 'rules')?.keep).toBe('user-set');
  });

  it('꺼 둔 규칙은 덜어내지 않고 배제 목록에 `rule-off` 로 선다', () => {
    const config = cfg({ effort: 'default' });
    const off = computeConfigTrim(config, { engine: 'claude', disabledRules: ['effort-default'] });
    expect(off.config.effort).toBe('default');
    const kept = off.excluded.find((e) => e.field === 'effort');
    expect(kept?.keep).toBe('rule-off');
    expect(kept?.ruleId).toBe('effort-default');
  });

  it('덜어낼 것이 없으면 두 목록 중 덜어낸 쪽이 비어 있다', () => {
    const config = cfg();
    const r = computeConfigTrim(config, configTrimContextOf({ engine: 'claude', config }));
    expect(r.trimmed).toEqual([]);
    expect(r.excluded.length).toBeGreaterThan(0);
  });
});

describe('§5.3 #10-5 규칙 표 자체의 무결성', () => {
  it('id 는 겹치지 않고, 손대지 않는 칸을 보는 규칙은 없다', () => {
    const ids = CONFIG_TRIM_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(CONFIG_TRIM_RULE_BY_ID).sort()).toEqual([...ids].sort());
    const protectedFields = new Set(CONFIG_TRIM_PROTECTED.map((p) => p.field as string));
    for (const rule of CONFIG_TRIM_RULES) {
      expect(protectedFields.has(rule.field as string), `${rule.id} 가 손대지 않는 칸을 본다`).toBe(false);
      expect(isConfigTrimRuleId(rule.id)).toBe(true);
    }
    expect(isConfigTrimRuleId('nope')).toBe(false);
  });

  it('규칙이 터져도 그 칸은 남는다 — 모른다고 보고 배제한다', () => {
    const boom = CONFIG_TRIM_RULES.find((r) => r.id === 'context-window-non-opus');
    expect(boom).toBeTruthy();
    const config = cfg({ contextWindow: '1m' });
    const r = computeConfigTrim(config, { engine: 'claude' });
    expect(r.config.contextWindow).toBe('1m');
    expect(r.excluded.find((e) => e.field === 'contextWindow')?.keep).toBe('unknown');
  });

  it('값 사본은 상한에서 잘린다', () => {
    const long = 'x'.repeat(CONFIG_TRIM_VALUE_MAX + 50);
    expect(describeConfigValue(long).length).toBe(CONFIG_TRIM_VALUE_MAX);
    expect(describeConfigValue(long).endsWith('...')).toBe(true);
  });

  it('지문은 같은 내용이면 같고, 한 칸만 달라도 다르다', () => {
    const a = { settings: { enabledProject: true, updatedAt: 3 }, runs: [run()] };
    const b = { settings: { enabledProject: true, updatedAt: 3 }, runs: [run()] };
    expect(configTrimSummaryFingerprint(a)).toBe(configTrimSummaryFingerprint(b));
    expect(configTrimSummaryFingerprint({ ...b, settings: { ...b.settings, updatedAt: 4 } }))
      .not.toBe(configTrimSummaryFingerprint(a));
  });
});
