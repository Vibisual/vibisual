/**
 * §5.11 정독 게이트 — 판정 고정.
 *
 * 이 기능의 값어치는 전부 **"읽었다"가 참인지 기계로 갈리는가**에 달려 있다. 그러니 여기서 고정할 것도
 * 그것이다 — 절을 어떻게 자르는지, 무엇을 필수로 지목하는지, 어떤 열람을 정독으로 안 쳐 주는지,
 * 지어낸 인용이 실제로 걸리는지. 그리고 **오탐이 이 기능의 유일한 실패 방식**이므로 "아무 지목도
 * 없을 때 조용한가"를 같은 무게로 고정한다.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { PluginPromptContext, SpecIndex, SpecReadSpan, SpecReadingSettings, SpecUnit } from '../sdk/index.js';
import {
  SPEC_DOC_FILE_MAX,
  SPEC_ITEM_LABEL_MAX,
  SPEC_RARE_TITLE_MIN_UNITS,
  SPEC_UNIT_TOKEN_MAX,
  estimateTokens,
} from '../sdk/index.js';
import {
  buildSpecIndex,
  buildSpecIndexCached,
  buildSpecPromptBlock,
  buildSpecSystemRules,
  classifySpans,
  clearSpecIndexCache,
  computeTrust,
  countRequirements,
  evaluateSpecReading,
  matchGlob,
  normalizeSpecSettings,
  readSpecSettings,
  routeRequiredUnits,
  slugify,
  spanFromGrep,
  spanFromRead,
  splitUnits,
  surveySpecFacts,
  extractCitations,
  tokenize,
  unitAt,
  verifyCitation,
} from './spec.js';

const BATTLE = [
  '# 전투',
  '',
  '## REQ-14 데미지 공식',
  '',
  '데미지는 공격력에서 방어력을 뺀 값이어야 한다.',
  '치명타는 2배로 계산해야 한다.',
  '',
  '## REQ-15 사거리',
  '',
  '근접 무기는 2m 를 넘지 마라.',
  '',
  '## 부록',
  '',
  '```',
  '# 이건 헤딩이 아니다',
  '```',
  '',
  '끝.',
].join('\n');

const UI = ['# 화면', '', '## 인벤토리 격자', '', '칸은 6x5 로 고정한다.'].join('\n');

/** 문서 몇 장을 들고 있는 프로젝트. 필요한 탐침만 갖춘 최소 호스트다. */
function makeCtx(over: Partial<PluginPromptContext> = {}): PluginPromptContext {
  const files: Record<string, string> = {
    'docs/기획/전투.md': BATTLE,
    'docs/기획/화면.md': UI,
    // §5.5 #17-44 ⑧ — 기본이 **꺼짐**이라 판정 테스트는 켜 놓고 들어간다(팀이 저장소 파일로 켠 모양).
    //   꺼진 쪽은 아래 「켬/끔 3층」 절이 따로 본다.
    '.vibisual/spec.json': '{"enabledProject":true}',
  };
  return {
    projectPath: 'C:/repo/game',
    cwd: 'C:/repo/game',
    agentId: 'agent-1',
    agentLabel: 'Agent',
    subAgentId: 'sub-1',
    customCreated: true,
    platform: 'win32',
    fileExists: (p) => p in files,
    readFile: (p) => files[p] ?? null,
    // 설정 파일은 훑는 대상이 아니다 — `listFiles` 는 기획 문서 뿌리만 답한다.
    listFiles: (dir) => (dir === 'docs' ? Object.keys(files).filter((f) => f.startsWith('docs/')) : []),
    ...over,
  };
}

beforeEach(() => clearSpecIndexCache());

describe('절 자르기', () => {
  it('헤딩마다 하나씩, 겹치지 않게 자른다 — 겹치면 같은 줄이 두 번 세어져 커버율이 1을 넘는다', () => {
    const units = splitUnits('docs/기획/전투.md', BATTLE);
    const ranges = units.map((u) => [u.startLine, u.endLine]);
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i]?.[0] ?? 0).toBeGreaterThan(ranges[i - 1]?.[1] ?? 0);
    }
  });

  it('본문의 REQ 토큰을 id 로 쓴다 — 업계의 역추적 관행과 그대로 맞물린다', () => {
    const units = splitUnits('docs/기획/전투.md', BATTLE);
    expect(units.map((u) => u.id)).toContain('REQ-14');
    expect(units.map((u) => u.id)).toContain('REQ-15');
  });

  it('토큰이 없으면 `파일#슬러그` 로 떨어지고, 그 id 는 플랫폼과 무관하다', () => {
    const units = splitUnits('docs/기획/전투.md', BATTLE);
    const 부록 = units.find((u) => u.title === '부록');
    expect(부록?.id).toBe('docs/기획/전투.md#부록');
  });

  it('코드 울타리 안의 `#` 은 헤딩이 아니다 — 예제 한 줄이 절을 갈라 놓으면 안 된다', () => {
    expect(splitUnits('x.md', BATTLE).map((u) => u.title)).not.toContain('이건 헤딩이 아니다');
  });

  it('frontmatter 는 본문이 아니다', () => {
    const text = ['---', 'title: x', '# 가짜', '---', '', '# 진짜', '', '본문.'].join('\n');
    expect(splitUnits('x.md', text).map((u) => u.title)).toEqual(['진짜']);
  });

  it('헤딩이 하나도 없는 문서는 통째로 절 하나다 — 안 세면 그 문서는 영영 안 걸린다', () => {
    const units = splitUnits('notes.md', '그냥 줄글.\n두 줄째.');
    expect(units).toHaveLength(1);
    expect(units[0]?.startLine).toBe(1);
  });

  it('바로 다음 헤딩이 붙은 빈 구조 헤딩은 세지 않는다 — 읽을 것이 없는 절을 걸면 그게 오탐이다', () => {
    expect(splitUnits('x.md', '# 겉\n## 속\n\n내용.').map((u) => u.title)).toEqual(['속']);
  });

  it('같은 id 가 두 번 나오면 갈라 준다 — 겹치면 열람 판정이 엉뚱한 절에 붙는다', () => {
    const text = '# A\n\nREQ-9 어쩌고 한다.\n\n# B\n\nREQ-9 저쩌고 한다.';
    expect(splitUnits('x.md', text).map((u) => u.id)).toEqual(['REQ-9', 'REQ-9~2']);
  });

  it('요구사항 표지를 세어 절의 무게를 매긴다', () => {
    expect(countRequirements('이렇게 해야 한다. 저것은 금지.')).toBeGreaterThan(0);
    expect(countRequirements('그냥 설명문')).toBe(0);
  });

  it('슬러그는 제목에서 나오고 빈 제목도 이름을 갖는다', () => {
    expect(slugify('REQ 14 데미지 공식')).toBe('req-14-데미지-공식');
    expect(slugify('###')).toBe('section');
  });
});

