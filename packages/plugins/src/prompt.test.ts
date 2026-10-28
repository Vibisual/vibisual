/** §5.11 — 집행 배럴의 관문 고정. 특히 안 켠 프로젝트에선 프롬프트가 한 글자도 늘지 않는다(실행되지 않는 관문은 틀려도 안 걸린다). */
import { describe, it, expect } from 'vitest';
import type { PluginPromptContext, PluginPromptModule } from './types.js';
import { PLUGIN_PROMPT_MODULES, activePromptModules, buildPluginPromptBlocks, collectPluginFacts } from './prompt.js';
import { PLUGIN_MANIFESTS, getPluginManifest } from './registry.js';

const PROJECT = 'C:/repo/alpha';
const OTHER = 'C:/repo/beta';

const ctx: PluginPromptContext = {
  projectPath: PROJECT,
  cwd: PROJECT,
  agentId: 'agent-1',
  agentLabel: 'Agent',
  customCreated: true,
  fileExists: (p) => p === 'docs/SCENARIO.md',
  readFile: () => '# spec\n## Change Log\n',
};

const on = { enabledPluginsByProject: { [PROJECT]: ['ssot-drift'] } };
const off = { enabledPluginsByProject: { [PROJECT]: [] } };

/** §5.5 #17-44 ⑧(d) — 손잡이가 자기 화면에 있는 카드들(늘 통과). 등록부에서 뽑는다 — 손으로 적으면 이 축의 카드가 늘 때 조용히 낡는다. */
const OWN_TOGGLE = PLUGIN_MANIFESTS.filter((m) => m.ownToggle === true).map((m) => m.id).sort();

describe('집행 배럴', () => {
  it('등록된 집행 모듈은 전부 등록부에 있는 id 다', () => {
    for (const mod of PLUGIN_PROMPT_MODULES) {
      expect(getPluginManifest(mod.id), `등록부에 없는 id: ${mod.id}`).toBeDefined();
    }
  });

  it('집행 모듈의 매니페스트는 agentPrompt 를 선언하고 clientOnly 가 아니다', () => {
    for (const mod of PLUGIN_PROMPT_MODULES) {
      const manifest = getPluginManifest(mod.id);
      expect(manifest?.contributes).toContain('agentPrompt');
      expect(manifest?.clientOnly).toBe(false);
    }
  });

  it('켠 프로젝트에서만 블록이 실린다', () => {
    expect(buildPluginPromptBlocks(on, PROJECT, ctx)).toContain('SSOT');
    expect(buildPluginPromptBlocks(off, PROJECT, ctx)).toBe('');
  });

  it('다른 프로젝트에서 켠 것이 이 프로젝트로 새지 않는다', () => {
    expect(buildPluginPromptBlocks({ enabledPluginsByProject: { [OTHER]: ['ssot-drift'] } }, PROJECT, ctx)).toBe('');
  });

  it('아무것도 안 켜면 빈 문자열 — 프롬프트가 한 글자도 늘지 않는다', () => {
    expect(buildPluginPromptBlocks(null, PROJECT, ctx)).toBe('');
    expect(buildPluginPromptBlocks(undefined, null, ctx)).toBe('');
  });

  /**
   * §5.5 #17-44 ⑧(d) — 예외는 `ownToggle` 카드뿐: 켬 집합 없이 통과하고 그 기능의 스위치가 판정한다(관문을 또 두면 "뷰에서 켰는데 안 실린다").
   * 꺼진 층이면 그 카드의 `buildBlock` 이 `undefined` 라 빈 문자열 보장은 그대로다.
   */
  it('활성 목록은 켬/끔 판정 한 곳을 그대로 통과한다 — 예외는 손잡이가 자기 화면에 있는 카드뿐', () => {
    expect(activePromptModules(on, PROJECT).map((m) => m.id).sort()).toEqual([...OWN_TOGGLE, 'ssot-drift'].sort());
    expect(activePromptModules(off, PROJECT).map((m) => m.id).sort()).toEqual([...OWN_TOGGLE]);
  });

  it('플러그인이 던져도 그 턴은 살아남고, 어느 플러그인이 죽었는지만 보고된다', () => {
    // 실제 배럴을 통과시킨다 — 탐침이 던지면 `buildBlock` 안에서 터진다.
    const hostile: PluginPromptContext = {
      ...ctx,
      fileExists: () => {
        throw new Error('probe exploded');
      },
    };
    const failed: string[] = [];
    expect(buildPluginPromptBlocks(on, PROJECT, hostile, (id) => failed.push(id))).toBe('');
    expect(failed).toEqual(['ssot-drift']);
  });

  it('빈 블록은 붙이지 않는다', () => {
    const silent: PluginPromptModule = { id: 'ssot-drift', buildBlock: () => '   ' };
    expect(silent.buildBlock(ctx)?.trim()).toBe('');
  });
});

