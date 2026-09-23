import { describe, it, expect } from 'vitest';
import {
  ORCHESTRA_DEFAULT_MAX_MEMBERS,
  ORCHESTRA_MAX_MEMBERS_LIMIT,
  ORCHESTRA_PLAN_NOTE_MAX,
  ORCHESTRA_PLAN_REASON_MAX,
  ORCHESTRA_RUN_MAX_PER_PROJECT,
  ORCHESTRA_RUN_REQUEST_MAX,
  ORCHESTRA_RUN_SNAPSHOT_MAX,
  ORCHESTRA_SCOPE_ORDER,
  appendOrchestraRun,
  applyOrchestraSettingsPatch,
  capOrchestraMap,
  clipOrchestraRequest,
  isOrchestraRunSettled,
  isOrchestraStrategyAllowed,
  findAgentToolTemplate,
  normalizeOrchestraRun,
  normalizeOrchestraRuns,
  normalizeOrchestraSettings,
  orchestraActiveAnywhere,
  orchestraAllowedStrategies,
  orchestraMemberBirthConfig,
  orchestraRunsForSnapshot,
  orchestraScopeStates,
  orchestraSummaryFingerprint,
  resolveOrchestraConductorPermission,
  resolveOrchestraEnabled,
  resolveOrchestraMaxMembers,
  resolveOrchestraMemberEngine,
  resolveOrchestraMemberIsolation,
  resolveOrchestraMemberToolTemplate,
  settleStaleOrchestraRuns,
  validateOrchestraPlan,
  withOrchestraScope,
} from '@vibisual/shared';
import type { OrchestraPlanContext, OrchestraRun, OrchestraSettings } from '@vibisual/shared';

/**
 * §5.3 #10-4 — 오케스트라 켬/끔 2층 판정 + 설정·런·계획 신고 계약.
 *
 * 못 박는 계약:
 *  ① 기본은 꺼짐 — 어느 층도 정하지 않았으면 이 기능이 없던 때와 같다.
 *  ② 에이전트 층의 명시적 false 가 프로젝트 켬을 이긴다(지휘자가 만든 멤버의 재귀 방지가 이것에 기댄다).
 *  ③ 설정 patch 는 보낸 칸만 바꾸고, 어긋난 값은 조용히 버리지 않고 칸 이름으로 실패한다.
 *  ④ 계획 신고는 조용히 고쳐 받지 않는다 — 틀린 id 목록을 돌려줘 지휘자가 스스로 고치게 한다.
 */

function run(partial: Partial<OrchestraRun> = {}): OrchestraRun {
  return {
    runId: 'orc-1',
    projectPath: '/work/demo',
    agentId: 'conductor',
    commandId: 'cmd-1',
    userRequest: 'build the thing',
    engine: 'claude',
    phase: 'conducting',
    startedAt: 1000,
    memberAgentIds: [],
    inputTokens: 0,
    outputTokens: 0,
    ...partial,
  };
}

describe('resolveOrchestraEnabled — agent ?? project ?? false', () => {
  it('설정이 없거나 아무 층도 정하지 않았으면 꺼짐', () => {
    expect(resolveOrchestraEnabled(undefined, 'a')).toBe(false);
    expect(resolveOrchestraEnabled(null, 'a')).toBe(false);
    expect(resolveOrchestraEnabled({}, 'a')).toBe(false);
  });

  it('프로젝트 켬은 정하지 않은 에이전트에 물려준다', () => {
    expect(resolveOrchestraEnabled({ enabledProject: true }, 'a')).toBe(true);
    expect(resolveOrchestraEnabled({ enabledProject: true }, undefined)).toBe(true);
  });

  it('에이전트 층의 명시적 false 가 프로젝트 켬을 이긴다(멤버 재귀 방지)', () => {
    expect(resolveOrchestraEnabled({ enabledProject: true, enabledAgents: { m1: false } }, 'm1')).toBe(false);
    expect(resolveOrchestraEnabled({ enabledProject: true, enabledAgents: { m1: false } }, 'other')).toBe(true);
  });

  it('프로젝트를 꺼도 에이전트 층 켬이면 그 에이전트만 켜진다', () => {
    expect(resolveOrchestraEnabled({ enabledProject: false, enabledAgents: { a: true } }, 'a')).toBe(true);
    expect(resolveOrchestraEnabled({ enabledProject: false, enabledAgents: { a: true } }, 'b')).toBe(false);
  });
});

