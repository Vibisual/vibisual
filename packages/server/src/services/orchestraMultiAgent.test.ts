import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  HARNESS_INTENT_GATE_ROWS,
  HARNESS_INTENT_GATE_ROWS_DEPENDENCY,
  TASK_EDGE_TEMPLATES,
  appendOrchestraHop,
  applyOrchestraSettingsPatch,
  buildHarnessBuilderRules,
  buildOrchestraConductorRuleParts,
  buildOrchestraConductorRules,
  buildOrchestraConductorRulesSplit,
  goalStepVerification,
  isOrchestraRunVerified,
  normalizeOrchestraRun,
  normalizeOrchestraSettings,
  orchestraHopRole,
  orchestraRulePartText,
  orchestraScorecard,
  orchestraSuggestions,
  orchestraTokenSplit,
  validateOrchestraPlan,
} from '@vibisual/shared';
import type { OrchestraConductorRulesArgs, OrchestraRun, OrchestraSettings, QueuedCommand, TaskEdge, VerificationRun } from '@vibisual/shared';
import {
  addOrchestraRunHop,
  applyOrchestraPlan,
  buildOrchestraHop,
  checkOrchestraPlanGraph,
  orchestraMemberProviderAllowed,
  recordOrchestraVerification,
  settleConductorTurn,
  settleSelfCommand,
  shouldEnqueueSelfCommand,
} from './orchestraRuntime.js';
import { ensureOrchestraReviewEdge, orchestraCritiqueFirings } from './orchestraDispatch.js';
import { runOrchestraFormation, validateFormationBody, type FormationCall } from './orchestraFormation.js';
import { buildMemberSkillMarkdown, exportMemberSkill, orchestraSkillSlug } from './orchestraSkillExport.js';

/**
 * §5.3 #10-6 — 멀티에이전트 점검. ① 스위치 넷이 꺼져 있으면 규칙·흐름이 종전과 같다 ② 조각을 이으면 전문이다
 * ③ 직접 하기는 지휘 턴 뒤 같은 세션에 다시 넣고 그 명령이 끝나야 닫힌다 ④ 확인됨은 exitCode 0 증거가 있을 때만
 * ⑤ 파생값(사슬·성적표·제안)은 런에서만 짓는다 ⑥ 한 번에 등록은 기존 경로를 차례로 부르고 이름표를 푼다.
 */

function args(partial: Partial<OrchestraConductorRulesArgs> = {}): OrchestraConductorRulesArgs {
  return {
    serverBase: 'http://127.0.0.1:5555',
    projectName: 'demo',
    runId: 'orc-test-1',
    conductorAgentId: 'conductor-1',
    conductorSubAgentId: 'conductor-sub-1',
    centerX: 100,
    centerY: 200,
    settings: {},
    existingMembers: [],
    existingEdges: [],
    conductorEngine: 'claude',
    platform: 'linux',
    ...partial,
  };
}

function run(partial: Partial<OrchestraRun> = {}): OrchestraRun {
  return {
    runId: 'orc-1', projectPath: '/p', agentId: 'cond', commandId: 'cmd-c', userRequest: 'do it',
    engine: 'claude', phase: 'conducting', startedAt: 1000, memberAgentIds: [], inputTokens: 0, outputTokens: 0,
    ...partial,
  };
}

const ALL_ON: OrchestraSettings = { allowSelf: true, crossEngineReview: true, formationBasis: 'dependency', splitRules: true };

