/**
 * §5.3 #12 — **위임 엣지가 소스를 무력화하지 않는가.**
 *
 * 이 자리는 화면에도 타입에도 흔적이 없다. 엣지는 초록으로 붙어 있고 설정 창의 Tools 는 48개가
 * 전부 켜져 보이는데, 정작 스폰되는 명령줄만 `--tools ""` 가 된다. 실제로 그렇게 됐다 —
 * 감독(Codex) → 개발(Claude) 편성에서 타겟이 기본값(전체 도구)이라 박탈 합집합이 소스 도구를
 * 통째로 덮었고, 소스는 도구 0개로 한 시간을 돌며 계획만 말했다. Claude 소스의 dispatch
 * 프로토콜이 Bash heredoc curl 이라 **위임조차 불가능**했던 것이 핵심이다.
 *
 * 그래서 여기서는 "값이 저장되는가"가 아니라 **"소스가 손에 무엇을 들고 스폰되는가"** 를 못 박는다.
 */
import { describe, it, expect } from 'vitest';
import {
  computeDelegationStrip,
  applyDelegationStrip,
  resolveEdgeCommandMode,
  resolveEffectiveDelegationPolicy,
  hasUsableTools,
  DELEGATION_CHANNEL_TOOLS,
  type DelegationEdgeInput,
} from './taskEdgeDelegation.js';
import { TASK_EDGE_DEFAULTS } from '@vibisual/shared';
import fs from 'node:fs';

/** 사용자의 실제 설정: 양쪽 모두 전체 도구. 목록 길이는 중요하지 않고 **완전히 겹친다**는 점이 중요하다. */
const ALL_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob', 'WebSearch', 'Task'];

function strip(args: {
  edges: DelegationEdgeInput[];
  sourceTools?: readonly string[];
  targetTools?: Record<string, readonly string[] | undefined>;
  viable?: (e: DelegationEdgeInput) => boolean;
}) {
  return computeDelegationStrip({
    edges: args.edges,
    sourceTools: args.sourceTools ?? ALL_TOOLS,
    // 키가 있으면 그 값 그대로(undefined = "설정 저장된 적 없음"), 없으면 전체 도구.
    targetToolsOf: (id) => (args.targetTools && id in args.targetTools) ? args.targetTools[id] : ALL_TOOLS,
    isEdgeViable: args.viable ?? (() => true),
  });
}

describe('resolveEdgeCommandMode — 집행 축은 한 곳에서만 해석된다', () => {
  it("commandMode 가 박혀 있으면 delegationPolicy 와 무관하게 그 값이다", () => {
    expect(resolveEdgeCommandMode({ id: 'e', targetAgentId: 't', commandMode: 'tool-delegation', delegationPolicy: 'auto' }))
      .toBe('tool-delegation');
    expect(resolveEdgeCommandMode({ id: 'e', targetAgentId: 't', commandMode: 'shared', delegationPolicy: 'strict' }))
      .toBe('shared');
  });

  it('commandMode 미설정(v1.44 이전 저장분)은 delegationPolicy 로만 해석한다 — 후방호환 보존', () => {
    expect(resolveEdgeCommandMode({ id: 'e', targetAgentId: 't', delegationPolicy: 'strict' })).toBe('tool-delegation');
    expect(resolveEdgeCommandMode({ id: 'e', targetAgentId: 't', delegationPolicy: 'auto' })).toBe('shared');
    // delegationPolicy 조차 없으면 기본 'strict' → 'tool-delegation' (v1.37~v1.43 거동)
    expect(resolveEdgeCommandMode({ id: 'e', targetAgentId: 't' })).toBe('tool-delegation');
  });

  it("kind 가 command 가 아니면 commandMode 축 자체가 없다", () => {
    for (const kind of ['artifact', 'request', 'critique'] as const) {
      expect(resolveEdgeCommandMode({ id: 'e', targetAgentId: 't', kind, commandMode: 'tool-delegation' })).toBeNull();
    }
  });
});