describe('orchestraActiveAnywhere', () => {
  it('어느 층에서든 켜진 것이 있으면 참', () => {
    expect(orchestraActiveAnywhere(undefined)).toBe(false);
    expect(orchestraActiveAnywhere({})).toBe(false);
    expect(orchestraActiveAnywhere({ enabledProject: true })).toBe(true);
    expect(orchestraActiveAnywhere({ enabledAgents: { a: false } })).toBe(false);
    expect(orchestraActiveAnywhere({ enabledProject: false, enabledAgents: { a: false, b: true } })).toBe(true);
  });
});

describe('orchestraScopeStates', () => {
  it('층 순서는 프로젝트 → 에이전트', () => {
    expect(ORCHESTRA_SCOPE_ORDER).toEqual(['project', 'agent']);
    expect(orchestraScopeStates({}, 'a').map((s) => s.scope)).toEqual(['project', 'agent']);
  });

  it('상속과 명시를 구분해 그린다', () => {
    const [project, agent] = orchestraScopeStates({ enabledProject: true }, 'a');
    expect(project).toEqual({ scope: 'project', own: true, effective: true, inherited: false, available: true });
    expect(agent).toEqual({ scope: 'agent', own: null, effective: true, inherited: true, available: true });
  });

  it('에이전트 id 가 없으면 에이전트 층은 고를 수 없다', () => {
    const [, agent] = orchestraScopeStates({ enabledProject: false }, null);
    expect(agent?.available).toBe(false);
    expect(agent?.effective).toBe(false);
  });

  it('마지막 층의 effective 는 resolveOrchestraEnabled 와 같다', () => {
    const cases: Array<[OrchestraSettings, string]> = [
      [{}, 'a'],
      [{ enabledProject: true }, 'a'],
      [{ enabledProject: true, enabledAgents: { a: false } }, 'a'],
      [{ enabledProject: false, enabledAgents: { a: true } }, 'a'],
    ];
    for (const [s, id] of cases) {
      expect(orchestraScopeStates(s, id)[1]?.effective).toBe(resolveOrchestraEnabled(s, id));
    }
  });
});

describe('withOrchestraScope', () => {
  it('null 은 칸을 지운다(상속으로 되돌린다) — false 와 다르다', () => {
    expect(withOrchestraScope({ enabledProject: true }, 'project', null, null)).toEqual({});
    expect(withOrchestraScope({ enabledProject: true }, 'project', null, false)).toEqual({ enabledProject: false });
  });

  it('에이전트 칸을 다 지우면 맵 자체를 지운다', () => {
    const on = withOrchestraScope({}, 'agent', 'a', true);
    expect(on.enabledAgents).toEqual({ a: true });
    expect(withOrchestraScope(on, 'agent', 'a', null)).toEqual({});
  });

  it('다른 칸은 그대로 옮겨 담고 원본은 건드리지 않는다', () => {
    const base: OrchestraSettings = { enabledProject: true, enabledAgents: { a: true }, memberEngine: 'codex' };
    const next = withOrchestraScope(base, 'agent', 'b', false);
    expect(next).toEqual({ enabledProject: true, enabledAgents: { a: true, b: false }, memberEngine: 'codex' });
    expect(base.enabledAgents).toEqual({ a: true });
  });

  it('에이전트 층에 id 가 없으면 아무것도 바꾸지 않는다', () => {
    expect(withOrchestraScope({ enabledProject: true }, 'agent', null, true)).toEqual({ enabledProject: true });
    expect(withOrchestraScope({ enabledProject: true }, 'agent', '  ', true)).toEqual({ enabledProject: true });
  });
});

describe('capOrchestraMap', () => {
  it('상한을 넘으면 가장 먼저 적힌 칸부터 버린다', () => {
    expect(capOrchestraMap({ a: true, b: false, c: true }, 2)).toEqual({ b: false, c: true });
    const small = { a: true };
    expect(capOrchestraMap(small, 2)).toBe(small);
  });
});