describe('색인', () => {
  it('뿌리를 훑어 문서 전부를 절로 자른다', () => {
    const index = buildSpecIndex(makeCtx(), normalizeSpecSettings({}));
    expect(index.docCount).toBe(2);
    expect(index.units.length).toBeGreaterThan(3);
    expect(index.roots).toEqual(['docs']);
  });

  it('같은 파일이 두 뿌리에 걸려도 한 번만 센다', () => {
    const ctx = makeCtx({ listFiles: () => ['docs/기획/전투.md'] });
    const index = buildSpecIndex(ctx, normalizeSpecSettings({}));
    expect(index.docCount).toBe(1);
  });

  it('`listFiles` 가 없는 옛 호스트에서는 그 축만 접힌다 — 던지지 않는다', () => {
    const ctx = makeCtx({ listFiles: undefined });
    expect(() => buildSpecIndex(ctx, normalizeSpecSettings({}))).not.toThrow();
    expect(buildSpecIndex(ctx, normalizeSpecSettings({})).units).toEqual([]);
  });

  it('탐침이 던져도 나머지 뿌리는 그대로 훑는다', () => {
    const ctx = makeCtx({
      listFiles: (dir) => {
        if (dir === '.kiro/specs') throw new Error('boom');
        return dir === 'docs' ? ['docs/기획/전투.md'] : [];
      },
    });
    expect(buildSpecIndex(ctx, normalizeSpecSettings({})).docCount).toBe(1);
  });

  it('같은 턴에 두 번 불러도 문서를 두 번 읽지 않는다', () => {
    let reads = 0;
    const ctx = makeCtx({
      readFile: (p) => {
        reads++;
        return p === 'docs/기획/전투.md' ? BATTLE : p === 'docs/기획/화면.md' ? UI : null;
      },
    });
    const s = normalizeSpecSettings({});
    buildSpecIndexCached(ctx, s, 1_000);
    const once = reads;
    buildSpecIndexCached(ctx, s, 1_100);
    expect(reads).toBe(once);
  });
});

describe('설정', () => {
  it('바깥에서 온 값을 계약 안으로 접는다', () => {
    const s = normalizeSpecSettings({
      strength: 'nope' as never,
      maxRequired: 999,
      stopRetries: 99,
      roots: ['docs\\기획\\', '', '  '],
      idPattern: '([',
    });
    expect(s.strength).toBe('observe');
    expect(s.maxRequired).toBeLessThanOrEqual(8);
    expect(s.stopRetries).toBeLessThanOrEqual(3);
    expect(s.roots).toEqual(['docs/기획']);
    expect(s.idPattern).toBeUndefined();
  });

  it('프로젝트 파일이 바닥이고 사용자 설정이 덮는다 — 안 그러면 껐는데 계속 막힌다', () => {
    const withFile = makeCtx({
      readFile: (p) => (p === '.vibisual/spec.json' ? '{"strength":"enforce"}' : null),
    });
    expect(readSpecSettings(withFile).strength).toBe('enforce');
    expect(readSpecSettings({ ...withFile, specSettings: { strength: 'observe' } }).strength).toBe('observe');
  });

  it('깨진 설정 파일 하나 때문에 집행이 빠지지 않는다', () => {
    const broken = makeCtx({ readFile: (p) => (p === '.vibisual/spec.json' ? '{ oops' : null) });
    expect(readSpecSettings(broken).strength).toBe('observe');
  });
});

describe('라우팅', () => {
  const index = () => buildSpecIndex(makeCtx(), normalizeSpecSettings({}));

  it('아무 축에도 안 걸리면 빈 목록이다 — 억지 지목이 곧 오탐이다', () => {
    expect(routeRequiredUnits(index(), makeCtx(), normalizeSpecSettings({}))).toEqual([]);
  });

  it('프롬프트가 절 id 를 부르면 그 절이 걸린다', () => {
    const ctx = makeCtx({ promptText: 'REQ-14 대로 데미지 다시 계산해줘' });
    const req = routeRequiredUnits(index(), ctx, normalizeSpecSettings({}));
    expect(req[0]?.unitId).toBe('REQ-14');
    expect(req[0]?.via).toBe('prompt');
  });

  it('프롬프트가 문서를 통째로 부르면 그 문서의 절들이 걸린다', () => {
    const ctx = makeCtx({ promptText: 'docs/기획/화면.md 보고 인벤토리 만들어' });
    const ids = routeRequiredUnits(index(), ctx, normalizeSpecSettings({})).map((r) => r.file);
    expect(ids).toContain('docs/기획/화면.md');
  });

  it('명시 매핑이 프롬프트보다 세다 — 사용자가 적은 것이 가장 정확하다', () => {
    const ctx = makeCtx({
      promptText: '인벤토리 격자 손볼게',
      touchedPaths: ['src/combat/damage.ts'],
    });
    const settings = normalizeSpecSettings({ routes: [{ glob: 'src/combat/**', specs: ['REQ-14'] }] });
    const req = routeRequiredUnits(index(), ctx, settings);
    expect(req[0]?.unitId).toBe('REQ-14');
    expect(req[0]?.via).toBe('route');
  });

  it('상한을 넘겨 지목하지 않는다 — 전집을 읽으라는 요구는 실패한다', () => {
    const ctx = makeCtx({ promptText: '전투 사거리 데미지 화면 인벤토리 격자 부록' });
    const req = routeRequiredUnits(index(), ctx, normalizeSpecSettings({ maxRequired: 2 }));
    expect(req).toHaveLength(2);
  });

  it('면제한 절은 필수로 걸려도 면제로 표시된다', () => {
    const ctx = makeCtx({ promptText: 'REQ-14 고쳐줘' });
    const req = routeRequiredUnits(index(), ctx, normalizeSpecSettings({ waived: ['REQ-14'] }));
    expect(req[0]?.status).toBe('waived');
  });

  it('짧은 파일 이름은 경로 축으로 안 센다 — `ide` 같은 조각이 온 제목에 걸린다', () => {
    const ctx = makeCtx({ touchedPaths: ['src/ui.ts'] });
    expect(routeRequiredUnits(index(), ctx, normalizeSpecSettings({}))).toEqual([]);
  });
});

describe('glob', () => {
  it('`**` 는 폴더 경계를 넘고 `*` 는 넘지 않는다', () => {
    expect(matchGlob('src/**/*.ts', 'src/a/b/c.ts', 'linux')).toBe(true);
    expect(matchGlob('src/*.ts', 'src/a/b.ts', 'linux')).toBe(false);
    expect(matchGlob('src/**', 'src/a.ts', 'linux')).toBe(true);
    expect(matchGlob('a/**/b', 'a/b', 'linux')).toBe(true);
  });

  it('Linux 에서는 케이스가 접히지 않는다 — 실재하는 다른 파일이다', () => {
    expect(matchGlob('Src/**', 'src/a.ts', 'linux')).toBe(false);
    expect(matchGlob('Src/**', 'src/a.ts', 'win32')).toBe(true);
  });

  it('역슬래시 경로도 같은 것으로 본다', () => {
    expect(matchGlob('src/**', 'src\\a\\b.ts', 'win32')).toBe(true);
  });
});