describe('결함 2 — 배지가 읽는 축과 박탈이 읽는 축이 같다', () => {
  it('policy=auto + mode=tool-delegation 은 AUTO 가 아니라 STRICT 로 표시된다', () => {
    const edge: DelegationEdgeInput = { id: 'tedge-mtzi4rvp-czag', targetAgentId: 'claude', commandMode: 'tool-delegation', delegationPolicy: 'auto' };
    // 어긋남의 원본: 배지는 delegationPolicy('auto')를 읽고 박탈은 commandMode 를 읽었다.
    expect(edge.delegationPolicy).toBe('auto');
    expect(resolveEffectiveDelegationPolicy(edge)).toBe('strict');
    expect(resolveEdgeCommandMode(edge)).toBe('tool-delegation');
  });

  it('mode-delegation 도 사실상 의무 위임이다', () => {
    expect(resolveEffectiveDelegationPolicy({ id: 'e', targetAgentId: 't', commandMode: 'mode-delegation', delegationPolicy: 'auto' })).toBe('strict');
  });

  it('shared 엣지는 저장된 정책을 그대로 쓴다 — 없던 강제를 지어내지 않는다', () => {
    expect(resolveEffectiveDelegationPolicy({ id: 'e', targetAgentId: 't', commandMode: 'shared', delegationPolicy: 'auto' })).toBe('auto');
    expect(resolveEffectiveDelegationPolicy({ id: 'e', targetAgentId: 't', commandMode: 'shared', delegationPolicy: 'strict' })).toBe('strict');
  });
});

describe('결함 1 — 타겟이 전체 도구를 가진 tool-delegation 엣지에서도 소스는 위임 수단을 잃지 않는다', () => {
  const userEdge: DelegationEdgeInput = {
    id: 'tedge-mtzi4rvp-czag', targetAgentId: 'claude-dev', commandMode: 'tool-delegation', delegationPolicy: 'auto',
  };

  it('소스 도구가 빈 배열이 되지 않는다 (이 런의 재현 조건 그대로)', () => {
    const decision = strip({ edges: [userEdge] });
    const spawned = applyDelegationStrip(ALL_TOOLS, decision);
    expect(spawned.length).toBeGreaterThan(0);
  });

  it('위임 수단(Bash)이 반드시 남는다 — 없으면 dispatch curl 을 못 돌린다', () => {
    const decision = strip({ edges: [userEdge] });
    const spawned = applyDelegationStrip(ALL_TOOLS, decision);
    for (const lifeline of DELEGATION_CHANNEL_TOOLS) expect(spawned).toContain(lifeline);
    expect(decision.strip.has('Bash')).toBe(false);
  });

  it('완전히 겹치면 박탈을 통째로 취소한다 — Codex 소스의 restrictedTools 도 함께 빈다', () => {
    const decision = strip({ edges: [userEdge] });
    expect(decision.applied).toBe(false);
    expect(decision.reason).toBe('would-strip-all');
    // restrictedTools 는 이 집합을 그대로 싣는다. 비어 있어야 shell·web 이 안 꺼진다.
    expect([...decision.strip]).toEqual([]);
    // 취소돼도 "어느 엣지가 박탈 모드였는가"는 남는다(배지가 이걸 읽는다).
    expect(decision.strippingEdgeIds).toEqual(['tedge-mtzi4rvp-czag']);
  });

  it('strict 엣지 두 개가 합쳐져 소스를 덮어도 마찬가지다', () => {
    const decision = strip({
      edges: [
        { id: 'tedge-mtz8uht7-smw9', targetAgentId: 'a', commandMode: 'tool-delegation', delegationPolicy: 'strict' },
        { id: 'tedge-mtzi4rvp-czag', targetAgentId: 'b', commandMode: 'tool-delegation', delegationPolicy: 'auto' },
      ],
      targetTools: { a: ['Read', 'Grep', 'Glob'], b: ['Bash', 'Write', 'Edit', 'WebSearch', 'Task'] },
    });
    expect(decision.applied).toBe(false);
    expect(applyDelegationStrip(ALL_TOOLS, decision)).toEqual(ALL_TOOLS);
  });

  it('부분 겹침이면 박탈은 정상 동작한다 — 안전선이 기능 자체를 끄지는 않는다', () => {
    const decision = strip({
      edges: [{ id: 'e1', targetAgentId: 'reader', commandMode: 'tool-delegation' }],
      targetTools: { reader: ['Read', 'Grep', 'Glob'] },
    });
    expect(decision.applied).toBe(true);
    expect(decision.reason).toBe('applied');
    const spawned = applyDelegationStrip(ALL_TOOLS, decision);
    expect(spawned).not.toContain('Read');
    expect(spawned).not.toContain('Grep');
    expect(spawned).toContain('Bash');
    expect(spawned).toContain('Write');
  });

  it('부분 겹침이어도 Bash 는 박탈 집합에서 빠진다', () => {
    const decision = strip({
      edges: [{ id: 'e1', targetAgentId: 'runner', commandMode: 'tool-delegation' }],
      targetTools: { runner: ['Bash', 'Read'] },
    });
    expect(decision.applied).toBe(true);
    expect([...decision.strip]).toEqual(['Read']);
    expect(decision.preservedTools).toEqual(['Bash']);
    expect(applyDelegationStrip(ALL_TOOLS, decision)).toContain('Bash');
  });

  it('타겟 도구가 Bash 하나뿐이면 박탈할 게 남지 않는다', () => {
    const decision = strip({
      edges: [{ id: 'e1', targetAgentId: 'runner', commandMode: 'tool-delegation' }],
      targetTools: { runner: ['Bash'] },
    });
    expect(decision.applied).toBe(false);
    expect(applyDelegationStrip(ALL_TOOLS, decision)).toEqual(ALL_TOOLS);
  });
});