describe('지휘 규칙 — 조각과 스위치', () => {
  it('조각을 차례로 이으면 전문과 글자까지 같다(모든 조합·두 셸)', () => {
    for (const settings of [{}, ALL_ON, { allowSelf: true }, { formationBasis: 'dependency' as const }]) {
      for (const [engine, platform] of [['claude', 'linux'], ['codex', 'win32'], ['codex', 'darwin']] as const) {
        const a = args({ settings, conductorEngine: engine, platform });
        const parts = buildOrchestraConductorRuleParts(a);
        expect(parts.flatMap((s) => s.lines).join('\n')).toBe(buildOrchestraConductorRules(a));
        // 조각마다 전문의 같은 글자다(나눠 싣기가 글을 다시 쓰지 않는다).
        const full = buildOrchestraConductorRules(a);
        for (const s of parts) expect(full.includes(s.lines.join('\n'))).toBe(true);
      }
    }
  });

  it('스위치를 다 끄면 새 길의 글이 하나도 없다', () => {
    const full = buildOrchestraConductorRules(args());
    expect(full).not.toContain('`self`');
    expect(full).not.toContain('검수는 다른 엔진');
    expect(full).not.toContain('편성 기준: 의존성');
    expect(full).not.toContain('maker-to-artifact-review');
    expect(full).not.toContain('research-short-return');
    for (const row of HARNESS_INTENT_GATE_ROWS) expect(full).toContain(row.shape);
    for (const row of HARNESS_INTENT_GATE_ROWS_DEPENDENCY) expect(full).not.toContain(row.shape);
  });

  it('2단계 문장은 켠 런 모두에 실린다(마무리 확인·원문 전달·공유 약속문·검증 조항·나눈 근거)', () => {
    const full = buildOrchestraConductorRules(args());
    expect(full).toContain('git diff --stat');
    expect(full).toContain('하위 위임에도 사용자 원문 요청을 함께 넘긴다');
    expect(full).toContain('같은 공유 약속문');
    expect(full).toContain('`decisions`');
    expect(full).toContain('잘못된 입력 시험');
    expect(full).toContain('`splitBasis`');
    expect(full).toContain('나누기 전에');
  });

  it('Codex 멤버가 있으면 하위 에이전트 줄이 실린다', () => {
    expect(buildOrchestraConductorRules(args({ settings: { memberEngine: 'codex' } }))).toContain('`subagentDepth` 도 Codex 에는 먹지 않는다');
    expect(buildOrchestraConductorRules(args({ settings: { memberEngine: 'claude' } }))).not.toContain('`subagentDepth` 도 Codex 에는');
  });

  it('직접 하기·다른 엔진 검수·의존성 기준은 켰을 때만 실린다', () => {
    const on = buildOrchestraConductorRules(args({ settings: ALL_ON, readyEngines: ['claude', 'codex'] }));
    expect(on).toContain('`self` — 나누지 않고');
    expect(on).toContain('검수는 다른 엔진(사용자 설정)');
    expect(on).toContain('**Codex**');
    expect(on).toContain('편성 기준: 의존성');
    expect(on).toContain('maker-to-artifact-review');
    expect(on).toContain('research-short-return');
    for (const row of HARNESS_INTENT_GATE_ROWS_DEPENDENCY) expect(on).toContain(row.shape);
  });

  it('다른 엔진이 준비되지 않았으면 그렇다고 말하고 같은 엔진으로 둔다', () => {
    const text = buildOrchestraConductorRules(args({ settings: { crossEngineReview: true }, readyEngines: ['claude'] }));
    expect(text).toContain('지금 준비되지 않았다');
  });

  it('나눠 싣기 — 절차 코드는 빠지고 읽는 법(셸 두 벌)과 한 번에 등록이 선다', () => {
    const posix = buildOrchestraConductorRulesSplit(args({ settings: { splitRules: true } }));
    const full = buildOrchestraConductorRules(args({ settings: { splitRules: true } }));
    expect(posix.length).toBeLessThan(full.length / 2);
    expect(posix).not.toContain('### ① 멤버 만들기');
    expect(posix).toContain('/api/orchestra/runs/orc-test-1/rules?part=procedure');
    expect(posix).toContain('/api/orchestra/runs/orc-test-1/formation');
    expect(posix).toContain('```bash');
    const ps = buildOrchestraConductorRulesSplit(args({ settings: { splitRules: true }, conductorEngine: 'codex', platform: 'win32' }));
    expect(ps).toContain('```powershell');
    expect(ps).toContain('Send Get "$B/api/orchestra/runs/orc-test-1/rules?part=procedure"');
    expect(ps).not.toContain('```bash');
  });

  it('GET 조각 = 전문의 절차·분석 조각', () => {
    const parts = buildOrchestraConductorRuleParts(args());
    const proc = orchestraRulePartText(parts, 'procedure');
    expect(proc).toContain('### ① 멤버 만들기');
    expect(proc).toContain('### ⑥ 결과 회수');
    expect(proc).toContain('### 칸 설명 (Claude 멤버 기준)');
    expect(orchestraRulePartText(parts, 'analysis')).toContain('## 지난 분석 원문');
  });

  it('Auto Agent 빌더 — 역할형이면 종전 글자, 의존성이면 verifier·새 표', () => {
    const base = { serverBase: 'http://127.0.0.1:1', serverToken: 'x', centerX: 0, centerY: 0, projectName: null };
    const role = buildHarnessBuilderRules(base);
    expect(role).toBe(buildHarnessBuilderRules({ ...base, formationBasis: 'role' }));
    expect(role).not.toContain('| verifier |');
    const dep = buildHarnessBuilderRules({ ...base, formationBasis: 'dependency' });
    expect(dep).toContain('| verifier |');
    expect(dep).toContain(HARNESS_INTENT_GATE_ROWS_DEPENDENCY[0]!.shape);
  });

  it('새 엣지 프리셋 둘은 끝에 붙고 종전 프리셋은 그대로다', () => {
    const ids = TASK_EDGE_TEMPLATES.map((t) => t.id);
    expect(ids.slice(0, 5)).toEqual(['explore-to-architect', 'architect-to-implementer', 'implementer-to-verifier', 'verifier-to-implementer', 'generic']);
    expect(ids.slice(5)).toEqual(['maker-to-artifact-review', 'research-short-return']);
    expect(TASK_EDGE_TEMPLATES.filter((t) => t.formationBasis === 'dependency').every((t) => !!t.defaultMessageSchema)).toBe(true);
  });
});