describe('resolve* 기본값', () => {
  it('멤버 상한 — 없으면 기본, 범위 밖이면 가장자리', () => {
    expect(resolveOrchestraMaxMembers(undefined)).toBe(ORCHESTRA_DEFAULT_MAX_MEMBERS);
    expect(resolveOrchestraMaxMembers({ maxMembers: Number.NaN })).toBe(ORCHESTRA_DEFAULT_MAX_MEMBERS);
    expect(resolveOrchestraMaxMembers({ maxMembers: 0 })).toBe(1);
    expect(resolveOrchestraMaxMembers({ maxMembers: 99 })).toBe(ORCHESTRA_MAX_MEMBERS_LIMIT);
    expect(resolveOrchestraMaxMembers({ maxMembers: 3 })).toBe(3);
  });

  it('지휘 권한 — 없으면 bypass', () => {
    expect(resolveOrchestraConductorPermission(undefined)).toBe('bypass');
    expect(resolveOrchestraConductorPermission({ conductorPermission: 'inherit' })).toBe('inherit');
  });

  it('멤버 엔진 — 없으면 claude', () => {
    expect(resolveOrchestraMemberEngine(undefined)).toBe('claude');
    expect(resolveOrchestraMemberEngine({ memberEngine: 'auto' })).toBe('auto');
    expect(resolveOrchestraMemberEngine({ memberEngine: 'codex' })).toBe('codex');
  });

  it('멤버 작업 폴더 — 없으면 none', () => {
    expect(resolveOrchestraMemberIsolation(undefined)).toBe('none');
    expect(resolveOrchestraMemberIsolation({ memberIsolation: 'none' })).toBe('none');
    expect(resolveOrchestraMemberIsolation({ memberIsolation: 'worktree' })).toBe('worktree');
  });

  /* `all` 은 기본값과 같은 목록이라 못 박지 않는다 — 박으면 설정 창의 도구 수정이 멤버에게 닿지 않는다(§4 3층). */
  it("멤버 도구 템플릿 — 없는 id·빈 문자열·'all' 은 안 박는다", () => {
    expect(resolveOrchestraMemberToolTemplate(undefined)).toBeUndefined();
    expect(resolveOrchestraMemberToolTemplate({ memberToolTemplate: '' })).toBeUndefined();
    expect(resolveOrchestraMemberToolTemplate({ memberToolTemplate: 'all' })).toBeUndefined();
    expect(resolveOrchestraMemberToolTemplate({ memberToolTemplate: 'nope' })).toBeUndefined();
    expect(resolveOrchestraMemberToolTemplate({ memberToolTemplate: 'review' })).toBe('review');
  });
});

/**
 * 멤버가 **태어날 때** 서버가 박는 칸. 지휘자가 ② PATCH 로 넣을 수 없는 두 축이라(권한 축은
 * loopback 유입에서 얼려 있다 — §5.3 #12-1) 사용자 스위치의 집행으로 서버가 대신 심는다.
 */
describe('orchestraMemberBirthConfig', () => {
  it('두 스위치가 다 꺼져 있으면 아무것도 박지 않는다', () => {
    expect(orchestraMemberBirthConfig(undefined)).toBeNull();
    expect(orchestraMemberBirthConfig({})).toBeNull();
    expect(orchestraMemberBirthConfig({ memberIsolation: 'none' })).toBeNull();
    expect(orchestraMemberBirthConfig({ memberToolTemplate: 'all' })).toBeNull();
  });

  it('격리만 켜면 isolation 한 칸', () => {
    expect(orchestraMemberBirthConfig({ memberIsolation: 'worktree' })).toEqual({ isolation: 'worktree' });
  });

  it('도구만 고르면 tools 한 칸 — 템플릿 목록을 그대로 베낀다', () => {
    const born = orchestraMemberBirthConfig({ memberToolTemplate: 'review' });
    expect(born).toEqual({ tools: findAgentToolTemplate('review')!.tools });
    expect(born!.isolation).toBeUndefined();
    // 베낀 배열이라 되돌려 고쳐도 템플릿 원본이 상하지 않는다.
    born!.tools!.push('Write');
    expect(findAgentToolTemplate('review')!.tools).not.toContain('Write');
  });

  it('둘 다 켜면 두 칸', () => {
    expect(orchestraMemberBirthConfig({ memberIsolation: 'worktree', memberToolTemplate: 'readOnly' })).toEqual({
      isolation: 'worktree',
      tools: findAgentToolTemplate('readOnly')!.tools,
    });
  });
});

describe('방안 허용', () => {
  it('참고 전용(11·12·13)은 고를 수 없고, 사용자가 꺼 둔 것도 빠진다', () => {
    const all = orchestraAllowedStrategies(undefined).map((s) => s.id);
    expect(all).toHaveLength(10);
    expect(all).not.toContain('reminders');
    expect(all).not.toContain('preamble');
    expect(all).not.toContain('other');
    const off = orchestraAllowedStrategies({ disabledStrategies: ['output', 'web'] }).map((s) => s.id);
    expect(off).toHaveLength(8);
    expect(off).not.toContain('output');
    expect(off[0]).toBe('subagents');
  });

  it('isOrchestraStrategyAllowed 는 없는 id·참고 전용·꺼둔 것에 거짓', () => {
    expect(isOrchestraStrategyAllowed(undefined, 'subagents')).toBe(true);
    expect(isOrchestraStrategyAllowed(undefined, 'nope')).toBe(false);
    expect(isOrchestraStrategyAllowed(undefined, 'reminders')).toBe(false);
    expect(isOrchestraStrategyAllowed({ disabledStrategies: ['subagents'] }, 'subagents')).toBe(false);
  });
});