describe('박탈 모드가 아닌 엣지는 도구를 건드리지 않는다', () => {
  it.each([
    ['shared', { id: 'e', targetAgentId: 't', commandMode: 'shared' } as DelegationEdgeInput],
    ['mode-delegation', { id: 'e', targetAgentId: 't', commandMode: 'mode-delegation' } as DelegationEdgeInput],
    ['artifact kind', { id: 'e', targetAgentId: 't', kind: 'artifact', commandMode: 'tool-delegation' } as DelegationEdgeInput],
    ['critique kind', { id: 'e', targetAgentId: 't', kind: 'critique', delegationPolicy: 'strict' } as DelegationEdgeInput],
  ])('%s', (_label, edge) => {
    const decision = strip({ edges: [edge], targetTools: { t: ['Read'] } });
    expect(decision.applied).toBe(false);
    expect(decision.reason).toBe('no-stripping-edge');
    expect(applyDelegationStrip(ALL_TOOLS, decision)).toEqual(ALL_TOOLS);
  });

  it('타겟 설정이 저장된 적 없으면(=CLI 기본 상속) 박탈 대상이 없다', () => {
    const decision = strip({
      edges: [{ id: 'e1', targetAgentId: 'fresh', commandMode: 'tool-delegation' }],
      targetTools: { fresh: undefined },
    });
    expect(decision.applied).toBe(false);
    expect(decision.reason).toBe('no-target-tools');
  });
});

describe('결함 4 — viability 는 양끝을 대칭으로 본다', () => {
  it('무효 엣지는 박탈에 실리지 않는다', () => {
    const decision = strip({
      edges: [{ id: 'e1', targetAgentId: 'reader', commandMode: 'tool-delegation' }],
      targetTools: { reader: ['Read'] },
      viable: () => false,
    });
    expect(decision.applied).toBe(false);
    expect(decision.strippingEdgeIds).toEqual([]);
  });

  it('hasUsableTools — 명시적 빈 배열만 무효, 미저장(undefined)은 유효', () => {
    expect(hasUsableTools({ tools: [] })).toBe(false);
    expect(hasUsableTools({ tools: ['Read'] })).toBe(true);
    expect(hasUsableTools(undefined)).toBe(true);
    expect(hasUsableTools(null)).toBe(true);
  });

  it('소스가 도구 0개면(사용자가 전부 끔) 박탈이 돌지 않는다 — 호출부가 viability 로 막는다', () => {
    const sourceViable = hasUsableTools({ tools: [] });
    const decision = strip({
      edges: [{ id: 'e1', targetAgentId: 'reader', commandMode: 'tool-delegation' }],
      sourceTools: [],
      targetTools: { reader: ['Read'] },
      viable: () => sourceViable,
    });
    expect(decision.applied).toBe(false);
  });
});

describe('결함 3 — REST 로 만든 신규 엣지는 commandMode 가 undefined 로 남지 않는다', () => {
  it("SSOT 기본값은 'shared' 이고, 박히면 legacy fallback 을 타지 않는다", () => {
    expect(TASK_EDGE_DEFAULTS.commandMode).toBe('shared');
    // 박히지 않았을 때: delegationPolicy 기본값 'strict' → 박탈 대상이 된다(구멍).
    expect(resolveEdgeCommandMode({ id: 'e', targetAgentId: 't' })).toBe('tool-delegation');
    // 박힌 뒤: 같은 엣지가 박탈 대상이 아니다.
    expect(resolveEdgeCommandMode({ id: 'e', targetAgentId: 't', commandMode: TASK_EDGE_DEFAULTS.commandMode })).toBe('shared');
  });

  it('POST /api/task-edges 가 기본값을 박아 createTaskEdge 로 넘긴다', () => {
    const src = fs.readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    expect(src).toContain('const resolvedCommandMode = commandMode ?? TASK_EDGE_DEFAULTS.commandMode;');
    expect(src).toContain('commandMode: resolvedCommandMode');
  });
});