describe('열람 영수증', () => {
  const unit = { file: 'docs/기획/전투.md', startLine: 10, endLine: 19 };
  const span = (over: Partial<SpecReadSpan>): SpecReadSpan => ({
    file: 'docs/기획/전투.md', fromLine: 10, toLine: 19, tool: 'Read', partial: false, at: 1, ...over,
  });

  it('절 구간을 다 열면 커버율이 1 이다', () => {
    expect(classifySpans(unit, { 'docs/기획/전투.md': [span({})] }, 'win32').covered).toBe(1);
  });

  it('겹치는 구간을 두 번 세지 않는다 — 두 번 세면 커버율이 1을 넘는다', () => {
    const spans = { 'docs/기획/전투.md': [span({ toLine: 15 }), span({ fromLine: 12 })] };
    expect(classifySpans(unit, spans, 'win32').covered).toBe(1);
  });

  it('부분 열람만 있으면 정독으로 안 친다 — 이 게이트가 막으려는 바로 그 동작이다', () => {
    const r = classifySpans(unit, { 'docs/기획/전투.md': [span({ partial: true })] }, 'win32');
    expect(r.covered).toBe(0);
    expect(r.partial).toBe(true);
  });

  it('다른 파일의 열람은 세지 않는다', () => {
    expect(classifySpans(unit, { 'docs/기획/화면.md': [span({})] }, 'win32').covered).toBe(0);
  });

  it('영수증이 아예 없으면 0 이다', () => {
    expect(classifySpans(unit, undefined, 'win32')).toEqual({ covered: 0, partial: false });
  });

  it('`offset` 없이 긴 파일을 통째로 Read 하면 부분 열람으로 강등된다', () => {
    expect(spanFromRead('a.md', 1, { totalLines: 9_000 }).partial).toBe(true);
    expect(spanFromRead('a.md', 1, { totalLines: 100 }).partial).toBe(false);
    expect(spanFromRead('a.md', 1, { offset: 10, limit: 50, totalLines: 9_000 }).partial).toBe(false);
  });

  it('`Grep` 은 매치 앞뒤 몇 줄이라 애초에 정독이 아니다', () => {
    const s = spanFromGrep('a.md', 100, 1);
    expect(s.partial).toBe(true);
    expect(s.fromLine).toBeLessThan(100);
    expect(s.toLine).toBeGreaterThan(100);
  });
});

describe('인용 확증', () => {
  const cite = {
    unitId: 'REQ-14',
    file: 'docs/기획/전투.md',
    fromLine: 3,
    toLine: 7,
    quote: '데미지는 공격력에서 방어력을 뺀 값이어야 한다.',
    verified: false,
    checkedAt: 0,
  };

  it('원문에 있는 문장이면 통과한다', () => {
    expect(verifyCitation(makeCtx(), cite).verified).toBe(true);
  });

  it('지어낸 문장은 걸린다 — 이 축이 없으면 인용도 지어낼 수 있다', () => {
    const bad = verifyCitation(makeCtx(), { ...cite, quote: '데미지는 무조건 999 로 고정해야 한다.' });
    expect(bad.verified).toBe(false);
    expect(bad.failure).toBe('not-found');
  });

  it('줄 범위 밖을 가리키면 걸린다', () => {
    expect(verifyCitation(makeCtx(), { ...cite, fromLine: 900, toLine: 950 }).failure).toBe('out-of-range');
  });

  it('없는 파일은 걸린다', () => {
    expect(verifyCitation(makeCtx(), { ...cite, file: 'docs/없다.md' }).failure).toBe('file-missing');
  });

  it('너무 짧은 인용은 근거로 안 센다 — 아무 문장에나 걸린다', () => {
    expect(verifyCitation(makeCtx(), { ...cite, quote: '데미지' }).failure).toBe('not-found');
  });

  it('줄바꿈·들여쓰기 때문에 참인 인용이 거짓으로 떨어지지 않는다', () => {
    const wrapped = { ...cite, quote: '  데미지는 공격력에서\n  방어력을 뺀 값이어야 한다.  ' };
    expect(verifyCitation(makeCtx(), wrapped).verified).toBe(true);
  });
});

describe('신뢰도', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    unitId: 'REQ-14', title: 't', file: 'a.md', startLine: 1, endLine: 10,
    status: 'satisfied' as const, covered: 1, partial: false, via: 'prompt' as const, ...over,
  });

  it('넷을 따로 낸다 — 하나로 뭉개면 무엇이 부족한지 말하지 못한다', () => {
    const t = computeTrust([entry(), entry({ status: 'open', covered: 0.4 })], [], 0);
    expect(t.coverage).toBe(0.5);
    expect(t.depth).toBe(0.7);
    expect(t.citation).toBe(0);
    expect(t.freshness).toBe(1);
  });

  it('면제한 절은 분모에서 빠진다 — 안 빼면 면제가 곧 감점이 된다', () => {
    expect(computeTrust([entry(), entry({ status: 'waived', covered: 0 })], [], 0).coverage).toBe(1);
  });

  it('인용 대조 실패가 그대로 비율에 남는다', () => {
    const cites = [
      { unitId: 'a', file: 'a.md', fromLine: 1, toLine: 2, quote: 'x', verified: true, checkedAt: 0 },
      { unitId: 'b', file: 'a.md', fromLine: 1, toLine: 2, quote: 'y', verified: false, checkedAt: 0 },
    ];
    const t = computeTrust([entry()], cites, 0);
    expect(t.citation).toBe(0.5);
    expect(t.citationsFailed).toBe(1);
  });

  it('필수가 없으면 빚도 없다 — 0/0 을 0% 로 그리면 거짓이 된다', () => {
    expect(computeTrust([], [], 0).coverage).toBe(1);
  });
});

