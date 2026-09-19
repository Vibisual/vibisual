import { describe, it, expect } from 'vitest';
import {
  DEFAULT_AGENT_CONFIG,
  ORCHESTRA_CONDUCTOR_DISALLOWED_TOOLS,
  ORCHESTRA_CONDUCTOR_TOOLS,
  ORCHESTRA_DEFAULT_MAX_MEMBERS,
} from '@vibisual/shared';
import type { AgentConfig, OrchestraRun } from '@vibisual/shared';
import {
  addOrchestraMember,
  addOrchestraRunTokens,
  applyOrchestraPlan,
  buildConductorTurnConfig,
  checkOrchestraKickoff,
  checkOrchestraMemberCreate,
  collectOrchestraMemberIds,
  orchestraEngineOf,
  orchestraMemberProviderAllowed,
  orchestraRunIdForCommand,
  settleConductorTurn,
  shouldInterceptOrchestra,
  type OrchestraInterceptInput,
  type OrchestraKickoffInput,
} from './orchestraRuntime.js';

/**
 * §5.3 #10-4 — 오케스트라 서버 런타임의 순수 판정.
 *
 * 못 박는 계약:
 *  ① 가로채기는 조건을 **전부** 볼 때만이다 — 하나라도 어긋나면 이 기능이 없던 때와 같다.
 *  ② 지휘 턴 설정은 **사본**이다 — 저장된 설정을 건드리지 않고, Claude 는 도구 이름으로·Codex 는
 *     `codexTools.edit = 'deny'` 로 쓰기를 막는다(코덱스는 도구 이름 목록을 읽지 않는다).
 *  ③ 멤버 상한은 이 런이 **새로 만든** 수로 잰다 — 다시 쓴 멤버는 자리를 깎지 않는다.
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

function intercept(partial: Partial<OrchestraInterceptInput> = {}): OrchestraInterceptInput {
  return {
    fromLoopback: false,
    customCreated: true,
    isAutoBubble: false,
    executionMode: undefined,
    engine: 'claude',
    text: '로그인 화면을 고쳐 줘',
    silent: false,
    enabled: true,
    edgeCommand: false,
    ...partial,
  };
}

describe('orchestraEngineOf', () => {
  it('프로바이더가 없으면 Claude, codex-cli 면 Codex, 로컬이면 지휘할 수 없다', () => {
    expect(orchestraEngineOf(undefined)).toBe('claude');
    expect(orchestraEngineOf(null)).toBe('claude');
    expect(orchestraEngineOf({ provider: undefined })).toBe('claude');
    expect(orchestraEngineOf({ provider: { kind: 'codex-cli', modelId: '' } })).toBe('codex');
    expect(orchestraEngineOf({ provider: { kind: 'local-llama', modelId: '' } })).toBeNull();
  });
});

describe('shouldInterceptOrchestra', () => {
  it('조건을 전부 보면 가로챈다', () => {
    expect(shouldInterceptOrchestra(intercept())).toBe(true);
    expect(shouldInterceptOrchestra(intercept({ engine: 'codex', executionMode: 'headless' }))).toBe(true);
  });

  it.each<[string, Partial<OrchestraInterceptInput>]>([
    ['꺼져 있음', { enabled: false }],
    ['loopback 유입(킥오프·자기 호출)', { fromLoopback: true }],
    ['엣지 명령', { edgeCommand: true }],
    ['커스텀 버블이 아님', { customCreated: false }],
    ['Auto Agent 버블', { isAutoBubble: true }],
    ['임베디드 인터랙티브 터미널', { executionMode: 'interactive-terminal' }],
    ['로컬 엔진', { engine: null }],
    ['조용한 내부 명령', { silent: true }],
    ['슬래시 명령', { text: '/compact' }],
    ['앞 공백 뒤 슬래시 명령', { text: '   /clear' }],
    ['빈 본문', { text: '   ' }],
  ])('%s 이면 가로채지 않는다', (_label, partial) => {
    expect(shouldInterceptOrchestra(intercept(partial))).toBe(false);
  });
});

describe('buildConductorTurnConfig — Claude', () => {
  const base: AgentConfig = {
    ...DEFAULT_AGENT_CONFIG,
    model: 'opus',
    modelVersion: 'claude-opus-4-1',
    effort: 'xhigh',
    permissionMode: 'default',
    disallowedTools: ['WebFetch'],
  };

  it('도구를 지휘 도구로 바꾸고, 쓰기 도구를 원래 차단 목록에 더하고, 권한은 기본 bypass', () => {
    const cfg = buildConductorTurnConfig(base, undefined, 'claude');
    expect(cfg.tools).toEqual([...ORCHESTRA_CONDUCTOR_TOOLS]);
    expect(cfg.disallowedTools).toEqual(['WebFetch', ...ORCHESTRA_CONDUCTOR_DISALLOWED_TOOLS]);
    expect(cfg.permissionMode).toBe('bypassPermissions');
    // 모델 칸이 비었으면 에이전트 값 그대로 — 핀도 그대로.
    expect(cfg.model).toBe('opus');
    expect(cfg.modelVersion).toBe('claude-opus-4-1');
    expect(cfg.effort).toBe('xhigh');
  });

  it('저장된 설정을 건드리지 않는다(그 턴의 사본이다)', () => {
    const snapshot = JSON.parse(JSON.stringify(base)) as AgentConfig;
    buildConductorTurnConfig(base, { conductorClaudeModel: 'sonnet', askQuestions: true }, 'claude', new Set(['Bash']));
    expect(base).toEqual(snapshot);
  });

  it('권한 inherit 이면 에이전트 권한 그대로', () => {
    const cfg = buildConductorTurnConfig(base, { conductorPermission: 'inherit' }, 'claude');
    expect(cfg.permissionMode).toBe('default');
  });

  it('AskUserQuestion 은 설정이 켤 때만 더한다', () => {
    expect(buildConductorTurnConfig(base, { askQuestions: false }, 'claude').tools).not.toContain('AskUserQuestion');
    expect(buildConductorTurnConfig(base, { askQuestions: true }, 'claude').tools).toContain('AskUserQuestion');
  });

  it('STRICT 엣지가 빼앗은 도구는 지휘 턴에서도 뺀다', () => {
    const cfg = buildConductorTurnConfig(base, undefined, 'claude', new Set(['Agent', 'Grep']));
    expect(cfg.tools).not.toContain('Agent');
    expect(cfg.tools).not.toContain('Grep');
    expect(cfg.tools).toContain('Bash');
  });

  it('지휘자 모델을 정하면 modelVersion 핀을 뗀다 — 남기면 고른 모델이 무시된다', () => {
    const cfg = buildConductorTurnConfig(base, { conductorClaudeModel: 'sonnet', conductorClaudeEffort: 'medium' }, 'claude');
    expect(cfg.model).toBe('sonnet');
    expect(cfg.modelVersion).toBeUndefined();
    expect(cfg.effort).toBe('medium');
  });

  it('공백뿐인 모델 칸은 정하지 않은 것이다', () => {
    const cfg = buildConductorTurnConfig(base, { conductorClaudeModel: '  ' }, 'claude');
    expect(cfg.model).toBe('opus');
    expect(cfg.modelVersion).toBe('claude-opus-4-1');
  });

  it('Claude 엔진은 provider 를 만들지 않는다', () => {
    expect(buildConductorTurnConfig(base, { conductorCodexModel: 'gpt-5.1-codex' }, 'claude').provider).toBeUndefined();
  });
});

describe('buildConductorTurnConfig — Codex', () => {
  const base: AgentConfig = {
    ...DEFAULT_AGENT_CONFIG,
    provider: { kind: 'codex-cli', modelId: 'gpt-5-codex', codexTools: { shell: 'ask', edit: 'allow' } },
  };

  it("쓰기는 codexTools.edit = 'deny' 로 막고, 나머지 도구 칸은 사용자가 정한 그대로 둔다", () => {
    const cfg = buildConductorTurnConfig(base, undefined, 'codex');
    expect(cfg.provider?.kind).toBe('codex-cli');
    expect(cfg.provider?.codexTools).toEqual({ shell: 'ask', edit: 'deny' });
    expect(cfg.provider?.modelId).toBe('gpt-5-codex');
    // 원본 provider 는 그대로.
    expect(base.provider?.codexTools).toEqual({ shell: 'ask', edit: 'allow' });
  });

  it('codexTools 가 없던 에이전트도 edit 만 막힌다', () => {
    const cfg = buildConductorTurnConfig({ ...base, provider: { kind: 'codex-cli', modelId: '' } }, undefined, 'codex');
    expect(cfg.provider?.codexTools).toEqual({ edit: 'deny' });
  });

  it('지휘자 모델·추론 강도를 정하면 그 턴의 provider 에만 들어간다', () => {
    const cfg = buildConductorTurnConfig(base, { conductorCodexModel: 'gpt-5.1-codex', conductorCodexReasoning: 'high' }, 'codex');
    expect(cfg.provider?.modelId).toBe('gpt-5.1-codex');
    expect(cfg.provider?.reasoningEffort).toBe('high');
    expect(base.provider?.modelId).toBe('gpt-5-codex');
    expect(base.provider?.reasoningEffort).toBeUndefined();
  });

  it('Codex 엔진은 Claude 모델 칸을 읽지 않는다', () => {
    const cfg = buildConductorTurnConfig(base, { conductorClaudeModel: 'haiku' }, 'codex');
    expect(cfg.model).toBe(DEFAULT_AGENT_CONFIG.model);
  });
});

describe('orchestraRunIdForCommand', () => {
  const runs = [
    run({ runId: 'r1', startedAt: 100, memberAgentIds: ['m1'] }),
    run({ runId: 'r2', startedAt: 200, memberAgentIds: ['m1', 'm2'] }),
    run({ runId: 'r3', startedAt: 900, memberAgentIds: ['m1'] }),
  ];

  it('표식이 찍힌 명령은 그 런으로 — 없는 런이면 어디에도 적지 않는다', () => {
    expect(orchestraRunIdForCommand(runs, { orchestraRunId: 'r1', timestamp: 999 }, 'm1')).toBe('r1');
    expect(orchestraRunIdForCommand(runs, { orchestraRunId: 'gone', timestamp: 999 }, 'm1')).toBeNull();
  });

  it('엣지 명령은 그 에이전트를 멤버로 가진 가장 최근 런 — 명령보다 늦게 시작한 런은 빼고', () => {
    expect(orchestraRunIdForCommand(runs, { edgeId: 'e1', timestamp: 500 }, 'm1')).toBe('r2');
    expect(orchestraRunIdForCommand(runs, { edgeId: 'e1', timestamp: 1000 }, 'm1')).toBe('r3');
    expect(orchestraRunIdForCommand(runs, { edgeId: 'e1', timestamp: 500 }, 'm2')).toBe('r2');
    expect(orchestraRunIdForCommand(runs, { edgeId: 'e1', timestamp: 50 }, 'm1')).toBeNull();
  });

  it('사용자가 멤버에게 직접 친 명령은 어느 런에도 적지 않는다', () => {
    expect(orchestraRunIdForCommand(runs, { timestamp: 1000 }, 'm1')).toBeNull();
    expect(orchestraRunIdForCommand(runs, { edgeId: 'e1', timestamp: 1000 }, null)).toBeNull();
  });
});

describe('addOrchestraRunTokens', () => {
  it('0 이면 같은 객체(저장 표식을 올리지 않게), 아니면 더한다', () => {
    const r = run({ inputTokens: 10, outputTokens: 5 });
    expect(addOrchestraRunTokens(r, 0, 0)).toBe(r);
    expect(addOrchestraRunTokens(r, -3, Number.NaN)).toBe(r);
    const next = addOrchestraRunTokens(r, 100, 20.4);
    expect(next).not.toBe(r);
    expect(next.inputTokens).toBe(110);
    expect(next.outputTokens).toBe(25);
    expect(r.inputTokens).toBe(10);
  });
});

describe('settleConductorTurn', () => {
  it('이 런의 지휘 명령이 아니면 같은 객체', () => {
    const r = run();
    expect(settleConductorTurn(r, { id: 'cmd-other', status: 'completed' }, 5000)).toBe(r);
  });

  it('신고 없이 끝난 지휘 턴은 unreported — 조용히 성공으로 그리지 않는다', () => {
    const next = settleConductorTurn(run(), { id: 'cmd-1', status: 'completed' }, 5000);
    expect(next.phase).toBe('unreported');
    expect(next.endedAt).toBe(5000);
  });

  it('실패한 지휘 턴은 error', () => {
    expect(settleConductorTurn(run(), { id: 'cmd-1', status: 'error' }, 5000).phase).toBe('error');
  });

  it('이미 신고한 런은 단계를 두고 끝난 시각만 채운다(한 번만)', () => {
    const dispatched = settleConductorTurn(run({ phase: 'dispatched', planAt: 3000 }), { id: 'cmd-1', status: 'completed' }, 5000);
    expect(dispatched.phase).toBe('dispatched');
    expect(dispatched.endedAt).toBe(5000);
    expect(settleConductorTurn(dispatched, { id: 'cmd-1', status: 'completed' }, 9000)).toBe(dispatched);
    const answered = settleConductorTurn(run({ phase: 'answered' }), { id: 'cmd-1', status: 'error' }, 5000);
    expect(answered.phase).toBe('answered');
  });
});

describe('collectOrchestraMemberIds', () => {
  it('이 지휘자가 쓴 멤버를 최근 것부터 겹침 없이 — 다른 지휘자의 멤버·지휘자 자신은 빼고', () => {
    const runs = [
      run({ runId: 'r1', memberAgentIds: ['a', 'b'] }),
      run({ runId: 'r2', agentId: 'other', memberAgentIds: ['x'] }),
      run({ runId: 'r3', memberAgentIds: ['c', 'a', 'conductor'] }),
    ];
    expect(collectOrchestraMemberIds(runs, 'conductor')).toEqual(['a', 'c', 'b']);
    expect(collectOrchestraMemberIds(runs, 'nobody')).toEqual([]);
  });
});

describe('addOrchestraMember', () => {
  it('새로 만든 멤버는 목록에 더하고 만든 수를 올린다', () => {
    const next = addOrchestraMember(run(), 'm1', true);
    expect(next.memberAgentIds).toEqual(['m1']);
    expect(next.createdMemberCount).toBe(1);
  });

  it('이미 있는 멤버를 다시 쓰면 같은 객체 — 자리를 깎지 않는다', () => {
    const r = run({ memberAgentIds: ['m1'], createdMemberCount: 1 });
    expect(addOrchestraMember(r, 'm1', false)).toBe(r);
  });

  it('다시 쓰는 멤버를 처음 더하면 목록에만 들어가고 만든 수는 그대로', () => {
    const next = addOrchestraMember(run({ createdMemberCount: 2 }), 'm9', false);
    expect(next.memberAgentIds).toEqual(['m9']);
    expect(next.createdMemberCount).toBe(2);
  });
});

describe('checkOrchestraKickoff', () => {
  const ok: OrchestraKickoffInput = { fromLoopback: true, targetAgentId: 'm1', targetCustomCreated: true, sameProject: true };

  it('지휘 중·편성 뒤 런의 같은 프로젝트 멤버에게는 넘긴다', () => {
    expect(checkOrchestraKickoff(run(), ok)).toEqual({ ok: true });
    expect(checkOrchestraKickoff(run({ phase: 'dispatched' }), ok)).toEqual({ ok: true });
  });

  it.each<[string, OrchestraRun | undefined, Partial<typeof ok>, number, string]>([
    ['loopback 이 아님', run(), { fromLoopback: false }, 403, 'orchestra-kickoff-loopback-only'],
    ['없는 런', undefined, {}, 404, 'orchestra-run-not-found'],
    ['끝난 런', run({ phase: 'unreported' }), {}, 409, 'orchestra-run-settled'],
    ['답만 한 런', run({ phase: 'answered' }), {}, 409, 'orchestra-run-settled'],
    ['대상 없음', run(), { targetAgentId: null }, 400, 'orchestra-kickoff-target'],
    ['커스텀이 아닌 대상', run(), { targetCustomCreated: false }, 400, 'orchestra-kickoff-target'],
    ['지휘자 자신', run(), { targetAgentId: 'conductor' }, 400, 'orchestra-kickoff-conductor'],
    ['다른 프로젝트', run(), { sameProject: false }, 400, 'orchestra-project-mismatch'],
  ])('%s → %i %s', (_label, r, partial, status, error) => {
    expect(checkOrchestraKickoff(r, { ...ok, ...partial })).toEqual({ ok: false, status, error });
  });
});

describe('orchestraMemberProviderAllowed', () => {
  it('멤버 엔진 설정과 프로바이더가 맞아야 한다 — 로컬은 어디에도 맞지 않는다', () => {
    expect(orchestraMemberProviderAllowed(undefined, undefined)).toBe(true);
    expect(orchestraMemberProviderAllowed(undefined, 'codex-cli')).toBe(false);
    expect(orchestraMemberProviderAllowed({ memberEngine: 'codex' }, 'codex-cli')).toBe(true);
    expect(orchestraMemberProviderAllowed({ memberEngine: 'codex' }, undefined)).toBe(false);
    expect(orchestraMemberProviderAllowed({ memberEngine: 'auto' }, undefined)).toBe(true);
    expect(orchestraMemberProviderAllowed({ memberEngine: 'auto' }, 'codex-cli')).toBe(true);
    for (const engine of ['claude', 'codex', 'auto'] as const) {
      expect(orchestraMemberProviderAllowed({ memberEngine: engine }, 'local-llama')).toBe(false);
    }
  });
});

describe('checkOrchestraMemberCreate', () => {
  const ok = { sameProject: true, providerKind: undefined };

  it('지휘 중인 런의 같은 프로젝트에 설정 엔진으로 만들 때만', () => {
    expect(checkOrchestraMemberCreate(run(), undefined, ok)).toEqual({ ok: true });
    expect(checkOrchestraMemberCreate(undefined, undefined, ok)).toMatchObject({ ok: false, status: 404 });
    expect(checkOrchestraMemberCreate(run({ phase: 'dispatched' }), undefined, ok)).toMatchObject({ ok: false, status: 409, error: 'orchestra-run-settled' });
    expect(checkOrchestraMemberCreate(run(), undefined, { ...ok, sameProject: false })).toMatchObject({ ok: false, status: 400, error: 'orchestra-project-mismatch' });
    expect(checkOrchestraMemberCreate(run(), undefined, { ...ok, providerKind: 'codex-cli' })).toMatchObject({ ok: false, status: 400, error: 'orchestra-member-engine' });
  });

  it('상한은 새로 만든 수로 잰다 — 429 에 상한과 지금 수를 싣는다', () => {
    const full = run({ createdMemberCount: ORCHESTRA_DEFAULT_MAX_MEMBERS, memberAgentIds: ['a'] });
    expect(checkOrchestraMemberCreate(full, undefined, ok)).toEqual({
      ok: false,
      status: 429,
      error: 'orchestra-member-limit',
      limit: ORCHESTRA_DEFAULT_MAX_MEMBERS,
      current: ORCHESTRA_DEFAULT_MAX_MEMBERS,
    });
    // 다시 쓴 멤버가 많아도(목록만 길다) 새로 만든 수가 상한 아래면 만든다.
    const reusedMany = run({ createdMemberCount: 1, memberAgentIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] });
    expect(checkOrchestraMemberCreate(reusedMany, undefined, ok)).toEqual({ ok: true });
    expect(checkOrchestraMemberCreate(run({ createdMemberCount: 2 }), { maxMembers: 2 }, ok)).toMatchObject({ status: 429, limit: 2, current: 2 });
  });
});

describe('applyOrchestraPlan', () => {
  it('편성이 있으면 dispatched, 편성 없음이면 answered — 다시 쓴 멤버를 목록에 더한다(지휘자 자신은 빼고)', () => {
    const r = run({ memberAgentIds: ['new1'] });
    const plan = { intent: 'feature' as const, topology: 'pipeline' as const, chosen: [{ id: 'subagents' as const, reason: 'r' }] };
    const next = applyOrchestraPlan(r, plan, ['old1', 'new1', 'conductor'], 7000);
    expect(next.phase).toBe('dispatched');
    expect(next.planAt).toBe(7000);
    expect(next.plan).toEqual(plan);
    expect(next.memberAgentIds).toEqual(['new1', 'old1']);
    expect(r.memberAgentIds).toEqual(['new1']);

    const answered = applyOrchestraPlan(run(), { intent: 'question', topology: 'none', chosen: [] }, [], 7000);
    expect(answered.phase).toBe('answered');
  });
});