describe('설정·계획 신고 계약', () => {
  it('새 스위치는 켬만 남고, patch 의 false·null 은 칸을 지운다', () => {
    expect(normalizeOrchestraSettings({ allowSelf: true, crossEngineReview: false, splitRules: 'yes', formationBasis: 'dependency' }))
      .toEqual({ allowSelf: true, formationBasis: 'dependency' });
    const on = applyOrchestraSettingsPatch({}, { allowSelf: true, formationBasis: 'dependency' }, 5);
    expect(on.ok && on.settings).toEqual({ allowSelf: true, formationBasis: 'dependency', updatedAt: 5 });
    const off = applyOrchestraSettingsPatch({ allowSelf: true, formationBasis: 'dependency' }, { allowSelf: false, formationBasis: 'role' }, 6);
    expect(off.ok && off.settings).toEqual({ updatedAt: 6 });
    expect(applyOrchestraSettingsPatch({}, { splitRules: 'on' }, 7)).toEqual({ ok: false, field: 'splitRules' });
  });

  const ctx = (settings: OrchestraSettings = {}) => ({ settings, projectAgentIds: new Set(['m1', 'rev']) });

  it('self 는 [직접 하기 허용]을 켰을 때만 받는다', () => {
    expect(validateOrchestraPlan({ intent: 'feature', topology: 'self', chosen: [] }, ctx())).toEqual({ ok: false, error: 'topology-not-allowed' });
    const ok = validateOrchestraPlan({ intent: 'feature', topology: 'self', chosen: [], reviewAgentId: 'rev' }, ctx({ allowSelf: true }));
    expect(ok.ok && ok.plan.reviewAgentId).toBe('rev');
  });

  it('검수자는 self 에서만, 프로젝트 소속이어야 한다', () => {
    expect(validateOrchestraPlan({ intent: 'feature', topology: 'single', chosen: [], entryAgentId: 'm1', reviewAgentId: 'rev' }, ctx({ allowSelf: true })))
      .toEqual({ ok: false, error: 'reviewAgentId-self-only' });
    expect(validateOrchestraPlan({ intent: 'feature', topology: 'self', chosen: [], reviewAgentId: 'ghost' }, ctx({ allowSelf: true })))
      .toEqual({ ok: false, error: 'review-agent-not-in-project', ids: ['ghost'] });
  });

  it('나눈 근거는 선택 — 비어도 받고, 넘치면 400', () => {
    const empty = validateOrchestraPlan({ intent: 'research', topology: 'none', chosen: [] }, ctx());
    expect(empty.ok && empty.plan.splitBasis).toBeUndefined();
    const filled = validateOrchestraPlan({ intent: 'research', topology: 'none', chosen: [], splitBasis: ' 독립 질문 셋 ' }, ctx());
    expect(filled.ok && filled.plan.splitBasis).toBe('독립 질문 셋');
    expect(validateOrchestraPlan({ intent: 'research', topology: 'none', chosen: [], splitBasis: 'x'.repeat(301) }, ctx()))
      .toEqual({ ok: false, error: 'splitBasis-too-long' });
  });

  it('런의 사슬·판정·직접 하기 칸이 체크포인트 왕복을 견디고, 어긋난 줄은 버린다', () => {
    const r = normalizeOrchestraRun({
      ...run(),
      selfCommandId: 'cmd-s',
      verification: { verdict: 'approve', passed: 2, failed: 0, at: 9 },
      hops: [
        { commandId: 'c1', agentId: 'a', role: 'member', instruction: 'x'.repeat(500), status: 'completed', inputTokens: 3, outputTokens: 4, queuedAt: 1, endedAt: 2 },
        { commandId: 'c2', agentId: 'a', role: 'nope', instruction: '', status: 'completed', inputTokens: 0, outputTokens: 0, queuedAt: 1, endedAt: 2 },
      ],
    });
    expect(r?.selfCommandId).toBe('cmd-s');
    expect(r && isOrchestraRunVerified(r)).toBe(true);
    expect(r?.hops).toHaveLength(1);
    expect(r?.hops?.[0]!.instruction.length).toBeLessThanOrEqual(241);
  });
});