describe('normalizeOrchestraSettings', () => {
  it('객체가 아니면 빈 설정', () => {
    expect(normalizeOrchestraSettings(null)).toEqual({});
    expect(normalizeOrchestraSettings([])).toEqual({});
    expect(normalizeOrchestraSettings('x')).toEqual({});
  });

  it('모델 칸은 모양만 본다 — 대괄호 붙은 모델도 지나가고, 줄바꿈·따옴표는 버린다', () => {
    const s = normalizeOrchestraSettings({
      conductorClaudeModel: 'claude-opus-5[1m]',
      conductorCodexModel: 'gpt-5.1-codex',
      conductorCodexReasoning: 'high',
      memberClaudeModel: 'opus\nrm -rf',
      memberCodexModel: 'a"b',
      memberClaudeEffort: '',
    });
    expect(s).toEqual({ conductorClaudeModel: 'claude-opus-5[1m]', conductorCodexModel: 'gpt-5.1-codex', conductorCodexReasoning: 'high' });
  });

  it('어긋난 칸은 버리고 맞는 칸만 담는다', () => {
    const s = normalizeOrchestraSettings({
      enabledProject: 'yes',
      enabledAgents: { a: true, b: 'no', '  ': true },
      conductorPermission: 'root',
      askQuestions: true,
      memberEngine: 'gemini',
      maxMembers: 50,
      memberIsolation: 'branch',
      memberToolTemplate: 'nope',
      disabledStrategies: ['output', 'nope', 'output', 'web'],
      updatedAt: 42,
    });
    expect(s).toEqual({
      enabledAgents: { a: true },
      askQuestions: true,
      maxMembers: ORCHESTRA_MAX_MEMBERS_LIMIT,
      disabledStrategies: ['output', 'web'],
      updatedAt: 42,
    });
  });

  /* 사라진 템플릿의 id 가 남으면 "좁혔다고 믿는 빈 칸"이 된다 — 목록에 있는 것만 살린다. */
  it('멤버 태생 두 칸은 아는 값만 살린다', () => {
    expect(normalizeOrchestraSettings({ memberIsolation: 'worktree', memberToolTemplate: 'review' })).toEqual({
      memberIsolation: 'worktree',
      memberToolTemplate: 'review',
    });
    expect(normalizeOrchestraSettings({ memberIsolation: 'none', memberToolTemplate: 'all' })).toEqual({
      memberIsolation: 'none',
      memberToolTemplate: 'all',
    });
  });
});

