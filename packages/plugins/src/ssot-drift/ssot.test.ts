/**
 * §5.11 v4.57 → v4.67 — SSOT 집행 판정 고정.
 *
 * 이 카드는 "세기만 하고 아무 일도 안 일어난다"가 문제였다. 그러니 여기서 고정해야 하는 것은
 * **켜면 실제로 무엇이 프롬프트에 실리는가**다 — 문서를 못 찾았을 때 침묵하지 않는 것까지 포함해서.
 *
 * v4.67 이 더한 것은 전부 "실측이 현실을 못 따라가던" 자리다: 프로젝트가 지정한 경로, 빈 문서,
 * 문서가 없을 때의 경쟁 문서 경고, 종속을 명시한 문서의 해소, 그리고 이름값인 **어긋남**.
 */
import { describe, it, expect } from 'vitest';
import type { PluginPromptContext } from '../sdk/index.js';
import {
  buildSsotPromptBlock,
  surveySsot,
  surveySsotFacts,
  readSsotConfig,
  hasSubstance,
  SSOT_CONFIG_PATH,
  SSOT_DOC_CANDIDATES,
  SSOT_STALE_DAYS,
} from './ssot.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-08-04T00:00:00Z');

/** 내용이 있는 문서 — 문턱(400자·헤딩 2)을 넘는 최소 형태. */
const REAL_DOC = `# 기획\n\n## 1. 개요\n${'이 프로젝트의 기획 원칙. '.repeat(40)}\n\n## Change Log\n- 2026-08-01 첫 줄\n`;

function ctxWith(
  files: Record<string, string>,
  mtimes?: Record<string, number>,
): PluginPromptContext {
  return {
    projectPath: '/repo',
    cwd: '/repo',
    agentId: 'agent-1',
    agentLabel: 'Agent',
    customCreated: true,
    fileExists: (p) => Object.prototype.hasOwnProperty.call(files, p),
    readFile: (p) => files[p] ?? null,
    ...(mtimes ? { fileMtimeMs: (p: string) => mtimes[p] ?? null } : {}),
  };
}

describe('surveySsot', () => {
  it('권위 순서대로 첫 후보를 SSOT 로 잡는다', () => {
    const survey = surveySsot(ctxWith({ 'docs/SCENARIO.md': REAL_DOC, 'SSOT.md': REAL_DOC }));
    expect(survey.doc).toBe('docs/SCENARIO.md');
  });

  it('후보가 하나도 없으면 doc 은 null', () => {
    expect(surveySsot(ctxWith({ 'README.md': 'hi' })).doc).toBeNull();
  });

  it('Change Log 절 유무를 문서 본문에서 실제로 읽는다', () => {
    expect(surveySsot(ctxWith({ 'SSOT.md': '# 기획\n\n## Change Log\n' })).hasChangeLog).toBe(true);
    expect(surveySsot(ctxWith({ 'SSOT.md': '# 기획\n\n## 변경 이력\n' })).hasChangeLog).toBe(true);
    expect(surveySsot(ctxWith({ 'SSOT.md': '# 기획\n본문만 있다' })).hasChangeLog).toBe(false);
  });

  it('지시 공급원 수 = SSOT + 경쟁 문서', () => {
    const survey = surveySsot(ctxWith({ 'docs/SCENARIO.md': REAL_DOC, 'CLAUDE.md': '#', 'AGENTS.md': '#' }));
    expect(survey.rivals).toEqual(['CLAUDE.md', 'AGENTS.md']);
    expect(survey.sources).toBe(3);
  });

  it('GDD 계열도 후보다 — 이름 하나 때문에 집행이 통째로 헛돌면 안 된다', () => {
    expect(surveySsot(ctxWith({ 'docs/GDD.md': REAL_DOC })).doc).toBe('docs/GDD.md');
  });
});