describe('직접 하기(self) 정산', () => {
  const selfPlan = { intent: 'feature' as const, topology: 'self' as const, chosen: [] };

  it('지휘 턴이 정상으로 끝나도 닫지 않고, 다시 넣을 차례라고 답한다', () => {
    const r = run({ phase: 'dispatched', plan: selfPlan, planAt: 1100 });
    const cmd = { id: 'cmd-c', status: 'completed' as const, subAgentId: 'sub' };
    const settled = settleConductorTurn(r, cmd, 2000, []);
    expect(settled).toBe(r);
    expect(shouldEnqueueSelfCommand(settled, cmd)).toBe(true);
    expect(shouldEnqueueSelfCommand({ ...settled, selfCommandId: 'cmd-s' }, cmd)).toBe(false);
  });

  it('지휘 턴이 실패하면 error 로 닫고 다시 넣지 않는다', () => {
    const r = run({ phase: 'dispatched', plan: selfPlan });
    const settled = settleConductorTurn(r, { id: 'cmd-c', status: 'error' }, 2000, []);
    expect(settled.phase).toBe('error');
    expect(shouldEnqueueSelfCommand(settled, { id: 'cmd-c', status: 'error' })).toBe(false);
  });

  it('다시 넣은 명령이 끝나야 닫힌다 — 정상은 completed, 중지·실패는 error', () => {
    const r = run({ phase: 'dispatched', plan: selfPlan, selfCommandId: 'cmd-s' });
    expect(settleSelfCommand(r, { id: 'other', status: 'completed' }, 5)).toBe(r);
    expect(settleSelfCommand(r, { id: 'cmd-s', status: 'completed' }, 5)).toMatchObject({ phase: 'completed', endedAt: 5 });
    expect(settleSelfCommand(r, { id: 'cmd-s', status: 'completed', stopReason: 'max_tokens' }, 5).phase).toBe('error');
    expect(settleSelfCommand(r, { id: 'cmd-s', status: 'error' }, 5).phase).toBe('error');
  });

  it('검수 발사 — self 에서는 다시 넣은 명령과 재작업을 작업으로 센다(지휘 턴은 여전히 뺀다)', () => {
    const owner = run({ agentId: 'cond', plan: selfPlan, selfCommandId: 'cmd-s', phase: 'completed' });
    const lookup = {
      findRun: () => owner,
      findEdge: (id: string | undefined) => (id === 'rework-edge' ? { kind: 'command' as const, bundleRole: 'auto-rework' as const } : undefined),
      isUserStopped: () => false,
    };
    const done = (id: string, extra: Partial<QueuedCommand> = {}) => ({ id, text: 't', timestamp: 1, subAgentId: 's', status: 'completed' as const, orchestraRunId: 'orc-1', result: `r-${id}`, ...extra });
    expect(orchestraCritiqueFirings([done('cmd-c')], 'cond', lookup).firings).toHaveLength(0);
    expect(orchestraCritiqueFirings([done('cmd-s')], 'cond', lookup).firings).toEqual([{ runId: 'orc-1', result: 'r-cmd-s', freshCycle: true }]);
    expect(orchestraCritiqueFirings([done('cmd-r', { edgeId: 'rework-edge' })], 'cond', lookup).firings).toEqual([{ runId: 'orc-1', result: 'r-cmd-r', freshCycle: false }]);
    // self 가 아닌 런의 감독 명령은 종전처럼 뺀다.
    const plain = { ...lookup, findRun: () => run({ agentId: 'cond', plan: { intent: 'feature', topology: 'single', chosen: [] } }) };
    expect(orchestraCritiqueFirings([done('cmd-s')], 'cond', plain).firings).toHaveLength(0);
  });

  it('검수 엣지는 있으면 다시 쓰고, 없으면 critique(force-rework)로 만든다', () => {
    const created: unknown[] = [];
    const existing = { id: 'e1', sourceAgentId: 'rev', targetAgentId: 'cond', kind: 'critique', bundleRole: 'primary' } as TaskEdge;
    const graph = (edges: Record<string, TaskEdge>) => ({
      getTaskEdgesSnapshot: () => edges,
      createTaskEdge: (...a: unknown[]) => { created.push(a); return { id: 'new' } as TaskEdge; },
    });
    expect(ensureOrchestraReviewEdge(graph({ e1: existing }), 'rev', 'cond').id).toBe('e1');
    expect(created).toHaveLength(0);
    expect(ensureOrchestraReviewEdge(graph({}), 'rev', 'cond').id).toBe('new');
    expect(created[0]).toEqual(['rev', 'cond', expect.any(String), 'auto', null, { kind: 'critique', critiqueAuthority: 'force-rework', critiqueTiming: 'final' }]);
  });

  it('self 편성은 고립 검사를 타지 않고, 검수자는 런 멤버가 된다', () => {
    const plan = { intent: 'feature' as const, topology: 'self' as const, chosen: [], reviewAgentId: 'rev' };
    expect(checkOrchestraPlanGraph(run(), plan, [], [])).toEqual({ ok: true });
    const applied = applyOrchestraPlan(run(), plan, [], 50);
    expect(applied.phase).toBe('dispatched');
    expect(applied.memberAgentIds).toEqual(['rev']);
  });
});