describe('applyOrchestraSettingsPatch', () => {
  const current: OrchestraSettings = { enabledProject: true, memberEngine: 'codex', maxMembers: 4, conductorClaudeModel: 'opus' };

  it('보낸 칸만 바꾸고 updatedAt 을 찍는다 — 켬/끔 칸은 그대로', () => {
    const r = applyOrchestraSettingsPatch(current, { askQuestions: true, conductorCodexModel: 'gpt-5.1-codex' }, 777);
    expect(r).toEqual({
      ok: true,
      settings: { ...current, askQuestions: true, conductorCodexModel: 'gpt-5.1-codex', updatedAt: 777 },
    });
    expect(current.askQuestions).toBeUndefined();
  });

  it('null 과 빈 문자열은 그 칸을 지운다', () => {
    const r = applyOrchestraSettingsPatch(current, { memberEngine: null, conductorClaudeModel: '', maxMembers: null }, 1);
    expect(r).toEqual({ ok: true, settings: { enabledProject: true, updatedAt: 1 } });
  });

  it('멤버 태생 두 칸도 같은 창구로 켜고 끈다', () => {
    const on = applyOrchestraSettingsPatch(current, { memberIsolation: 'worktree', memberToolTemplate: 'review' }, 5);
    expect(on).toEqual({
      ok: true,
      settings: { ...current, memberIsolation: 'worktree', memberToolTemplate: 'review', updatedAt: 5 },
    });
    const off = applyOrchestraSettingsPatch(
      { memberIsolation: 'worktree', memberToolTemplate: 'review' },
      { memberIsolation: null, memberToolTemplate: '' },
      5,
    );
    expect(off).toEqual({ ok: true, settings: { updatedAt: 5 } });
  });

  it('disabledStrategies 는 겹침을 접고, 빈 배열이면 칸을 지운다', () => {
    const r = applyOrchestraSettingsPatch({}, { disabledStrategies: ['web', 'web', 'shell'] }, 1);
    expect(r.ok && r.settings.disabledStrategies).toEqual(['web', 'shell']);
    const cleared = applyOrchestraSettingsPatch({ disabledStrategies: ['web'] }, { disabledStrategies: [] }, 1);
    expect(cleared.ok && cleared.settings.disabledStrategies).toBeUndefined();
  });

  it.each<[string, unknown, string]>([
    ['patch 가 객체가 아님', [1], 'patch'],
    ['patch 가 null', null, 'patch'],
    ['켬/끔 칸은 이 창구로 받지 않는다', { enabledProject: false }, 'enabledProject'],
    ['에이전트 켬/끔도', { enabledAgents: { a: true } }, 'enabledAgents'],
    ['모르는 칸', { temperature: 1 }, 'temperature'],
    ['모델에 줄바꿈', { conductorClaudeModel: 'opus\n' + 'x'.repeat(200) }, 'conductorClaudeModel'],
    ['모델에 따옴표', { memberCodexModel: 'a"b' }, 'memberCodexModel'],
    ['권한 값', { conductorPermission: 'root' }, 'conductorPermission'],
    ['질문 켬 값', { askQuestions: 'yes' }, 'askQuestions'],
    ['멤버 엔진 값', { memberEngine: 'gemini' }, 'memberEngine'],
    ['멤버 상한 0', { maxMembers: 0 }, 'maxMembers'],
    ['멤버 상한 초과', { maxMembers: ORCHESTRA_MAX_MEMBERS_LIMIT + 1 }, 'maxMembers'],
    ['멤버 상한 소수', { maxMembers: 2.5 }, 'maxMembers'],
    ['멤버 격리 값', { memberIsolation: 'branch' }, 'memberIsolation'],
    ['모르는 도구 템플릿', { memberToolTemplate: 'nope' }, 'memberToolTemplate'],
    ['도구 템플릿이 문자열이 아님', { memberToolTemplate: 3 }, 'memberToolTemplate'],
    ['모르는 방안', { disabledStrategies: ['output', 'nope'] }, 'disabledStrategies'],
    ['방안이 배열이 아님', { disabledStrategies: 'output' }, 'disabledStrategies'],
  ])('%s → 실패(%s)', (_label, patch, field) => {
    expect(applyOrchestraSettingsPatch(current, patch, 1)).toEqual({ ok: false, field });
  });
});

describe('런 목록', () => {
  it('편성 중과 결과 회수 대기는 아직 돌고 있다', () => {
    expect(isOrchestraRunSettled('conducting')).toBe(false);
    expect(isOrchestraRunSettled('dispatched')).toBe(false);
    for (const p of ['completed', 'answered', 'unreported', 'error'] as const) expect(isOrchestraRunSettled(p)).toBe(true);
  });

  it('appendOrchestraRun 은 상한을 넘으면 가장 오래된 것부터 버린다', () => {
    const runs = [run({ runId: 'a' }), run({ runId: 'b' })];
    expect(appendOrchestraRun(runs, run({ runId: 'c' }), 2).map((r) => r.runId)).toEqual(['b', 'c']);
    const many = Array.from({ length: ORCHESTRA_RUN_MAX_PER_PROJECT }, (_, i) => run({ runId: `r${i}` }));
    const next = appendOrchestraRun(many, run({ runId: 'new' }));
    expect(next).toHaveLength(ORCHESTRA_RUN_MAX_PER_PROJECT);
    expect(next[0]?.runId).toBe('r1');
    expect(next.at(-1)?.runId).toBe('new');
  });

  it('스냅샷에는 꼬리만 싣는다', () => {
    const many = Array.from({ length: ORCHESTRA_RUN_SNAPSHOT_MAX + 5 }, (_, i) => run({ runId: `r${i}` }));
    const tail = orchestraRunsForSnapshot(many);
    expect(tail).toHaveLength(ORCHESTRA_RUN_SNAPSHOT_MAX);
    expect(tail[0]?.runId).toBe('r5');
    const few = [run()];
    expect(orchestraRunsForSnapshot(few)).not.toBe(few);
    expect(orchestraRunsForSnapshot(few)).toEqual(few);
  });

  it('기록용 원문 사본만 자른다', () => {
    expect(clipOrchestraRequest('abc')).toBe('abc');
    expect(clipOrchestraRequest('x'.repeat(ORCHESTRA_RUN_REQUEST_MAX + 10))).toHaveLength(ORCHESTRA_RUN_REQUEST_MAX);
  });

  it('다시 켰을 때 편성·결과 회수 중인 런을 닫고, 옛 위임 기록과 완료는 보존한다', () => {
    const legacy = run({ runId: 'legacy', phase: 'dispatched', endedAt: 6 });
    const completed = run({ runId: 'done', phase: 'completed', endedAt: 7 });
    const settled = settleStaleOrchestraRuns([
      run(), run({ runId: 'b', endedAt: 5 }), run({ runId: 'c', phase: 'dispatched' }), legacy, completed,
    ], 9000);
    expect(settled.map((r) => [r.phase, r.endedAt])).toEqual([
      ['unreported', 9000], ['unreported', 5], ['unreported', 9000], ['dispatched', 6], ['completed', 7],
    ]);
    expect(settled[3]).toBe(legacy);
    expect(settled[4]).toBe(completed);
  });
});

