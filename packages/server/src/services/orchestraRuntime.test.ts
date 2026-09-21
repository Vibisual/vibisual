import { describe, it, expect } from 'vitest';
import {
  DEFAULT_AGENT_CONFIG,
  ORCHESTRA_CONDUCTOR_DISALLOWED_TOOLS,
  ORCHESTRA_CONDUCTOR_TOOLS,
  ORCHESTRA_DEFAULT_MAX_MEMBERS,
} from '@vibisual/shared';
import type { AgentConfig, OrchestraPlan, OrchestraRun, TaskEdge, TurnStopReason } from '@vibisual/shared';
import {
  addOrchestraMember,
  addOrchestraRunTokens,
  applyOrchestraPlan,
  buildConductorTurnConfig,
  checkOrchestraKickoff,
  checkOrchestraMemberCreate,
  checkOrchestraPlanGraph,
  collectOrchestraMemberIds,
  orchestraEngineOf,
  orchestraMemberProviderAllowed,
  orchestraRunIdForCommand,
  settleConductorTurn,
  shouldInterceptOrchestra,
  type OrchestraInterceptInput,
  type OrchestraKickoffInput,
  type OrchestraDispatchEvidence,
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

function plan(partial: Partial<OrchestraPlan> = {}): OrchestraPlan {
  return { intent: 'feature', topology: 'pipeline', chosen: [], entryAgentId: 'architect', ...partial };
}

function dispatch(partial: Partial<OrchestraDispatchEvidence> = {}): OrchestraDispatchEvidence {
  return {
    sourceAgentId: 'conductor',
    targetAgentId: 'architect',
    requesterSubAgentId: 'conductor-session',
    createdAt: 2000,
    status: 'completed',
    deliveredAt: 4000,
    ...partial,
  };
}

function edge(
  sourceAgentId: string,
  targetAgentId: string,
  partial: Partial<Pick<TaskEdge, 'kind' | 'bundleRole'>> = {},
): Pick<TaskEdge, 'sourceAgentId' | 'targetAgentId' | 'kind' | 'bundleRole'> {
  return { sourceAgentId, targetAgentId, kind: 'command', bundleRole: 'primary', ...partial };
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
  const completed = { id: 'cmd-1', status: 'completed' as const, subAgentId: 'conductor-session' };

  it('이 런의 지휘 명령이 아니면 같은 객체', () => {
    const r = run();
    expect(settleConductorTurn(r, { id: 'cmd-other', status: 'completed' }, 5000)).toBe(r);
  });

  it('신고 없이 끝난 지휘 턴은 unreported — 조용히 성공으로 그리지 않는다', () => {
    const next = settleConductorTurn(run(), { id: 'cmd-1', status: 'completed' }, 5000);
    expect(next.phase).toBe('unreported');
    expect(next.endedAt).toBe(5000);
  });

  it.each(['queued', 'executing'] as const)('지휘 턴이 아직 %s 면 정산하지 않는다', (status) => {
    const r = run({ phase: 'dispatched', plan: plan() });
    expect(settleConductorTurn(r, { ...completed, status }, 5000, [dispatch()])).toBe(r);
  });

  it.each(['conducting', 'dispatched', 'answered'] as const)('계획 단계가 %s 여도 지휘 턴 실패는 error', (phase) => {
    const next = settleConductorTurn(run({ phase, plan: plan() }), { ...completed, status: 'error' }, 5000, [dispatch()]);
    expect(next.phase).toBe('error');
    expect(next.endedAt).toBe(5000);
  });

  it('편성 없는 직접 답은 위임 증거 없이 answered로 닫는다', () => {
    expect(settleConductorTurn(run({ phase: 'answered', plan: plan({ topology: 'none', entryAgentId: undefined }) }), completed, 5000))
      .toMatchObject({ phase: 'answered', endedAt: 5000 });
  });

  it('같은 지휘 세션의 이번 엔트리 결과를 모두 성공적으로 받았을 때만 completed', () => {
    const r = run({ phase: 'dispatched', plan: plan(), planAt: 1500 });
    const next = settleConductorTurn(r, completed, 5000, [dispatch(), dispatch({ targetAgentId: 'verifier' })]);
    expect(next.phase).toBe('completed');
    expect(next.endedAt).toBe(5000);
    expect(r.phase).toBe('dispatched');
    expect(r.endedAt).toBeUndefined();
  });

  it('장부가 없거나 엔트리 위임이 없으면 신고만으로 성공하지 않는다', () => {
    const r = run({ phase: 'dispatched', plan: plan() });
    expect(settleConductorTurn(r, completed, 5000).phase).toBe('error');
    expect(settleConductorTurn(r, completed, 5000, []).phase).toBe('error');
    expect(settleConductorTurn(r, completed, 5000, [dispatch({ targetAgentId: 'verifier' })]).phase).toBe('error');
    expect(settleConductorTurn(run({ phase: 'dispatched' }), completed, 5000, [dispatch()]).phase).toBe('error');
  });

  it.each<[string, Partial<OrchestraDispatchEvidence>]>([
    ['대기 중', { status: 'queued', deliveredAt: undefined }],
    ['실행 중', { status: 'executing', deliveredAt: undefined }],
    ['결과를 받지 못함', { deliveredAt: undefined }],
    ['실패 결과를 받음', { status: 'error' }],
    ['취소 결과를 받음', { status: 'cancelled' }],
    ['취소 요청 중', { cancelRequestedAt: 3000 }],
    ['사용 한도에 멈춤', { usageLimit: { kind: 'usage', at: 3000 } }],
  ])('%s인 위임이 하나라도 있으면 엔트리 성공만으로 완료하지 않는다', (_label, partial) => {
    const r = run({ phase: 'dispatched', plan: plan() });
    expect(settleConductorTurn(r, completed, 5000, [dispatch(partial)]).phase).toBe('error');
    expect(settleConductorTurn(r, completed, 5000, [dispatch(), dispatch({ ...partial, targetAgentId: 'verifier' })]).phase).toBe('error');
  });

  it.each<[string, Partial<OrchestraDispatchEvidence>]>([
    ['다른 감독', { sourceAgentId: 'other-conductor' }],
    ['다른 세션', { requesterSubAgentId: 'other-session' }],
    ['요청 세션 미상', { requesterSubAgentId: undefined }],
    ['이전 런', { createdAt: 999 }],
  ])('%s의 작업은 이번 런의 성공 근거도 실패 근거도 아니다', (_label, partial) => {
    const r = run({ phase: 'dispatched', plan: plan() });
    expect(settleConductorTurn(r, completed, 5000, [dispatch(partial)]).phase).toBe('error');
    expect(settleConductorTurn(r, completed, 5000, [dispatch(), dispatch({ ...partial, status: 'error' })]).phase).toBe('completed');
  });

  it('지휘 명령의 세션 id를 모르면 주인 미상 장부와 맞춰 성공하지 않는다', () => {
    const r = run({ phase: 'dispatched', plan: plan() });
    expect(settleConductorTurn(r, { ...completed, subAgentId: null }, 5000, [dispatch()]).phase).toBe('error');
    expect(settleConductorTurn(r, { id: 'cmd-1', status: 'completed' }, 5000, [dispatch({ requesterSubAgentId: undefined })]).phase).toBe('error');
  });

  it.each<Exclude<TurnStopReason, 'end_turn'>>(['cancelled', 'usage_limit', 'max_tokens', 'max_turns', 'refusal'])
  ('감독이 %s로 끊기면 명령 상태가 completed여도 런은 error', (stopReason) => {
    expect(settleConductorTurn(run({ phase: 'dispatched', plan: plan() }), { ...completed, stopReason }, 5000, [dispatch()]).phase).toBe('error');
  });

  it('옛 중지 결과 표식도 성공으로 처리하지 않는다', () => {
    expect(settleConductorTurn(run({ phase: 'answered' }), { ...completed, result: '[Stopped by user] interrupted' }, 5000).phase).toBe('error');
  });

  it('같은 완료 콜백 재시도와 뒤늦은 결과는 첫 정산을 뒤집지 않는다', () => {
    const r = run({ phase: 'dispatched', plan: plan() });
    const succeeded = settleConductorTurn(r, { ...completed, stopReason: 'end_turn' }, 5000, [dispatch({ createdAt: 1000 })]);
    expect(succeeded.phase).toBe('completed');
    expect(settleConductorTurn(succeeded, completed, 9000)).toBe(succeeded);
    expect(settleConductorTurn(succeeded, { ...completed, status: 'error' }, 9000)).toBe(succeeded);
    const failed = settleConductorTurn(r, completed, 5000);
    expect(settleConductorTurn(failed, completed, 9000, [dispatch()])).toBe(failed);
  });
});