describe('인계 사슬·확인됨·성적표·정리 제안', () => {
  it('사슬 역할은 지휘 → 직접 하기 → 재작업 → 검수 → 엔트리 → 멤버 차례로 정한다', () => {
    const r = run({ selfCommandId: 'cmd-s', plan: { intent: 'feature', topology: 'pipeline', chosen: [], entryAgentId: 'entry' } });
    expect(orchestraHopRole(r, { commandId: 'cmd-c', agentId: 'cond' })).toBe('conductor');
    expect(orchestraHopRole(r, { commandId: 'cmd-s', agentId: 'cond' })).toBe('self');
    expect(orchestraHopRole(r, { commandId: 'x', agentId: 'm', edge: { kind: 'command', bundleRole: 'auto-rework' } })).toBe('rework');
    expect(orchestraHopRole(r, { commandId: 'x', agentId: 'm', edge: { kind: 'critique', bundleRole: 'primary' } })).toBe('review');
    expect(orchestraHopRole(r, { commandId: 'x', agentId: 'entry' })).toBe('entry');
    expect(orchestraHopRole(r, { commandId: 'x', agentId: 'm' })).toBe('member');
  });

  it('사슬 한 줄 — 같은 명령은 한 번, 상한을 넘으면 오래된 것부터', () => {
    const base = run();
    const hop = buildOrchestraHop(base, { id: 'cmd-c', text: '하세요', status: 'completed', timestamp: 10, startedAt: 15, inputTokens: 5, outputTokens: 6, result: '[Stopped by user]', waitedOnConcurrency: true }, 'cond', null, 20);
    expect(hop).toMatchObject({ role: 'conductor', status: 'error', queuedAt: 10, startedAt: 15, endedAt: 20, waitedOnConcurrency: true });
    const once = addOrchestraRunHop(base, hop);
    expect(addOrchestraRunHop(once, hop)).toBe(once);
    let many: OrchestraRun = base;
    for (let i = 0; i < 30; i++) many = addOrchestraRunHop(many, { ...hop, commandId: `c${i}` });
    expect(many.hops).toHaveLength(24);
    expect(many.hops?.[0]!.commandId).toBe('c6');
    expect(appendOrchestraHop(undefined, { ...hop, role: 'nope' as never })).toEqual([]);
  });

  it('조율 = 지휘 + parallel 의 허브, 나머지는 작업', () => {
    const hops = [
      { commandId: 'a', agentId: 'cond', role: 'conductor' as const, instruction: '', status: 'completed' as const, inputTokens: 10, outputTokens: 0, queuedAt: 0, endedAt: 1 },
      { commandId: 'b', agentId: 'hub', role: 'entry' as const, instruction: '', status: 'completed' as const, inputTokens: 20, outputTokens: 0, queuedAt: 0, endedAt: 1 },
      { commandId: 'c', agentId: 'w', role: 'member' as const, instruction: '', status: 'completed' as const, inputTokens: 30, outputTokens: 0, queuedAt: 0, endedAt: 1 },
    ];
    const parallel = orchestraTokenSplit(run({ hops, inputTokens: 60, plan: { intent: 'research', topology: 'parallel', chosen: [] } }));
    expect(parallel).toEqual({ coordination: 30, work: 30, recorded: 60, total: 60 });
    const pipeline = orchestraTokenSplit(run({ hops, inputTokens: 70, plan: { intent: 'feature', topology: 'pipeline', chosen: [] } }));
    expect(pipeline).toEqual({ coordination: 10, work: 50, recorded: 60, total: 70 });
  });

  it('확인됨 — 승인이고 exitCode 0 증거가 있을 때만(말만 있는 통과는 세지 않는다)', () => {
    const approved = recordOrchestraVerification(run(), 'approve', [{ exitCode: 0 }, { exitCode: 1 }], 7);
    expect(approved.verification).toEqual({ verdict: 'approve', passed: 1, failed: 1, at: 7 });
    expect(isOrchestraRunVerified(approved)).toBe(true);
    expect(isOrchestraRunVerified(recordOrchestraVerification(run(), 'approve', [], 7))).toBe(false);
    expect(recordOrchestraVerification(run(), 'unknown', [], 7).verification?.verdict).toBe('held');
  });

  it('성적표 — 의도 × 편성별로 세고, 끝난 런만 평균에 넣는다', () => {
    const plan = { intent: 'feature' as const, topology: 'single' as const, chosen: [] };
    const rows = orchestraScorecard([
      run({ runId: '1', plan, phase: 'completed', inputTokens: 100, outputTokens: 0, endedAt: 3000, verification: { verdict: 'approve', passed: 1, failed: 0, at: 1 } }),
      run({ runId: '2', plan, phase: 'error', inputTokens: 300, outputTokens: 0, endedAt: 2000 }),
      run({ runId: '3', plan, phase: 'dispatched', inputTokens: 999 }),
      run({ runId: '4', phase: 'unreported', endedAt: 1500 }),
    ]);
    expect(rows[0]).toEqual({ intent: 'feature', topology: 'single', runs: 3, completed: 1, verified: 1, answered: 0, unreported: 0, error: 1, avgTokens: 200, avgDurationMs: 1500 });
    expect(rows[1]).toMatchObject({ intent: 'unplanned', topology: 'unplanned', runs: 1, unreported: 1 });
  });

  it('정리 제안 — 넘겨받기만 하는 단계는 합칠 후보, 오래 안 쓴 멤버는 목록만', () => {
    const now = 100 * 24 * 60 * 60_000;
    const edges = [
      { id: 'e1', sourceAgentId: 'a', targetAgentId: 'b', kind: 'command' as const, bundleRole: 'primary' as const },
      { id: 'e2', sourceAgentId: 'a', targetAgentId: 'c', kind: 'command' as const, bundleRole: 'primary' as const },
      { id: 'e3', sourceAgentId: 'c', targetAgentId: 'd', kind: 'command' as const, bundleRole: 'primary' as const },
      { id: 'ret', sourceAgentId: 'b', targetAgentId: 'a', kind: 'command' as const, bundleRole: 'auto-artifact' as const },
    ];
    const runs = [run({ memberAgentIds: ['a', 'b', 'c', 'd'], startedAt: now - 1000, endedAt: now - 500 }), run({ runId: 'old', memberAgentIds: ['old'], startedAt: 0, endedAt: 1 })];
    const s = orchestraSuggestions(runs, edges, new Set(['a', 'b', 'c', 'd', 'old']), now);
    expect(s?.foldPairs.map((p) => `${p.fromAgentId}->${p.intoAgentId}`)).toEqual(['b->a', 'd->c']);
    expect(s?.idleMembers.map((m) => m.agentId)).toEqual(['old']);
    expect(orchestraSuggestions([], edges, new Set(), now)).toBeUndefined();
  });

  it('검수는 다른 엔진 — 켜면 두 엔진을 다 받고, 로컬은 여전히 안 받는다', () => {
    expect(orchestraMemberProviderAllowed({ memberEngine: 'claude' }, 'codex-cli', 'claude')).toBe(false);
    expect(orchestraMemberProviderAllowed({ memberEngine: 'claude', crossEngineReview: true }, 'codex-cli', 'claude')).toBe(true);
    expect(orchestraMemberProviderAllowed({ crossEngineReview: true }, 'local-llama', 'claude')).toBe(false);
  });
});