describe('normalizeOrchestraRun(s)', () => {
  it('회수 대기와 최종 완료 단계를 영속 왕복에서 구분한다', () => {
    const dispatched = run({ phase: 'dispatched', planAt: 2000 });
    const completed = run({ phase: 'completed', planAt: 2000, endedAt: 5000 });
    expect(normalizeOrchestraRun(JSON.parse(JSON.stringify(dispatched)))).toEqual(dispatched);
    expect(normalizeOrchestraRun(JSON.parse(JSON.stringify(completed)))).toEqual(completed);
  });

  it('필수 칸이 어긋나면 버린다', () => {
    expect(normalizeOrchestraRun(null)).toBeNull();
    expect(normalizeOrchestraRun({ ...run(), runId: '' })).toBeNull();
    expect(normalizeOrchestraRun({ ...run(), projectPath: 3 })).toBeNull();
    expect(normalizeOrchestraRun({ ...run(), startedAt: 'now' })).toBeNull();
  });

  it('모르는 단계는 unreported, 모르는 엔진은 claude, 토큰은 0 이상 정수', () => {
    const r = normalizeOrchestraRun({ ...run(), phase: 'weird', engine: 'gemini', inputTokens: -5, outputTokens: 12.6 });
    expect(r?.phase).toBe('unreported');
    expect(r?.engine).toBe('claude');
    expect(r?.inputTokens).toBe(0);
    expect(r?.outputTokens).toBe(13);
  });

  it('멤버 목록은 겹침·빈 값을 접고, 계획·시각·만든 수를 살린다', () => {
    const r = normalizeOrchestraRun({
      ...run(),
      userRequest: 'y'.repeat(ORCHESTRA_RUN_REQUEST_MAX + 1),
      memberAgentIds: ['a', 'a', '', 3, 'b'],
      createdMemberCount: 2,
      planAt: 3000,
      endedAt: 4000,
      plan: {
        intent: 'feature',
        topology: 'pipeline',
        chosen: [{ id: 'output', reason: 'r'.repeat(ORCHESTRA_PLAN_REASON_MAX + 20) }, { id: 'bogus', reason: 'x' }],
        skipped: [],
        entryAgentId: 'a',
        note: 'n'.repeat(ORCHESTRA_PLAN_NOTE_MAX + 20),
      },
    });
    expect(r?.userRequest).toHaveLength(ORCHESTRA_RUN_REQUEST_MAX);
    expect(r?.memberAgentIds).toEqual(['a', 'b']);
    expect(r?.createdMemberCount).toBe(2);
    expect(r?.planAt).toBe(3000);
    expect(r?.endedAt).toBe(4000);
    expect(r?.plan?.chosen).toEqual([{ id: 'output', reason: 'r'.repeat(ORCHESTRA_PLAN_REASON_MAX) }]);
    expect(r?.plan?.skipped).toBeUndefined();
    expect(r?.plan?.entryAgentId).toBe('a');
    expect(r?.plan?.note).toHaveLength(ORCHESTRA_PLAN_NOTE_MAX);
  });

  it('계획의 의도·편성이 어긋나면 계획만 버린다', () => {
    const r = normalizeOrchestraRun({ ...run(), plan: { intent: 'chat', topology: 'single', chosen: [] } });
    expect(r).not.toBeNull();
    expect(r?.plan).toBeUndefined();
    expect(r?.createdMemberCount).toBeUndefined();
  });

  it('같은 runId 는 뒤의 것 하나만, 순서는 뒤의 자리로', () => {
    const list = normalizeOrchestraRuns([
      run({ runId: 'a', inputTokens: 1 }),
      run({ runId: 'b' }),
      { bad: true },
      run({ runId: 'a', inputTokens: 9 }),
    ]);
    expect(list.map((r) => [r.runId, r.inputTokens])).toEqual([['b', 0], ['a', 9]]);
    expect(normalizeOrchestraRuns('x')).toEqual([]);
  });

  it('체크포인트에서도 ring 상한을 지킨다', () => {
    const many = Array.from({ length: ORCHESTRA_RUN_MAX_PER_PROJECT + 3 }, (_, i) => run({ runId: `r${i}` }));
    const list = normalizeOrchestraRuns(many);
    expect(list).toHaveLength(ORCHESTRA_RUN_MAX_PER_PROJECT);
    expect(list[0]?.runId).toBe('r3');
  });
});