describe('한데 묶기 · 집행 블록', () => {
  it('열람 영수증이 있으면 그 절이 충족으로 바뀐다', () => {
    const ctx = makeCtx({
      promptText: 'REQ-14 데미지 공식 확인',
      readingSpans: { 'docs/기획/전투.md': [{ file: 'docs/기획/전투.md', fromLine: 1, toLine: 40, tool: 'Read', partial: false, at: 2 }] },
    });
    const { required, trust } = evaluateSpecReading(ctx);
    expect(required[0]?.status).toBe('satisfied');
    expect(trust.coverage).toBe(1);
  });

  it('읽은 뒤에 문서가 바뀌면 신선도가 깎인다 — 낡은 근거가 초록인 것이 가장 위험하다', () => {
    const ctx = makeCtx({
      promptText: 'REQ-14 확인',
      readingSpans: { 'docs/기획/전투.md': [{ file: 'docs/기획/전투.md', fromLine: 1, toLine: 40, tool: 'Read', partial: false, at: 100 }] },
      fileMtimeMs: () => 200,
    });
    expect(evaluateSpecReading(ctx).trust.freshness).toBe(0);
  });

  it('색인이 비면 어디를 훑을지 물으라고 시킨다 — 침묵하면 켠 뜻이 없다', () => {
    const block = buildSpecPromptBlock(makeCtx({ listFiles: undefined })) ?? '';
    expect(block).toContain('.vibisual/spec.json');
  });

  it('지목이 없는 턴에는 필수 목록을 만들지 않는다 — 매 턴 잔소리가 곧 오탐이다', () => {
    const block = buildSpecPromptBlock(makeCtx()) ?? '';
    expect(block).not.toContain('필수 절');
  });

  it('지목이 있으면 절과 줄 범위를 그대로 적는다 — 어디를 열라는지가 블록에 있어야 한다', () => {
    const block = buildSpecPromptBlock(makeCtx({ promptText: 'REQ-14 고쳐줘' })) ?? '';
    expect(block).toContain('REQ-14');
    expect(block).toContain('docs/기획/전투.md:');
  });

  it('강도에 따라 무슨 일이 일어나는지 말한다 — 안 말하면 막힌 이유를 모른다', () => {
    const warn = buildSpecPromptBlock(makeCtx({ promptText: 'REQ-14 고쳐줘', specSettings: { strength: 'warn' } })) ?? '';
    const block = buildSpecPromptBlock(makeCtx({ promptText: 'REQ-14 고쳐줘', specSettings: { strength: 'enforce' } })) ?? '';
    expect(warn).toContain('되돌려');
    expect(block).toContain('거부');
  });

  it('규칙 줄은 상한을 넘지 않는다 — 길어진 지시는 읽히지 않는다', () => {
    for (const ctx of [makeCtx(), makeCtx({ listFiles: undefined }), makeCtx({ promptText: 'REQ-14 고쳐줘' })]) {
      const rules = (buildSpecPromptBlock(ctx) ?? '').split('\n').filter((l) => l.startsWith('- '));
      expect(rules.length).toBeLessThanOrEqual(6);
    }
  });

  it('실측은 얕은 값만 낸다 — 카드가 그대로 한 줄로 그릴 수 있어야 한다', () => {
    for (const v of Object.values(surveySpecFacts(makeCtx({ promptText: 'REQ-14' })))) {
      const ok = typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
        || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
      expect(ok, JSON.stringify(v)).toBe(true);
    }
  });

  it('실측과 블록이 같은 판정에서 나온다 — 갈리면 화면은 초록인데 게이트가 막는다', () => {
    const ctx = makeCtx({ promptText: 'REQ-14 고쳐줘' });
    const facts = surveySpecFacts(ctx);
    const block = buildSpecPromptBlock(ctx) ?? '';
    expect(block).toContain(`${facts.satisfied}/${facts.requiredTotal}`);
  });

  it('탐침이 던져도 판정은 살아남는다 — 프롬프트 조립은 실행 경로 한복판이다', () => {
    const hostile = makeCtx({
      readFile: () => {
        throw new Error('boom');
      },
    });
    expect(() => buildSpecPromptBlock(hostile)).not.toThrow();
  });
});

describe('낱말 자르기', () => {
  it('붙어 있어야 뜻이 되는 것은 붙여 둔다', () => {
    expect(tokenize('REQ-14 와 docs/전투.md 를 봐')).toContain('REQ-14');
    expect(tokenize('REQ-14 와 docs/전투.md 를 봐')).toContain('docs/전투.md');
  });

  it('한 글자는 세지 않는다 — 아무 제목에나 걸린다', () => {
    expect(tokenize('a b 가 나')).toEqual([]);
  });
});

describe('인용 뽑기', () => {
  const index = () => buildSpecIndex(makeCtx(), normalizeSpecSettings({}));

  it('시킨 형식(`파일:줄` "원문") 을 그대로 뽑는다 — 프롬프트와 파서가 갈리면 성실한 쪽이 벌받는다', () => {
    const text = '확인했습니다. `docs/기획/전투.md:5-6` "데미지는 공격력에서 방어력을 뺀 값이어야 한다."';
    const [c] = extractCitations(text, index(), 'win32');
    expect(c?.unitId).toBe('REQ-14');
    expect(c?.fromLine).toBe(5);
    expect(c?.toLine).toBe(6);
  });

  it('순서를 바꿔 쓴 것도 받는다 — 그 차이로 근거를 버리면 안 된다', () => {
    const text = '"근접 무기는 2m 를 넘지 마라." (docs/기획/전투.md:10)';
    const [c] = extractCitations(text, index(), 'win32');
    expect(c?.unitId).toBe('REQ-15');
  });

  it('같은 인용을 두 번 세지 않는다', () => {
    const one = '`docs/기획/전투.md:5` "데미지는 공격력에서 방어력을 뺀 값이어야 한다."';
    expect(extractCitations(`${one}\n${one}`, index(), 'win32')).toHaveLength(1);
  });

  it('색인에 없는 파일은 이 게이트가 말하는 근거가 아니다', () => {
    const text = '`src/combat.ts:10-20` "여기에 다 적혀 있습니다."';
    expect(extractCitations(text, index(), 'win32')).toEqual([]);
  });

  it('뽑은 인용은 그대로 대조에 걸린다 — 지어낸 것은 여기서 드러난다', () => {
    const good = extractCitations('`docs/기획/전투.md:5` "데미지는 공격력에서 방어력을 뺀 값이어야 한다."', index(), 'win32');
    const bad = extractCitations('`docs/기획/전투.md:5` "데미지는 언제나 999 로 고정해야 한다."', index(), 'win32');
    expect(verifyCitation(makeCtx(), good[0]!).verified).toBe(true);
    expect(verifyCitation(makeCtx(), bad[0]!).verified).toBe(false);
  });

  it('여러 절에 걸치면 가장 많이 겹치는 절로 붙인다', () => {
    const u = unitAt(index(), 'docs/기획/전투.md', 3, 6, 'win32');
    expect(u?.id).toBe('REQ-14');
  });
});

