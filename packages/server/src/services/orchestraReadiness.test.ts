import { describe, expect, it } from 'vitest';
import {
  orchestraEnginePreparation, orchestraPreparationForRequest, orchestraReadyEngines, resolveOrchestraMemberEngine,
  buildOrchestraConductorRules,
} from '@vibisual/shared';
import type { OrchestraReadiness, OrchestraConductorRulesArgs, OrchestraRun } from '@vibisual/shared';
import { checkOrchestraMemberCreate } from './orchestraRuntime.js';

const codexOnly: OrchestraReadiness = {
  codexSetup: { phase: 'ready' }, codexAuth: { loggedIn: true },
  claudeSetup: { phase: 'missing' }, claudeAuth: { loggedIn: false, error: 'cli-missing' },
};
const run: OrchestraRun = {
  runId: 'orc-ready', projectPath: '/work', agentId: 'codex-conductor', commandId: 'cmd', userRequest: 'review',
  engine: 'codex', phase: 'conducting', startedAt: 1, memberAgentIds: [], inputTokens: 0, outputTokens: 0,
};
const rulesBase: OrchestraConductorRulesArgs = {
  serverBase: 'http://localhost:1', projectName: 'demo', runId: run.runId, conductorAgentId: run.agentId,
  conductorSubAgentId: 'sub', centerX: 0, centerY: 0, conductorEngine: 'codex', platform: 'win32',
  settings: {}, existingMembers: [], existingEdges: [],
};

describe('Codex만 준비한 사용자의 자동 편성', () => {
  it('미지정 멤버는 지휘자 엔진을 따르고 Claude 설치를 요구하지 않는다', () => {
    expect(resolveOrchestraMemberEngine({}, 'codex')).toBe('codex');
    expect(orchestraPreparationForRequest({}, 'codex', codexOnly)).toBeNull();
    expect(checkOrchestraMemberCreate(run, {}, { sameProject: true, providerKind: 'codex-cli', readiness: codexOnly })).toEqual({ ok: true });
    expect(checkOrchestraMemberCreate(run, {}, { sameProject: true, providerKind: undefined, readiness: codexOnly })).toMatchObject({ ok: false, error: 'orchestra-member-engine' });
    const rules = buildOrchestraConductorRules(rulesBase);
    expect(rules).toContain('멤버는 **Codex** 로 만든다');
    expect(rules).not.toContain('- **Claude 멤버**');
  });

  it('명시적으로 고른 Claude는 다른 엔진으로 바꾸지 않고 설치·로그인 안내를 요구한다', () => {
    expect(resolveOrchestraMemberEngine({ memberEngine: 'claude' }, 'codex')).toBe('claude');
    expect(orchestraPreparationForRequest({ memberEngine: 'claude' }, 'codex', codexOnly)).toEqual({ engine: 'claude', action: 'setup' });
    expect(orchestraPreparationForRequest({ memberEngine: 'claude' }, 'codex', {
      ...codexOnly, claudeSetup: { phase: 'ready' }, claudeAuth: { loggedIn: false },
    })).toEqual({ engine: 'claude', action: 'login' });
    const rules = buildOrchestraConductorRules({ ...rulesBase, settings: { memberEngine: 'claude' } });
    expect(rules).toContain('멤버는 **Claude** 로 만든다');
  });

  it('자동 선택은 준비된 엔진만 안내하고 미준비 엔진의 직접 멤버 생성도 거절한다', () => {
    const readyEngines = orchestraReadyEngines(codexOnly);
    expect(readyEngines).toEqual(['codex']);
    expect(orchestraPreparationForRequest({ memberEngine: 'auto' }, 'codex', codexOnly)).toBeNull();
    const rules = buildOrchestraConductorRules({ ...rulesBase, settings: { memberEngine: 'auto' }, readyEngines });
    expect(rules).toContain('- **Codex 멤버**');
    expect(rules).not.toContain('- **Claude 멤버**');
    expect(checkOrchestraMemberCreate(run, { memberEngine: 'auto' }, {
      sameProject: true, providerKind: undefined, readiness: codexOnly,
    })).toMatchObject({ ok: false, status: 409, error: 'orchestra-engine-not-ready', preparation: { engine: 'claude', action: 'setup' } });
  });

  it('부팅 중·로그인 판정 실패는 로그아웃으로 오인하지 않고 다시 확인한다', () => {
    expect(orchestraEnginePreparation('codex', {})).toEqual({ engine: 'codex', action: 'refresh' });
    expect(orchestraEnginePreparation('codex', { codexSetup: { phase: 'unknown' } })).toEqual({ engine: 'codex', action: 'refresh' });
    expect(orchestraEnginePreparation('codex', { ...codexOnly, codexAuth: { loggedIn: false, error: 'timeout' } })).toEqual({ engine: 'codex', action: 'refresh' });
    expect(orchestraPreparationForRequest({ memberEngine: 'auto' }, 'codex', {})).toEqual({ engine: 'codex', action: 'refresh' });
  });

  it('다른 프로젝트·세션의 명시 엔진과 준비 완료 후 재전송은 독립적이다', () => {
    const readyBoth = { ...codexOnly, claudeSetup: { phase: 'ready' as const }, claudeAuth: { loggedIn: true } };
    expect(orchestraPreparationForRequest({ memberEngine: 'claude' }, 'codex', readyBoth)).toBeNull();
    expect(orchestraReadyEngines(readyBoth)).toEqual(['claude', 'codex']);
    expect(resolveOrchestraMemberEngine({}, 'claude')).toBe('claude');
    expect(resolveOrchestraMemberEngine({}, 'codex')).toBe('codex');
    expect(checkOrchestraMemberCreate(run, { memberEngine: 'claude' }, {
      sameProject: true, providerKind: undefined, readiness: readyBoth,
    })).toEqual({ ok: true });
  });
});