describe('validateOrchestraPlan', () => {
  const ctx: OrchestraPlanContext = { settings: {}, projectAgentIds: new Set(['m1', 'm2']) };
  const good = {
    intent: 'feature',
    topology: 'pipeline',
    chosen: [{ id: 'subagents', reason: ' 조사를 멤버에게 맡긴다 ' }],
    skipped: [{ id: 'web', reason: '웹 조사가 필요 없다' }],
    reusedAgentIds: ['m1', 'm1'],
    entryAgentId: 'm2',
    note: '  엔진은 claude  ',
  };

  it('맞는 신고는 이유를 다듬어 받고 재사용 멤버를 겹침 없이 돌려준다', () => {
    expect(validateOrchestraPlan(good, ctx)).toEqual({
      ok: true,
      plan: {
        intent: 'feature',
        topology: 'pipeline',
        chosen: [{ id: 'subagents', reason: '조사를 멤버에게 맡긴다' }],
        skipped: [{ id: 'web', reason: '웹 조사가 필요 없다' }],
        entryAgentId: 'm2',
        note: '엔진은 claude',
      },
      reusedAgentIds: ['m1'],
    });
  });

  it('편성 없이 답하는 신고는 선택 칸이 없어도 된다', () => {
    expect(validateOrchestraPlan({ intent: 'question', topology: 'none' }, ctx)).toEqual({
      ok: true,
      plan: { intent: 'question', topology: 'none', chosen: [] },
      reusedAgentIds: [],
    });
  });

  it('공백뿐인 note 는 담지 않는다', () => {
    const r = validateOrchestraPlan({ intent: 'question', topology: 'none', note: '   ' }, ctx);
    expect(r.ok && r.plan.note).toBeUndefined();
  });

  it.each<[string, unknown, { error: string; ids?: string[] }]>([
    ['본문이 객체가 아님', [], { error: 'body-not-object' }],
    ['의도가 어긋남', { ...good, intent: 'chat' }, { error: 'invalid-intent' }],
    ['편성이 어긋남', { ...good, topology: 'star' }, { error: 'invalid-topology' }],
    ['chosen 이 배열이 아님', { ...good, chosen: 'subagents' }, { error: 'chosen-not-array' }],
    ['chosen 항목이 객체가 아님', { ...good, chosen: ['subagents'] }, { error: 'chosen-item-not-object' }],
    ['chosen 이유 없음', { ...good, chosen: [{ id: 'output', reason: '  ' }] }, { error: 'chosen-reason-required', ids: ['output'] }],
    [
      'chosen 이유가 너무 김',
      { ...good, chosen: [{ id: 'output', reason: 'x'.repeat(ORCHESTRA_PLAN_REASON_MAX + 1) }] },
      { error: 'chosen-reason-too-long', ids: ['output'] },
    ],
    [
      'chosen 겹침',
      { ...good, chosen: [{ id: 'output', reason: 'a' }, { id: 'output', reason: 'b' }] },
      { error: 'chosen-duplicate', ids: ['output'] },
    ],
    [
      'chosen 모르는 방안 — 모든 틀린 id 를 돌려준다',
      { ...good, chosen: [{ id: 'nope', reason: 'a' }, { id: 'output', reason: 'b' }, { id: 'zip', reason: 'c' }] },
      { error: 'chosen-unknown-strategy', ids: ['nope', 'zip'] },
    ],
    ['skipped 가 배열이 아님', { ...good, skipped: {} }, { error: 'skipped-not-array' }],
    ['skipped 항목이 객체가 아님', { ...good, skipped: [null] }, { error: 'skipped-item-not-object' }],
    ['skipped 이유 없음', { ...good, skipped: [{ id: 'web' }] }, { error: 'skipped-reason-required', ids: ['web'] }],
    [
      'skipped 이유가 너무 김',
      { ...good, skipped: [{ id: 'web', reason: 'x'.repeat(ORCHESTRA_PLAN_REASON_MAX + 1) }] },
      { error: 'skipped-reason-too-long', ids: ['web'] },
    ],
    [
      'skipped 겹침',
      { ...good, skipped: [{ id: 'web', reason: 'a' }, { id: 'web', reason: 'b' }] },
      { error: 'skipped-duplicate', ids: ['web'] },
    ],
    ['skipped 모르는 방안', { ...good, skipped: [{ id: 'zzz', reason: 'a' }] }, { error: 'skipped-unknown-strategy', ids: ['zzz'] }],
    [
      '참고 전용 방안을 고름',
      { ...good, chosen: [{ id: 'reminders', reason: 'a' }, { id: 'preamble', reason: 'b' }] },
      { error: 'strategy-not-allowed', ids: ['reminders', 'preamble'] },
    ],
    [
      '고른 것과 건너뛴 것이 겹침',
      { ...good, chosen: [{ id: 'web', reason: 'a' }], skipped: [{ id: 'web', reason: 'b' }] },
      { error: 'chosen-and-skipped', ids: ['web'] },
    ],
    ['재사용 목록이 문자열 배열이 아님', { ...good, reusedAgentIds: ['m1', 2] }, { error: 'reusedAgentIds-not-string-array' }],
    ['다른 프로젝트 멤버 재사용', { ...good, reusedAgentIds: ['m1', 'x', 'y'] }, { error: 'reused-agent-not-in-project', ids: ['x', 'y'] }],
    ['입구 멤버가 프로젝트 밖', { ...good, entryAgentId: 'x' }, { error: 'entry-agent-not-in-project', ids: ['x'] }],
    ['입구 멤버가 문자열이 아님', { ...good, entryAgentId: 7 }, { error: 'entry-agent-not-in-project', ids: ['7'] }],
    ['note 가 문자열이 아님', { ...good, note: 1 }, { error: 'note-not-string' }],
    ['note 가 너무 김', { ...good, note: 'n'.repeat(ORCHESTRA_PLAN_NOTE_MAX + 1) }, { error: 'note-too-long' }],
  ])('%s', (_label, body, expected) => {
    expect(validateOrchestraPlan(body, ctx)).toEqual({ ok: false, ...expected });
  });

  it('사용자가 꺼 둔 방안을 고르면 그 id 로 실패한다', () => {
    const off: OrchestraPlanContext = { ...ctx, settings: { disabledStrategies: ['subagents'] } };
    expect(validateOrchestraPlan(good, off)).toEqual({ ok: false, error: 'strategy-not-allowed', ids: ['subagents'] });
  });

  it('꺼 둔 방안을 건너뛴 쪽에 적는 것은 막지 않는다', () => {
    const off: OrchestraPlanContext = { ...ctx, settings: { disabledStrategies: ['web'] } };
    expect(validateOrchestraPlan(good, off).ok).toBe(true);
  });
});

describe('orchestraSummaryFingerprint', () => {
  it('없으면 빈 문자열, 런 단계·토큰·설정이 바뀌면 지문도 바뀐다', () => {
    expect(orchestraSummaryFingerprint(undefined)).toBe('');
    const base = { settings: { enabledProject: true, updatedAt: 1 }, runs: [run()] };
    const fp = orchestraSummaryFingerprint(base);
    expect(orchestraSummaryFingerprint({ ...base, runs: [run()] })).toBe(fp);
    expect(orchestraSummaryFingerprint({ ...base, runs: [run({ phase: 'dispatched' })] })).not.toBe(fp);
    expect(orchestraSummaryFingerprint({ ...base, runs: [run({ outputTokens: 3 })] })).not.toBe(fp);
    expect(orchestraSummaryFingerprint({ ...base, runs: [run({ memberAgentIds: ['m'] })] })).not.toBe(fp);
    expect(orchestraSummaryFingerprint({ ...base, settings: { ...base.settings, enabledAgents: { a: false } } })).not.toBe(fp);
    expect(orchestraSummaryFingerprint({ ...base, settings: { ...base.settings, updatedAt: 2 } })).not.toBe(fp);
  });
});