/** §5.11 — 실측 수집 고정: 관문이 블록 조립과 같고, 한 장이 던져도 나머지가 산다. */
describe('집행 실측 수집', () => {
  it('켠 프로젝트에서만 실측이 나온다 — `ownToggle` 은 늘 나오되 꺼진 층을 스스로 신고한다', () => {
    expect(Object.keys(collectPluginFacts(on, PROJECT, ctx)).sort()).toEqual([...OWN_TOGGLE, 'ssot-drift'].sort());
    expect(Object.keys(collectPluginFacts(off, PROJECT, ctx)).sort()).toEqual([...OWN_TOGGLE]);
    expect(Object.keys(collectPluginFacts({ enabledPluginsByProject: { [OTHER]: ['ssot-drift'] } }, PROJECT, ctx)).sort())
      .toEqual([...OWN_TOGGLE]);
    // 늘 나온다고 해서 **재는** 것은 아니다 — 3층이 꺼져 있으면 색인조차 세우지 않고 그 사실만 신고한다.
    expect(collectPluginFacts(off, PROJECT, ctx)['spec-driven']).toEqual({ specEnabled: false });
  });

  it('실측은 그 블록이 실제로 쓴 판단과 같은 값이다', () => {
    const facts = collectPluginFacts(on, PROJECT, ctx)['ssot-drift'];
    const block = buildPluginPromptBlocks(on, PROJECT, ctx);
    expect(facts?.doc).toBe('docs/SCENARIO.md');
    expect(block).toContain(String(facts?.doc));
    expect(facts?.hasChangeLog).toBe(true);
  });

  it('실측만 얕은 값이다 — 카드가 그대로 한 줄로 그릴 수 있어야 한다', () => {
    for (const value of Object.values(collectPluginFacts(on, PROJECT, ctx)['ssot-drift'] ?? {})) {
      const ok = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        || (Array.isArray(value) && value.every((x) => typeof x === 'string'));
      expect(ok, `얕지 않은 실측 값: ${JSON.stringify(value)}`).toBe(true);
    }
  });

  it('실측이 던져도 나머지는 살고 어느 카드가 죽었는지만 보고된다', () => {
    const hostile: PluginPromptContext = {
      ...ctx,
      fileExists: () => {
        throw new Error('probe exploded');
      },
    };
    const failed: string[] = [];
    // 던진 카드만 빠진다 — `ownToggle` 카드는 꺼진 층이라 파일을 훑지 않으므로 애초에 던질 일이 없다.
    expect(collectPluginFacts(on, PROJECT, hostile, (id) => failed.push(id))['ssot-drift']).toBeUndefined();
    expect(failed).toEqual(['ssot-drift']);
  });

  it('실측을 안 내는 모듈은 키 자체가 없다 — 빈 칸을 카드가 0 으로 오해하지 않게', () => {
    const silent: PluginPromptModule = { id: 'x', buildBlock: () => 'block' };
    expect(silent.survey).toBeUndefined();
  });
});