describe('켬/끔 3층 (§5.5 #17-44 ⑧)', () => {
  /** 층을 켠 ctx — 팀 파일이 아니라 **이 기기의 선택**(체크포인트)으로 켠 모양. */
  const withScope = (over: Partial<SpecReadingSettings>, ctxOver: Partial<PluginPromptContext> = {}) =>
    makeCtx({
      readFile: (p) => (p === '.vibisual/spec.json' ? null : null),
      specSettings: { ...normalizeSpecSettings({}), ...over },
      ...ctxOver,
    });

  it('아무 층도 안 켜면 프롬프트에 한 글자도 안 실린다 — 기본은 꺼짐이다', () => {
    const ctx = withScope({}, { promptText: 'REQ-14 고쳐줘' });
    expect(buildSpecPromptBlock(ctx)).toBeUndefined();
  });

  it('꺼져 있으면 실측도 안 낸다 — 카드는 0 이 아니라 "꺼짐"을 그려야 한다', () => {
    const facts = surveySpecFacts(withScope({}, { promptText: 'REQ-14 고쳐줘' }));
    expect(facts['specEnabled']).toBe(false);
    expect(facts['indexUnits']).toBeUndefined();
  });

  it('꺼진 층에서는 문서를 훑지도 않는다 — 매 턴 docs 를 도는 것만으로 서버가 멈칫한다', () => {
    let scanned = 0;
    const ctx = withScope({}, {
      promptText: 'REQ-14 고쳐줘',
      listFiles: (dir) => { scanned += 1; return dir === 'docs' ? ['docs/기획/전투.md'] : []; },
    });
    buildSpecPromptBlock(ctx);
    surveySpecFacts(ctx);
    expect(scanned).toBe(0);
  });

  it('프로젝트 층을 켜면 실린다', () => {
    const ctx = withScope({ enabledProject: true }, { promptText: 'REQ-14 고쳐줘' });
    expect(buildSpecPromptBlock(ctx)).toContain('기획 정독');
  });

  it('세션 층이 에이전트·프로젝트를 덮는다 — "이 프로젝트는 켜되 이 세션만 끄기"가 성립해야 한다', () => {
    const off = withScope(
      { enabledProject: true, enabledSessions: { 'sub-1': false } },
      { promptText: 'REQ-14 고쳐줘' },
    );
    expect(buildSpecPromptBlock(off)).toBeUndefined();
    // 같은 설정이라도 **다른 세션**은 그대로 켜져 있다(껐다는 사실이 옆 탭으로 새지 않는다).
    const other = withScope(
      { enabledProject: true, enabledSessions: { 'sub-1': false } },
      { promptText: 'REQ-14 고쳐줘', subAgentId: 'sub-2' },
    );
    expect(buildSpecPromptBlock(other)).toContain('기획 정독');
  });

  it('에이전트 층이 프로젝트를 덮고, 세션 층이 그 위를 덮는다', () => {
    const agentOff = withScope(
      { enabledProject: true, enabledAgents: { 'agent-1': false } },
      { promptText: 'REQ-14 고쳐줘' },
    );
    expect(buildSpecPromptBlock(agentOff)).toBeUndefined();
    const sessionOn = withScope(
      { enabledProject: true, enabledAgents: { 'agent-1': false }, enabledSessions: { 'sub-1': true } },
      { promptText: 'REQ-14 고쳐줘' },
    );
    expect(buildSpecPromptBlock(sessionOn)).toContain('기획 정독');
  });

  it('세션 id 를 모르는 호출에서는 그 층만 접히고 위 층이 답한다', () => {
    const ctx = withScope({ enabledProject: true, enabledSessions: { 'sub-1': false } }, {
      promptText: 'REQ-14 고쳐줘',
      subAgentId: undefined,
    });
    expect(buildSpecPromptBlock(ctx)).toContain('기획 정독');
  });

  it('저장소 파일(.vibisual/spec.json)로도 켤 수 있다 — 팀이 git 으로 공유하는 약속이다', () => {
    const ctx = makeCtx({ promptText: 'REQ-14 고쳐줘' }); // 기본 fixture 가 그 파일로 켜 둔다
    expect(buildSpecPromptBlock(ctx)).toContain('기획 정독');
  });

  it('전량 교체 정규화가 켠 층을 떨어뜨리지 않는다 — 강도만 바꾼 저장 한 번에 꺼지면 안 된다', () => {
    const kept = normalizeSpecSettings({
      strength: 'warn',
      enabledProject: true,
      enabledAgents: { 'agent-1': false },
      enabledSessions: { 'sub-1': true },
    });
    expect(kept.enabledProject).toBe(true);
    expect(kept.enabledAgents).toEqual({ 'agent-1': false });
    expect(kept.enabledSessions).toEqual({ 'sub-1': true });
  });

  it('손으로 적은 설정의 boolean 아닌 칸은 버린다', () => {
    // 캐스트로 억지 값을 만들지 않는다 — 실제로 이 자리에 오는 것은 손으로 적은 JSON 이다.
    const raw: Partial<SpecReadingSettings> = JSON.parse('{"strength":"observe","enabledAgents":{"ok":true,"bad":"yes"}}');
    expect(normalizeSpecSettings(raw).enabledAgents).toEqual({ ok: true });
  });
});


// ────────────────────────────────────────────────────────────────────────────
// §5.11 「정확도·비용 다듬기」 — 실측 뒤 여섯 손질의 회귀
// ────────────────────────────────────────────────────────────────────────────

/** 한글 n 글자 — 3바이트라 토큰 추정이 글자 수보다 크게 잡힌다(상한을 넘기려고 쓴다). */
const hangul = (n: number): string => '가나다라마바사아자차카타파하'.repeat(Math.ceil(n / 14)).slice(0, n);
/** 상한을 확실히 넘는 글자 수 — 토큰 어림이 바이트 기준이라 글자로는 이만큼이면 된다. */
const OVER = Math.ceil(SPEC_UNIT_TOKEN_MAX / 0.35 / 3) + 200;

describe('절 크기 상한 — 재분할', () => {
  it('상한 안의 절은 그대로 두고 토큰을 적는다', () => {
    const units = splitUnits('a.md', BATTLE);
    for (const u of units) {
      expect(u.tokens).toBeGreaterThan(0);
      expect(u.oversized).toBeUndefined();
    }
  });

  it('상한을 넘는 절은 항목 줄에서 다시 자른다 — 조각 제목은 부모 › 표지, id 는 부모id/슬러그', () => {
    const items = Array.from({ length: 6 }, (_, i) => `${i + 1}. 항목${i + 1} ${hangul(Math.ceil(OVER / 4))}`);
    const doc = ['## 큰 절', '', '머리말.', '', ...items.flatMap((l) => [l, ''])].join('\n');
    const units = splitUnits('big.md', doc);
    expect(units.length).toBeGreaterThan(1);
    expect(units.every((u) => (u.tokens ?? 0) <= SPEC_UNIT_TOKEN_MAX)).toBe(true);
    expect(units.some((u) => u.title.startsWith('큰 절 › 1. 항목1'))).toBe(true);
    expect(units.some((u) => u.id.startsWith('big.md#큰-절/1-항목1'))).toBe(true);
    // 조각은 겹치지 않고 절 전체를 덮는다 — 겹치면 커버율이 1을 넘는다.
    const sorted = [...units].sort((a, b) => a.startLine - b.startLine);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.startLine).toBe(sorted[i - 1]!.endLine + 1);
  });

  it('들여쓰기가 얕은 항목부터 자르고, 넘는 조각은 하위 항목으로 내려간다', () => {
    // 하위 넷의 합이 상한을 넘어야 한 단계 더 내려간다 — 하나는 상한 안이어야 거기서 멈춘다.
    const sub = (k: number): string[] => Array.from({ length: 4 }, (_, j) => `  - **(${'abcd'[j]}) 하위${k}-${j} ${hangul(Math.ceil(OVER / 3))}**`);
    const doc = ['## 절', '', '17-1. **상위 하나**', ...sub(1), '', '17-2. **상위 둘**', ...sub(2)].join('\n');
    const units = splitUnits('deep.md', doc);
    expect(units.every((u) => (u.tokens ?? 0) <= SPEC_UNIT_TOKEN_MAX)).toBe(true);
    expect(units.some((u) => u.title.includes('› 17-1. 상위 하나 › (a) 하위1-0'))).toBe(true);
  });

  it('항목이 없으면 문단을 상한 안으로 묶는다 — 제목에 (k/n) 이 붙는다', () => {
    // 다섯 문단의 합이 상한을 넘고, 둘씩은 상한 안 — 그래야 (1/3)·(2/3)·(3/3) 으로 묶인다.
    const paras = Array.from({ length: 5 }, (_, i) => `문단${i + 1} ${hangul(Math.ceil(OVER / 3))}`);
    const doc = ['## 산문', '', ...paras.flatMap((p) => [p, ''])].join('\n');
    const units = splitUnits('prose.md', doc);
    expect(units.length).toBeGreaterThan(1);
    expect(units[0]?.title).toBe(`산문 (1/${units.length})`);
    expect(units[0]?.id).toBe('prose.md#산문/p1');
    expect(units.every((u) => (u.tokens ?? 0) <= SPEC_UNIT_TOKEN_MAX)).toBe(true);
  });

  it('문단 하나가 상한을 넘으면 자르지 않고 oversized 로 표시한다 — 문장 가운데를 자르면 인용이 어긋난다', () => {
    const doc = ['## 한 덩이', '', hangul(OVER)].join('\n');
    const units = splitUnits('blob.md', doc);
    expect(units).toHaveLength(1);
    expect(units[0]?.oversized).toBe(true);
    expect(units[0]?.tokens).toBeGreaterThan(SPEC_UNIT_TOKEN_MAX);
  });

  it('코드 울타리 안의 번호 줄은 항목이 아니다', () => {
    const doc = ['## 코드', '', hangul(OVER), '', '```', '1. 코드 안', '2. 코드 안', '```'].join('\n');
    const units = splitUnits('code.md', doc);
    expect(units.every((u) => !u.title.includes('코드 안'))).toBe(true);
  });

  it('id 는 제목과 첫 줄에서만 찾는다 — 본문 깊숙한 REQ 언급이 남의 id 를 가로채면 열람이 엉뚱한 절에 붙는다', () => {
    const doc = ['## 사거리', '', '근접 무기는 2m 를 넘지 마라.', '', '데미지는 REQ-14 를 따른다.'].join('\n');
    const units = splitUnits('r.md', doc);
    expect(units[0]?.id).toBe('r.md#사거리');
  });
});

