/**
 * **`Agent` 는 번역하지 않는다 — 12개 로케일 전부 영문 그대로**(제품 용어 — 화면·문서·코드가 한 낱말이라야 검색이 이어진다).
 * `en.json` 의 대문자 `Agent`/`Agents`(제품명)는 같은 키의 번역문에도 라틴 문자로 있어야 한다. 소문자 산문까지 잠그려면 `AGENT_KEYS` 정규식만 대소문자 무시로.
 * 플러그인 카드 문자열은 `pluginCoverage.test.ts` 가 본다.
 */
import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import ko from './locales/ko.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import es from './locales/es.json';
import es419 from './locales/es-419.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import hi from './locales/hi.json';
import id from './locales/id.json';
// `it` 은 vitest 의 테스트 함수와 이름이 부딪힌다 — 이탈리아어 쪽을 비켜 준다.
import itIT from './locales/it.json';
import ptBR from './locales/pt-BR.json';

type Tree = Record<string, unknown>;

function flatten(node: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (!node || typeof node !== 'object') return out;
  for (const [k, v] of Object.entries(node as Tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else if (typeof v === 'string') out[key] = v;
  }
  return out;
}

/** en 을 뺀 전 로케일. 하나도 예외를 두지 않는다 — 예외를 두는 순간 그 언어만 조용히 갈라진다. */
const LOCALES: ReadonlyArray<readonly [string, unknown]> = [
  ['ko', ko], ['ja', ja], ['zh-CN', zhCN], ['es', es], ['es-419', es419], ['fr', fr],
  ['de', de], ['hi', hi], ['id', id], ['it', itIT], ['pt-BR', ptBR],
];

/** 제품 용어로서의 `Agent`. 대문자로 시작하는 것만 본다 — 문장 속 소문자 'agent' 는 보통명사일 수 있다. */
const AGENT_WORD = /\bAgents?\b/;
/** 번역문 쪽은 대소문자를 가리지 않는다 — 낱말이 라틴 문자로 살아 있기만 하면 된다. */
const AGENT_WORD_ANY_CASE = /\bagents?\b/i;

const EN = flatten(en);
const AGENT_KEYS = Object.keys(EN).filter((k) => AGENT_WORD.test(EN[k]!));

/** 대문자 제품명만 있고 소문자 `agent` 가 섞이지 않은 키 — 섞인 문자열은 보통명사가 옳게 번역돼 옛 번역어가 설 수 있어 "옛 번역어" 검사는 이 키에만 건다. */
const AGENT_WORD_LOWER = /\bagents?\b/;
const PURE_TERM_KEYS = AGENT_KEYS.filter((k) => !AGENT_WORD_LOWER.test(EN[k]!));

/** 각 언어의 옛 `Agent` 번역어 — 제품 용어 키에서 되살아나면 걸린다. `fr` 은 일부러 없다(철자가 같아 정답을 오답으로 잡는다). */
const LOCALIZED_FORMS: Record<string, RegExp> = {
  ko: /에이전트/,
  ja: /エージェント/,
  'zh-CN': /智能体|代理人?/,
  es: /\bagentes?\b/i,
  'es-419': /\bagentes?\b/i,
  'pt-BR': /\bagentes?\b/i,
  // 이탈리아어 실제 형태는 agente/agenti 다. `agenti?` 로 쓰면 `i?` 가 비어도 성립해 `Agent` 자체를 잡는다.
  it: /\bagent[ei]\b/i,
  de: /\bAgenten\b/,
  hi: /एजेंट/,
  id: /\bagen(?!t)\b/i,
};

describe('Agent 는 번역하지 않는다', () => {
  it('en.json 이 실제로 이 낱말을 쓴다 — 정본이 비면 나머지 검사가 공짜로 통과한다', () => {
    expect(AGENT_KEYS.length).toBeGreaterThan(20);
    expect(PURE_TERM_KEYS.length).toBeGreaterThan(20);
  });

  it('옛 번역어 목록이 fr 만 비운다 — 새 로케일이 검사 없이 지나가지 않는다', () => {
    const uncovered = LOCALES.map(([n]) => n).filter((n) => !LOCALIZED_FORMS[n]);
    expect(uncovered).toEqual(['fr']);
  });

  for (const [name, bundle] of LOCALES) {
    it(`${name} — 영문이 Agent 를 쓴 자리에 Agent 가 그대로 있다`, () => {
      const dict = flatten(bundle);
      const lost = AGENT_KEYS
        .filter((k) => typeof dict[k] === 'string' && !AGENT_WORD_ANY_CASE.test(dict[k]!))
        .map((k) => `${k}: ${JSON.stringify(EN[k])} -> ${JSON.stringify(dict[k])}`);
      // 통째로 어긋나면 목록이 수십 줄이 되므로 앞의 몇 개만 보여 준다(총 개수는 메시지에).
      expect(lost.slice(0, 5), `${name} 에서 Agent 가 번역됐다 (총 ${lost.length}개)`).toEqual([]);
    });

    const re = LOCALIZED_FORMS[name];
    // fr 은 옛 번역어라는 것이 없다(영어와 철자가 같다). 목록에서 새어 나간 게 아니라는 건
    // 아래 "옛 번역어 목록이 fr 만 비운다" 검사가 지킨다.
    if (!re) continue;

    it(`${name} — 제품 용어 자리에 옛 번역어가 함께 서 있지 않다`, () => {
      const dict = flatten(bundle);
      const revived = PURE_TERM_KEYS
        .filter((k) => typeof dict[k] === 'string' && re.test(dict[k]!))
        .map((k) => `${k}: ${JSON.stringify(dict[k])}`);
      expect(revived.slice(0, 5), `${name} 에 옛 번역어가 남아 있다 (총 ${revived.length}개)`).toEqual([]);
    });
  }
});