describe('한 번에 등록', () => {
  function fakeCall(log: string[], fail?: string): FormationCall {
    let n = 0;
    return async (method, p, body) => {
      log.push(`${method} ${p} ${body === undefined ? '' : JSON.stringify(body)}`);
      if (fail && p.includes(fail)) return { status: 429, json: { ok: false, error: 'orchestra-member-limit' } };
      if (p === '/api/create-custom-agent') return { status: 200, json: { ok: true, agent: { id: `agent-${++n}` } } };
      if (method === 'GET') return { status: 200, json: { config: { model: 'opus', tools: ['Read'], rules: 'old' } } };
      if (method === 'PUT') return { status: 200, json: { ok: true } };
      if (p === '/api/task-edges') return { status: 200, json: { data: { id: 'edge-1' } } };
      if (p.endsWith('/plan')) return { status: 200, json: { ok: true, dispatchEdgeId: 'disp-1' } };
      return { status: 404, json: {} };
    };
  }
  const ctx = (call: FormationCall) => ({ runId: 'orc-1', projectName: 'demo', centerX: 0, centerY: 0, radius: 100, call });

  it('본문 모양을 칸 이름으로 거른다', () => {
    expect(validateFormationBody({})).toEqual({ ok: false, error: 'plan-required' });
    expect(validateFormationBody({ plan: {}, members: [{ ref: 'coder' }] })).toEqual({ ok: false, error: 'member-ref-invalid' });
    expect(validateFormationBody({ plan: {}, members: [{ ref: '@a' }, { ref: '@a' }] })).toEqual({ ok: false, error: 'member-ref-duplicate' });
    expect(validateFormationBody({ plan: {}, edges: [{ from: '@a' }] })).toEqual({ ok: false, error: 'edge-endpoint-invalid' });
  });

  it('①~④ 를 차례로 부르고 이름표를 id 로 푼다(권한 축은 보내지 않는다)', async () => {
    const log: string[] = [];
    const body = validateFormationBody({
      plan: { intent: 'feature', topology: 'pipeline', chosen: [], entryAgentId: '@coder' },
      members: [
        { ref: '@coder', label: 'Coder', config: { model: 'sonnet', rules: 'new', permissionMode: 'bypassPermissions', tools: ['Write'] } },
        { ref: '@rev', reuseAgentId: 'agent-old' },
      ],
      edges: [{ from: '@coder', to: '@rev', command: 'review', forwardMode: 'auto', kind: 'command' }],
    });
    expect(body.ok).toBe(true);
    if (!body.ok) return;
    const result = await runOrchestraFormation(body.value, ctx(fakeCall(log)));
    expect(result).toMatchObject({ ok: true, dispatchEdgeId: 'disp-1', agentIds: { '@coder': 'agent-1', '@rev': 'agent-old' } });
    expect(log[0]).toContain('"orchestraRunId":"orc-1"');
    const put = log.find((l) => l.startsWith('PUT'))!;
    expect(put).toContain('"model":"sonnet"');
    expect(put).toContain('"tools":["Read"]');
    expect(put).not.toContain('bypassPermissions');
    expect(log.find((l) => l.includes('/api/task-edges'))).toContain('"sourceAgentId":"agent-1","targetAgentId":"agent-old"');
    const plan = log.find((l) => l.includes('/plan'))!;
    expect(plan).toContain('"entryAgentId":"agent-1"');
    expect(plan).toContain('"reusedAgentIds":["agent-old"]');
  });

  it('중간 실패는 지우지 않고 어디까지 됐는지 돌려준다', async () => {
    const log: string[] = [];
    const body = validateFormationBody({ plan: { intent: 'feature', topology: 'single', chosen: [] }, members: [{ ref: '@a' }] });
    if (!body.ok) throw new Error('bad');
    const result = await runOrchestraFormation(body.value, ctx(fakeCall(log, 'create-custom-agent')));
    expect(result).toMatchObject({ ok: false, status: 429, error: 'orchestra-member-limit' });
    expect(result.steps).toEqual([{ step: 'create', ref: '@a', ok: false, status: 429, error: 'orchestra-member-limit' }]);
    expect(log.some((l) => l.includes('/plan'))).toBe(false);
  });
});