describe('라우팅 문턱 — 낱말 하나로는 안 걸린다', () => {
  const index = (): ReturnType<typeof buildSpecIndex> => buildSpecIndex(makeCtx(), normalizeSpecSettings({}));

  it('제목 낱말 하나만 겹치면 필수가 아니다 — 그것이 매 턴 무관한 절 8개를 세우던 자리다', () => {
    const req = routeRequiredUnits(index(), makeCtx({ promptText: '인벤토리 고쳐줘' }), normalizeSpecSettings({}));
    expect(req).toHaveLength(0);
  });

  it('서로 다른 낱말 둘이 낱말 시작에서 맞으면 걸린다', () => {
    const req = routeRequiredUnits(index(), makeCtx({ promptText: '인벤토리 격자 고쳐줘' }), normalizeSpecSettings({}));
    expect(req.map((r) => r.title)).toEqual(['인벤토리 격자']);
  });

  it('조사가 붙은 낱말은 조사를 떼고 본다 — 한국어 문장에서 나온 낱말이 제목에 붙어야 한다', () => {
    const req = routeRequiredUnits(index(), makeCtx({ promptText: '인벤토리의 격자를 늘려' }), normalizeSpecSettings({}));
    expect(req.map((r) => r.title)).toEqual(['인벤토리 격자']);
  });

  it('낱말 한가운데 부분 문자열은 안 센다 — 「기획정독」에 「정독」은 서지 않는다', () => {
    const ctx = makeCtx({
      promptText: '정독 게이트 확인',
      readFile: (p) => (p === 'docs/기획/화면.md' ? ['# 화면', '', '## 기획정독 게이트', '', '내용.'].join('\n') : null),
      listFiles: () => ['docs/기획/화면.md'],
    });
    const req = routeRequiredUnits(buildSpecIndex(ctx, normalizeSpecSettings({})), ctx, normalizeSpecSettings({}));
    expect(req).toHaveLength(0);
  });

  it('경로 축은 파일 이름이 통낱말로 서야 한다', () => {
    const ctx = makeCtx({
      readFile: (p) => (p === 'docs/기획/화면.md' ? ['# 화면', '', '## inventory-grid layout', '', '내용.', '', '## inventory-grids', '', '내용.'].join('\n') : null),
      listFiles: () => ['docs/기획/화면.md'],
      touchedPaths: ['src/ui/inventory-grid.tsx'],
    });
    const req = routeRequiredUnits(buildSpecIndex(ctx, normalizeSpecSettings({})), ctx, normalizeSpecSettings({}));
    expect(req.map((r) => r.title)).toEqual(['inventory-grid layout']);
  });

  it('id·문서 경로 직접 호출은 문턱과 무관하게 걸린다', () => {
    const req = routeRequiredUnits(index(), makeCtx({ promptText: 'REQ-15' }), normalizeSpecSettings({}));
    expect(req[0]?.unitId).toBe('REQ-15');
  });

  it('필수 항목에 절의 토큰과 큰 절 표시가 실린다', () => {
    const ctx = makeCtx({
      promptText: 'REQ-77',
      readFile: (p) => (p === 'docs/기획/화면.md' ? ['## REQ-77 큰 절', '', hangul(OVER)].join('\n') : null),
      listFiles: () => ['docs/기획/화면.md'],
    });
    const req = routeRequiredUnits(buildSpecIndex(ctx, normalizeSpecSettings({})), ctx, normalizeSpecSettings({}));
    expect(req[0]?.oversized).toBe(true);
    expect(req[0]?.tokens).toBeGreaterThan(SPEC_UNIT_TOKEN_MAX);
  });
});

describe('문서 상한 — 백업을 빼고 최근 것부터', () => {
  it('백업·아카이브 폴더와 .bak/_old/-copy 파일은 색인하지 않고 제외 수로만 센다', () => {
    const files: Record<string, string> = {
      'docs/plan.md': '## 계획\n\n본문.',
      'docs/backup/plan.md': '## 옛 계획\n\n본문.',
      'docs/Archive/2025/plan.md': '## 더 옛 계획\n\n본문.',
      'docs/plan.bak.md': '## 백업\n\n본문.',
      'docs/plan_old.md': '## 옛것\n\n본문.',
    };
    const ctx = makeCtx({ readFile: (p) => files[p] ?? null, listFiles: () => Object.keys(files) });
    const index = buildSpecIndex(ctx, normalizeSpecSettings({}));
    expect(index.units.map((u) => u.file)).toEqual(['docs/plan.md']);
    expect(index.excludedCount).toBe(4);
    expect(index.skippedCount).toBe(0);
  });

  it('상한을 넘으면 최근 수정 순으로 남기고, 못 실은 문서를 목록과 수로 적는다', () => {
    const n = SPEC_DOC_FILE_MAX + 3;
    const files: Record<string, string> = {};
    for (let i = 0; i < n; i++) files[`docs/d${String(i).padStart(3, '0')}.md`] = `## 절 ${i}\n\n본문 ${i}.`;
    // 이름이 뒤일수록 최근에 고쳤다 — 이름순 절단이면 최근 문서가 떨어진다.
    const ctx = makeCtx({
      readFile: (p) => files[p] ?? null,
      listFiles: () => Object.keys(files),
      fileMtimeMs: (p) => Number(p.slice('docs/d'.length, 'docs/d'.length + 3)),
    });
    const index = buildSpecIndex(ctx, normalizeSpecSettings({}));
    expect(index.docCount).toBe(SPEC_DOC_FILE_MAX);
    expect(index.truncated).toBe(true);
    expect(index.skippedCount).toBe(3);
    expect(index.skippedDocs).toEqual(['docs/d002.md', 'docs/d001.md', 'docs/d000.md']);
    expect(index.units.some((u) => u.file === `docs/d${n - 1}.md`)).toBe(true);
  });
});