describe('프로젝트가 지정한 경로 (.vibisual/ssot.json)', () => {
  it('지정한 문서가 기본 후보를 이긴다', () => {
    const survey = surveySsot(ctxWith({
      [SSOT_CONFIG_PATH]: JSON.stringify({ doc: 'docs/MY_PLAN.md' }),
      'docs/MY_PLAN.md': REAL_DOC,
      'docs/SCENARIO.md': REAL_DOC,
    }));
    expect(survey.doc).toBe('docs/MY_PLAN.md');
    expect(survey.configured).toBe('docs/MY_PLAN.md');
  });

  it('지정만 하고 파일이 없으면 "없음"이 아니라 configMissing 이다', () => {
    const ctx = ctxWith({ [SSOT_CONFIG_PATH]: JSON.stringify({ doc: 'docs/GDD.md' }) });
    const survey = surveySsot(ctx);
    expect(survey.doc).toBeNull();
    expect(survey.docState).toBe('configMissing');
    const block = buildSsotPromptBlock(ctx) ?? '';
    expect(block).toContain('docs/GDD.md');
    expect(block).toContain(SSOT_CONFIG_PATH);
  });

  it('후보·경쟁 문서도 프로젝트가 더할 수 있다', () => {
    const survey = surveySsot(ctxWith({
      [SSOT_CONFIG_PATH]: JSON.stringify({ candidates: ['docs/PLAN_B.md'], rivals: ['docs/OLD_RULES.md'] }),
      'docs/PLAN_B.md': REAL_DOC,
      'docs/OLD_RULES.md': '옛 규칙',
    }));
    expect(survey.doc).toBe('docs/PLAN_B.md');
    expect(survey.rivals).toContain('docs/OLD_RULES.md');
  });

  it('설정이 깨져 있어도 던지지 않고 없는 것으로 본다 — 파일 한 장이 집행을 통째로 끄면 안 된다', () => {
    const ctx = ctxWith({ [SSOT_CONFIG_PATH]: '{ 깨진 JSON', 'docs/SCENARIO.md': REAL_DOC });
    expect(readSsotConfig(ctx).doc).toBeNull();
    expect(surveySsot(ctx).doc).toBe('docs/SCENARIO.md');
  });
});

describe('빈 문서 (thin)', () => {
  it('0바이트·제목만 있는 파일은 SSOT 로 인정하지 않는다', () => {
    expect(hasSubstance('')).toBe(false);
    expect(hasSubstance('# 기획')).toBe(false);
    expect(hasSubstance(REAL_DOC)).toBe(true);
  });

  it('그 상태의 집행은 "근거로 쓰지 마라" 다 — 규율 여섯 줄을 실으면 없는 기획을 읽으러 간다', () => {
    const block = buildSsotPromptBlock(ctxWith({ 'docs/SSOT.md': '# 기획' })) ?? '';
    expect(block).toContain('내용이 비어 있다');
    expect(block).toContain('기획의 근거로 쓰지 않는다');
    // 정상 문서의 여섯 줄 규율이 섞여 나오면 안 된다.
    expect(block).not.toContain('Out of Scope');
  });

  it('본문이 충분하면 정상 규율로 간다', () => {
    expect(surveySsot(ctxWith({ 'docs/SSOT.md': REAL_DOC })).docState).toBe('ok');
  });
});

describe('경쟁 문서', () => {
  it('SSOT 가 있으면 누가 이기는지를 못 박는다', () => {
    const block = buildSsotPromptBlock(ctxWith({ 'SSOT.md': REAL_DOC, 'CLAUDE.md': '#' })) ?? '';
    expect(block).toContain('SSOT 가 이긴다');
    expect(block).toContain('CLAUDE.md');
  });

  it('SSOT 가 **없을 때도** 경쟁 문서를 경고한다 — 그때가 오히려 유일 권위가 되는 순간이다', () => {
    const block = buildSsotPromptBlock(ctxWith({ 'CLAUDE.md': '#', 'AGENTS.md': '#' })) ?? '';
    expect(block).toContain('CLAUDE.md');
    expect(block).toContain('기획서가 아니다');
  });

  it('본문이 SSOT 를 가리키면 정렬된 것으로 보고 경고에서 뺀다 — 끌 수 없는 경고는 무시된다', () => {
    const ctx = ctxWith({
      'docs/SCENARIO.md': REAL_DOC,
      'CLAUDE.md': '# 규칙\n\n기획 SSOT = docs/SCENARIO.md 를 먼저 읽어라.',
    });
    const survey = surveySsot(ctx);
    expect(survey.alignedRivals).toEqual(['CLAUDE.md']);
    expect(survey.rivals).toEqual([]);
    expect(survey.sources).toBe(1);
    expect(buildSsotPromptBlock(ctx) ?? '').toContain('정렬된 상태');
  });

  it('경쟁 문서가 아예 없으면 어긋남 경고를 붙이지 않는다', () => {
    const block = buildSsotPromptBlock(ctxWith({ 'SSOT.md': REAL_DOC })) ?? '';
    expect(block).not.toContain('SSOT 가 이긴다');
    expect(block).not.toContain('정렬된 상태');
  });
});