describe('checkOrchestraPlanGraph', () => {
  it('편성 없는 직접 답은 그래프가 필요 없다', () => {
    expect(checkOrchestraPlanGraph(run(), plan({ topology: 'none', entryAgentId: undefined }), [], [])).toEqual({ ok: true });
  });

  it('편성에는 감독 자신이 아닌 엔트리가 있어야 한다', () => {
    expect(checkOrchestraPlanGraph(run(), plan({ entryAgentId: undefined }), [], []))
      .toEqual({ ok: false, status: 400, error: 'orchestra-entry-required' });
    expect(checkOrchestraPlanGraph(run(), plan({ entryAgentId: 'conductor' }), [], []))
      .toEqual({ ok: false, status: 400, error: 'orchestra-entry-conductor' });
  });

  it('엔트리만 재사용하는 single은 별도 reusedAgentIds 없이 통과한다', () => {
    expect(checkOrchestraPlanGraph(run(), plan({ topology: 'single' }), [], [])).toEqual({ ok: true });
  });

  it('pipeline 지시 방향과 작업자 완료의 critique 콜백으로 모든 멤버에 닿는다', () => {
    const r = run({ memberAgentIds: ['architect', 'coder', 'verifier'] });
    expect(checkOrchestraPlanGraph(r, plan(), [], [edge('architect', 'coder'), edge('verifier', 'coder', { kind: 'critique' })]))
      .toEqual({ ok: true });
  });

  it('parallel 허브의 여러 위임과 오래된 bundleRole 없는 command도 연결로 센다', () => {
    expect(checkOrchestraPlanGraph(run(), plan({ topology: 'parallel' }), ['worker-a', 'worker-b'], [
      edge('architect', 'worker-a', { kind: undefined, bundleRole: undefined }), edge('architect', 'worker-b'),
    ])).toEqual({ ok: true });
  });

  it('만들기만 한 멤버와 재사용 신고한 멤버의 고립을 모두 거절한다', () => {
    expect(checkOrchestraPlanGraph(run({ memberAgentIds: ['coder', 'orphan-new'] }), plan(), ['orphan-old', 'orphan-new'], [edge('architect', 'coder')]))
      .toEqual({ ok: false, status: 400, error: 'orchestra-plan-disconnected', ids: ['orphan-new', 'orphan-old'] });
  });

  it('지시 방향이 뒤집히면 선이 그려져 있어도 실행 경로로 보지 않는다', () => {
    expect(checkOrchestraPlanGraph(run({ memberAgentIds: ['coder'] }), plan(), [], [edge('coder', 'architect')]))
      .toMatchObject({ ok: false, error: 'orchestra-plan-disconnected', ids: ['coder'] });
  });

  it.each<Partial<Pick<TaskEdge, 'kind' | 'bundleRole'>>>([
    { kind: 'artifact' }, { kind: 'request' }, { bundleRole: 'auto-artifact' }, { bundleRole: 'auto-rework' },
  ])('반환·요청·자동 자매 엣지만 있는 멤버를 실행 연결로 인정하지 않는다 (%j)', (partial) => {
    expect(checkOrchestraPlanGraph(run({ memberAgentIds: ['coder'] }), plan(), [], [edge('architect', 'coder', partial)]))
      .toMatchObject({ ok: false, ids: ['coder'] });
  });

  it.each(['conductor', 'unregistered'])('참가하지 않는 %s를 우회하는 연결은 무효다', (via) => {
    expect(checkOrchestraPlanGraph(run({ memberAgentIds: ['coder'] }), plan(), [], [edge('architect', via), edge(via, 'coder')]))
      .toMatchObject({ ok: false, ids: ['coder'] });
  });

  it('순환 연결은 한 번씩만 방문하고 입력을 바꾸지 않는다', () => {
    const r = run({ memberAgentIds: ['coder', 'verifier'] });
    const reused = ['coder'];
    const edges = [edge('architect', 'coder'), edge('coder', 'verifier'), edge('verifier', 'architect')];
    expect(checkOrchestraPlanGraph(r, plan(), reused, edges)).toEqual({ ok: true });
    expect(r.memberAgentIds).toEqual(['coder', 'verifier']);
    expect(reused).toEqual(['coder']);
    expect(edges).toHaveLength(3);
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
  it('reusedAgentIds를 생략한 엔트리도 런 멤버로 등록하고 중복으로 추가하지 않는다', () => {
    const r = run({ memberAgentIds: ['coder'], createdMemberCount: 1 });
    expect(applyOrchestraPlan(r, plan(), [], 7000)).toMatchObject({ memberAgentIds: ['coder', 'architect'], createdMemberCount: 1 });
    expect(applyOrchestraPlan(r, plan(), ['architect', 'conductor'], 7000).memberAgentIds).toEqual(['coder', 'architect']);
    expect(r.memberAgentIds).toEqual(['coder']);
  });

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