describe('규칙은 시스템 프롬프트로 — 매 턴 블록은 목록만', () => {
  it('규칙이 시스템에 실렸으면 블록에 규칙 줄이 없고 강도 한 줄만 남는다', () => {
    const block = buildSpecPromptBlock(makeCtx({ promptText: 'REQ-14 고쳐줘', promptRulesInSystem: true })) ?? '';
    const rules = block.split('\n').filter((l) => l.startsWith('- '));
    expect(rules).toHaveLength(1);
    expect(block).toContain('docs/기획/전투.md:');
    expect(block).toContain('토큰');
  });

  it('규칙을 실을 자리가 없는 경로(훅 세션)는 종전대로 규칙까지 싣는다', () => {
    const block = buildSpecPromptBlock(makeCtx({ promptText: 'REQ-14 고쳐줘' })) ?? '';
    expect(block).toContain('통째 Read 는 부분 열람으로 강등된다');
  });

  it('시스템 규칙 한 벌은 블록에 실리던 규칙과 같은 문장이다 — 두 벌이면 자리마다 다른 규칙을 받는다', () => {
    const system = buildSpecSystemRules();
    const inline = buildSpecPromptBlock(makeCtx({ promptText: 'REQ-14 고쳐줘' })) ?? '';
    for (const line of system.split('\n').filter((l) => l.startsWith('- '))) expect(inline).toContain(line);
    expect(system).toContain('# 기획 정독 규칙');
  });

  it('지목이 없는 턴은 한 줄이다 — 색인이 살아 있다는 사실만 남긴다', () => {
    const block = buildSpecPromptBlock(makeCtx({ promptRulesInSystem: true })) ?? '';
    expect(block.trim().split('\n')).toHaveLength(1);
    expect(block).toContain('필수 절 없음');
  });

  it('블록에 절 id 를 싣지 않는다 — 인용은 파일:줄로 붙고 긴 id 는 토큰만 먹는다', () => {
    const block = buildSpecPromptBlock(makeCtx({ promptText: '인벤토리 격자 고쳐줘' })) ?? '';
    expect(block).toContain('인벤토리 격자');
    expect(block).not.toContain('docs/기획/화면.md#');
  });

  it('큰 절에는 Grep 으로 좁히라는 표시가 붙는다', () => {
    const ctx = makeCtx({
      promptText: 'REQ-77 확인',
      readFile: (p) => (p === 'docs/기획/화면.md' ? ['## REQ-77 큰 절', '', hangul(OVER)].join('\n') : p === '.vibisual/spec.json' ? '{"enabledProject":true}' : null),
      listFiles: () => ['docs/기획/화면.md'],
    });
    expect(buildSpecPromptBlock(ctx) ?? '').toContain('큰 절');
  });

  it('상한 밖으로 밀린 문서 수가 색인 줄에 적힌다', () => {
    const n = SPEC_DOC_FILE_MAX + 2;
    const files: Record<string, string> = { '.vibisual/spec.json': '{"enabledProject":true}' };
    for (let i = 0; i < n; i++) files[`docs/d${i}.md`] = `## 절 ${i}\n\n본문.`;
    const ctx = makeCtx({ readFile: (p) => files[p] ?? null, listFiles: () => Object.keys(files).filter((f) => f.startsWith('docs/')) });
    expect(buildSpecPromptBlock(ctx) ?? '').toContain('상한 밖 문서 2장');
  });

  it('실측에 못 실은 문서 수·제외 수·큰 절 수가 함께 나온다', () => {
    const facts = surveySpecFacts(makeCtx({ promptText: 'REQ-14' }));
    expect(facts.indexSkipped).toBe(0);
    expect(facts.indexExcluded).toBe(0);
    expect(facts.oversizedRequired).toBe(0);
  });
});

describe('인용 대조 — 파일 원문을 함께 돌려준다', () => {
  const base = { unitId: 'REQ-14', file: 'docs/기획/전투.md', fromLine: 3, toLine: 7, verified: false, checkedAt: 0 };

  it('통과한 인용에도 원문이 붙는다 — 화면이 나란히 놓는 재료다', () => {
    const c = verifyCitation(makeCtx(), { ...base, quote: '치명타는 2배로 계산해야 한다.' });
    expect(c.verified).toBe(true);
    expect(c.actual).toContain('치명타는 2배로 계산해야 한다.');
  });

  it('어긋난 인용에는 그 자리의 실제 원문이 붙는다 — 왜 어긋났는지가 보여야 한다', () => {
    const c = verifyCitation(makeCtx(), { ...base, quote: '치명타는 3배로 계산해야 한다.' });
    expect(c.verified).toBe(false);
    expect(c.failure).toBe('not-found');
    expect(c.actual).toContain('2배');
  });

  it('범위 밖·없는 파일은 원문이 없다', () => {
    expect(verifyCitation(makeCtx(), { ...base, fromLine: 900, toLine: 950, quote: '치명타는 2배로 계산해야 한다.' }).actual).toBeUndefined();
    expect(verifyCitation(makeCtx(), { ...base, file: 'docs/없음.md', quote: '치명타는 2배로 계산해야 한다.' }).actual).toBeUndefined();
  });

  it('긴 원문은 맞은 자리를 가운데로 잘라 준다', () => {
    const long = `${hangul(500)} 핵심 문장은 여기에 있다. ${hangul(500)}`;
    const ctx = makeCtx({ readFile: (p) => (p === 'docs/x.md' ? `## x\n\n${long}` : null) });
    const c = verifyCitation(ctx, { ...base, file: 'docs/x.md', fromLine: 1, toLine: 3, quote: '핵심 문장은 여기에 있다.' });
    expect(c.verified).toBe(true);
    expect(c.actual).toContain('핵심 문장은 여기에 있다.');
    expect((c.actual ?? '').length).toBeLessThan(long.length);
    expect(c.actual?.startsWith('…')).toBe(true);
  });
});

describe('Read 영수증 — 도구가 실제로 돌려준 줄 범위', () => {
  it('응답의 startLine·numLines 가 있으면 그것이 구간이다 — 통째 Read 는 상한에서 잘려 온다', () => {
    const s = spanFromRead('docs/a.md', 1, { totalLines: 3000, returnedFrom: 1, returnedCount: 2000 });
    expect(s).toMatchObject({ fromLine: 1, toLine: 2000, partial: false });
  });

  it('offset 을 준 Read 도 돌려준 범위를 우선한다', () => {
    const s = spanFromRead('docs/a.md', 1, { offset: 100, limit: 500, totalLines: 300, returnedFrom: 100, returnedCount: 201 });
    expect(s).toMatchObject({ fromLine: 100, toLine: 300, partial: false });
  });

  it('돌려준 범위를 모르면 종전 판정 그대로다', () => {
    expect(spanFromRead('docs/a.md', 1, { offset: 10, limit: 5 })).toMatchObject({ fromLine: 10, toLine: 14 });
  });
});