describe('어긋남 실측 (이름값)', () => {
  it('문서가 저장소 활동보다 문턱 이상 뒤처지면 경고 줄이 붙는다', () => {
    const ctx = ctxWith(
      { 'docs/SSOT.md': REAL_DOC },
      { 'docs/SSOT.md': NOW - 40 * DAY, '.git/logs/HEAD': NOW },
    );
    const survey = surveySsot(ctx);
    expect(survey.driftDays).toBe(40);
    expect(survey.stale).toBe(true);
    expect(buildSsotPromptBlock(ctx) ?? '').toContain('40일');
  });

  it('문턱 안이면 조용하다 — 매 턴 붙는 경고는 곧 무시된다', () => {
    const ctx = ctxWith(
      { 'docs/SSOT.md': REAL_DOC },
      { 'docs/SSOT.md': NOW - 1 * DAY, '.git/logs/HEAD': NOW },
    );
    expect(surveySsot(ctx).stale).toBe(false);
    expect(buildSsotPromptBlock(ctx) ?? '').not.toContain('뒤처져');
  });

  it('시각 탐침이 없는 호스트에서는 그 축만 접는다 — 없는 값을 0 으로 그리지 않는다', () => {
    const survey = surveySsot(ctxWith({ 'docs/SSOT.md': REAL_DOC }));
    expect(survey.driftDays).toBeNull();
    expect(survey.stale).toBe(false);
    expect(surveySsotFacts(ctxWith({ 'docs/SSOT.md': REAL_DOC })).driftDays).toBeUndefined();
  });

  it('문턱은 상수 하나로 고정돼 있다 — 화면과 프롬프트가 다른 자를 쓰면 안 된다', () => {
    const ctx = ctxWith(
      { 'docs/SSOT.md': REAL_DOC },
      { 'docs/SSOT.md': NOW - SSOT_STALE_DAYS * DAY, '.git/logs/HEAD': NOW },
    );
    expect(surveySsot(ctx).stale).toBe(true);
  });
});

describe('buildSsotPromptBlock', () => {
  it('SSOT 를 찾으면 그 경로를 박아 규율을 싣는다', () => {
    const block = buildSsotPromptBlock(ctxWith({ 'docs/SCENARIO.md': REAL_DOC })) ?? '';
    expect(block).toContain('docs/SCENARIO.md');
    expect(block).toContain('대체');
    expect(block).toContain('Out of Scope');
  });

  it('Change Log 절이 없으면 "절을 만들어라"로 문구가 갈린다', () => {
    const noLog = REAL_DOC.replace('## Change Log', '## 부록');
    const withLog = buildSsotPromptBlock(ctxWith({ 'SSOT.md': REAL_DOC })) ?? '';
    const without = buildSsotPromptBlock(ctxWith({ 'SSOT.md': noLog })) ?? '';
    expect(withLog).not.toBe(without);
    expect(without).toContain('절을 만들고');
  });

  it('SSOT 가 없어도 침묵하지 않는다 — "먼저 물어라"가 그 상태의 집행이다', () => {
    const block = buildSsotPromptBlock(ctxWith({ 'README.md': '#' })) ?? '';
    expect(block).toContain('묻는다');
    // 어디를 찾아봤는지 알려 줘야 사용자가 "왜 못 찾았지"를 판단할 수 있다.
    for (const candidate of SSOT_DOC_CANDIDATES) expect(block).toContain(candidate);
    // 그리고 그 자리에서 **직접 지정하는 길**을 알려 준다.
    expect(block).toContain(SSOT_CONFIG_PATH);
  });
});

describe('카드가 그리는 실측', () => {
  it('집행이 본 것과 같은 값이 얕은 한 벌로 나온다', () => {
    const facts = surveySsotFacts(ctxWith(
      { 'docs/SCENARIO.md': REAL_DOC, 'CLAUDE.md': '#' },
      { 'docs/SCENARIO.md': NOW - 3 * DAY, '.git/logs/HEAD': NOW },
    ));
    expect(facts.doc).toBe('docs/SCENARIO.md');
    expect(facts.docState).toBe('ok');
    expect(facts.rivals).toEqual(['CLAUDE.md']);
    expect(facts.sources).toBe(2);
    expect(facts.driftDays).toBe(3);
    expect(facts.stale).toBe(false);
    expect(facts.configPath).toBe(SSOT_CONFIG_PATH);
  });
});