describe('멤버 지시문 → 프로젝트 스킬', () => {
  it('이름은 글자·숫자·-·_ 만, 비면 대체 이름', () => {
    expect(orchestraSkillSlug('Code Reviewer (Go)')).toBe('Code-Reviewer-Go');
    expect(orchestraSkillSlug('검수자 1')).toBe('검수자-1');
    expect(orchestraSkillSlug('***')).toBe('orchestra-member');
  });

  it('머리는 한 줄 설명(따옴표로 감싼다) + 지시문 원문', () => {
    const md = buildMemberSkillMarkdown('rev', 'Reviewer', '# 역할: "검수"\n결과물만 본다');
    expect(md.startsWith('---\nname: rev\ndescription: "Reviewer — 역할: \\"검수\\""\n---\n\n# 역할: "검수"')).toBe(true);
  });

  it('프로젝트 스킬 자리에 새로 쓰고, 같은 이름이 있으면 덮지 않는다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vib-skill-'));
    try {
      const first = exportMemberSkill({ projectCwd: root, provider: 'claude', label: 'Reviewer', rules: '# r', platform: process.platform as NodeJS.Platform as never, home: root });
      expect(first.ok && first.path).toBe(path.join(root, '.claude', 'skills', 'Reviewer', 'SKILL.md'));
      expect(exportMemberSkill({ projectCwd: root, provider: 'claude', label: 'Reviewer', rules: '# r2', platform: process.platform as never, home: root }))
        .toEqual({ ok: false, status: 409, error: 'skill-exists' });
      expect(fs.readFileSync(path.join(root, '.claude', 'skills', 'Reviewer', 'SKILL.md'), 'utf8')).toContain('# r');
      const codex = exportMemberSkill({ projectCwd: root, provider: 'codex', label: 'Reviewer', rules: '# c', platform: process.platform as never, home: root });
      expect(codex.ok && codex.path).toBe(path.join(root, '.agents', 'skills', 'Reviewer', 'SKILL.md'));
      expect(exportMemberSkill({ projectCwd: root, provider: 'claude', label: 'Empty', rules: '  ', platform: process.platform as never, home: root }))
        .toEqual({ ok: false, status: 400, error: 'member-rules-empty' });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('세션 목표 — 끝냄과 확인됨', () => {
  const v = (partial: Partial<VerificationRun>): VerificationRun => ({
    id: 'ver-1', agentId: 'a', subAgentId: 's', projectName: 'p', recipeSource: 'auto' as never, status: 'done', verdict: 'pass',
    attempts: [{ kind: 'test', command: 'pnpm test', exitCode: 0 }], startedAt: 100, finishedAt: 200, ...partial,
  });

  it('끝낸 뒤 통과한 검증이 있고 종료 코드 0 증거가 있을 때만', () => {
    const step = { status: 'done' as const, updatedAt: 150 };
    expect(goalStepVerification(step, [v({})])).toEqual({ at: 200, verificationId: 'ver-1' });
    expect(goalStepVerification(step, [v({ finishedAt: 120 })])).toBeNull();
    expect(goalStepVerification(step, [v({ verdict: 'fail' })])).toBeNull();
    expect(goalStepVerification(step, [v({ attempts: [{ kind: 'test', command: 'x' }] })])).toBeNull();
    expect(goalStepVerification({ status: 'in_progress', updatedAt: 150 }, [v({})])).toBeNull();
  });
});