describe('토큰 어림은 한 산식이다', () => {
  it('절의 tokens 는 sdk 의 estimateTokens 와 같은 값이다', () => {
    const [u] = splitUnits('a.md', '## 제목\n\n본문 한 줄.');
    expect(u?.tokens).toBe(estimateTokens('제목\n\n본문 한 줄.'));
  });
});
/**
 * 라우팅이 **무엇을 근거로 절을 세우는가** — 2026-09-11 실측에서 드러난 네 구멍을 여기서 막는다.
 *
 * 이 절의 시험은 전부 같은 것을 묻는다: *기능 이름을 콕 집어 부른 프롬프트가 그 기능의 절을 찾는가,
 * 그러면서 지나가는 말에는 조용한가.* 둘 중 하나만 지키기는 쉽고, 둘을 함께 지키는 것이 어렵다.
 */
describe('라우팅 무게 — 잘린 표지 · 접착제 · 드문 낱말의 자리', () => {
  const fill = (tag: string): string =>
    Array.from({ length: 300 }, (_, i) => `${tag} 채우는 줄 ${i} — 절을 토큰 상한 너머로 밀어 재분할을 부른다.`).join('\n');

  const fakeIndex = (units: SpecUnit[]): SpecIndex => ({
    units,
    docCount: 1,
    truncated: false,
    roots: ['docs'],
    builtAt: 0,
    skippedDocs: [],
    skippedCount: 0,
    excludedCount: 0,
  });

  const unit = (id: string, chain: string): SpecUnit => ({
    id,
    title: chain,
    matchText: chain,
    file: 'docs/기획/화면.md',
    startLine: 1,
    endLine: 2,
    chars: 10,
    requirementCount: 1,
  });

  // 희귀도는 모집단이 있어야 뜻이 생긴다 — 흔한 낱말만 든 절로 색인을 `SPEC_RARE_TITLE_MIN_UNITS` 위로 채운다.
  const commons = Array.from({ length: SPEC_RARE_TITLE_MIN_UNITS + 10 }, (_, i) =>
    unit(`c${i}`, `5.5 화면 › ${i}. 세션 목록과 화면 배치 › (a) 세션 줄을 그린다`));
  const inHead = unit('head', '5.5 화면 › 17-44. 기획을 어디까지 읽었는지 보여 준다 — 활동바 정독 › ② 배지 규약');
  const inLeaf = unit('leaf', '5.5 화면 › 17-18. 날짜 표시 › ⑧-2 날짜를 숨기지 않는다 — 오늘 것도 오늘 14:32 로');
  const big = fakeIndex([...commons, inHead, inLeaf]);

  it('표지는 낱말 경계에서 자르고, 찾기는 자르지 않은 제목으로 한다', () => {
    // 우리 헤딩은 "번호. 무엇을 왜 — **어디**" 꼴이라 가장 검색될 낱말이 늘 꼬리에 있다.
    const label = `17-44. ${'에이전트가 기획을 어디까지 읽었는지 보여 준다 '.repeat(2)}— 활동바 정독`;
    expect(label.indexOf('정독'), '시험이 뜻을 가지려면 핵심어가 상한 너머에 있어야 한다')
      .toBeGreaterThan(SPEC_ITEM_LABEL_MAX);

    const doc = ['# 화면', '', label, '', fill('가'), '', '17-45. 다른 항목', '', fill('나')].join('\n');
    const units = splitUnits('docs/기획/화면.md', doc);
    const target = units.find((u) => (u.matchText ?? '').includes('정독'));
    expect(target, '자르지 않은 제목에는 핵심어가 남아야 한다 — 없으면 색인이 그 낱말을 영영 못 본다').toBeDefined();

    // 문단으로 한 번 더 잘린 조각은 표지 뒤에 `(1/3)` 이 붙는다 — 표지 자체를 보려면 그것을 떼고 본다.
    const labelOf = (chain: string): string => (chain.split(' › ')[1] ?? '').replace(/ \(\d+\/\d+\)$/, '');
    const shown = labelOf(target?.title ?? '');
    const full = labelOf(target?.matchText ?? '');
    expect(full).toContain('정독');
    expect(shown.length).toBeLessThanOrEqual(SPEC_ITEM_LABEL_MAX);
    // 낱말 한가운데서 자르지 않는다 — `활동바 정` 같은 반토막은 사람도 색인도 못 알아본다.
    expect(full.split(' ')).toContain(shown.split(' ').pop());
  });

  it('드문 낱말이 절 제목에 서면 혼자로도 걸린다 — 기능 이름을 콕 집은 프롬프트가 떨어지면 안 된다', () => {
    const req = routeRequiredUnits(big, makeCtx({ promptText: '정독 기능 개선해줘' }), normalizeSpecSettings({}));
    expect(req.map((r) => r.unitId)).toEqual(['head']);
  });

  it('말단 표지에만 스친 드문 낱말은 혼자로 안 선다 — 「안녕 오늘 뭐 할까」에 절이 서던 자리다', () => {
    const req = routeRequiredUnits(big, makeCtx({ promptText: '안녕 오늘 뭐 할까' }), normalizeSpecSettings({}));
    expect(req).toHaveLength(0);
  });

  it('접착제 낱말 둘로는 안 선다 — 「지금」+「기능」이 무관한 절을 세우던 자리다', () => {
    const goal = unit('goal', '5.5 화면 › 17-17. 세션 목표 — 지금 도는 세션 › ① 목표는 이 기능의 주인이 세션이라는 뜻');
    const req = routeRequiredUnits(
      fakeIndex([...commons, goal]),
      makeCtx({ promptText: '지금 이 기능 고쳐줘' }),
      normalizeSpecSettings({}),
    );
    expect(req).toHaveLength(0);
  });

  it('절이 적은 색인에서는 희귀도를 안 센다 — 모집단 없이 재면 모든 낱말이 드문 낱말이 된다', () => {
    const tiny = fakeIndex([unit('one', '화면 › 정독 관문 화면')]);
    const req = routeRequiredUnits(tiny, makeCtx({ promptText: '정독 고쳐줘' }), normalizeSpecSettings({}));
    expect(req).toHaveLength(0);
  });

  it('규율은 셸로 읽은 것을 안 쳐 준다고 말한다 — 하네스가 `cat`·`sed` 로 읽으라 시키는 자리가 있다', () => {
    for (const promptText of ['REQ-14 고쳐줘', '전혀 상관 없는 잡담']) {
      const block = buildSpecPromptBlock(makeCtx({ promptText })) ?? '';
      expect(block, promptText).toContain('`cat`');
      expect(block, promptText).toContain('열람으로 안 쳐 준다');
    }
  });
});
