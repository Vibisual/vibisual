/**
 * §5.11 v4.57 — 집행 배럴의 관문 고정.
 *
 * 이 층이 생기기 전 `PLUGIN_SERVER_MODULES` 는 비어 있어서 그 안의 관문이 **한 번도 실행된 적이 없었다**
 * (그래서 잘못돼 있어도 타입체크·테스트 어디에도 안 걸렸다). 같은 일을 반복하지 않으려고, 집행 경로는
 * 모듈이 하나뿐인 지금부터 행동을 못 박는다 — 특히 **안 켠 프로젝트에서는 한 글자도 늘지 않는다**를.
 */
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

/**
 * §5.5 #17-44 ⑧(d) — 손잡이가 자기 화면에 있는 카드들. **켬 집합과 무관하게 늘 통과한다.**
 *
 * 목록을 손으로 적지 않고 등록부에서 뽑는다 — 적어 두면 다음에 이 축을 쓰는 카드가 늘었을 때
 * 이 파일만 조용히 낡고, 그때 기대치는 "왜 하나 더 나오지"로 읽힌다.
 */
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
   * §5.5 #17-44 ⑧(d) — **예외는 손잡이가 자기 화면에 있는 카드(`ownToggle`)뿐**이다.
   *
   * 그 카드는 켬 집합을 묻지 않고 늘 통과한다 — 뒤에서 그 기능 자신의 스위치가 다시 판정하기 때문이다.
   * 관문을 여기서 한 번 더 두면 "뷰에서 켰는데 프롬프트엔 안 실린다"가 만들어진다. 대신 **프롬프트가
   * 한 글자도 안 느는 것**(위 "아무것도 안 켜면 빈 문자열")은 그대로다 — 꺼진 층이면 그 카드의
   * `buildBlock` 자신이 `undefined` 를 낸다.
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

/**
 * §5.11 v4.65 — 실측 수집. 카드가 집행과 **같은 것을 세게** 하는 통로이므로, 관문(켠 프로젝트만)이
 * 블록 조립과 동일하다는 것과 한 장이 던져도 나머지가 산다는 것을 함께 못 박는다.
 */
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
