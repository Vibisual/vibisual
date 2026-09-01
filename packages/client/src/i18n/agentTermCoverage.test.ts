/**
 * **`Agent` 는 번역하지 않는다 — 12개 로케일 전부에서 영문 그대로다.**
 *
 * 이건 취향이 아니라 제품 용어 결정이다. 캔버스의 버블, 탭 이름표, 설정창 제목, 문서, 이 저장소의
 * 코드 식별자(`agentId`·`AgentConfig`·`/api/agent-report`)가 전부 `Agent` 한 낱말을 쓴다. 로케일마다
 * `에이전트`·`エージェント`·`智能体`·`agente`·`Agenten` 으로 갈라지면, 사용자가 화면에서 본 말과
 * 문서·오류 메시지·우리끼리 쓰는 말이 서로 다른 낱말이 되어 **검색으로도 이어지지 않는다.**
 *
 * 이 검사가 없으면 조용히 어긋난다. 번역 라운드는 로케일마다 다른 사람(에이전트)이 돌리고, 그때마다
 * "이 낱말은 그 언어로 옮기는 게 자연스럽다"는 판단이 각자 내려진다 — 실제로 2026-09-01 점검에서
 * 10개 로케일 254곳이 그렇게 번역돼 있었다(fr 만 철자가 같아 살아남았다). 번역문은 문법이 맞고
 * 읽기에도 자연스러워서, 화면만 봐서는 아무도 이상하다고 느끼지 않는다.
 *
 * 그래서 판정을 사람 눈이 아니라 여기에 둔다. 정본은 `en.json` 이다 — 영문 원문이 낱말 `Agent`/`Agents`
 * 를 쓰면, 같은 키의 번역문도 그 낱말을 라틴 문자 그대로 들고 있어야 한다. 주변 문법(관사·조사·어미)은
 * 그 언어 것을 쓰면 된다. 검사하는 것은 **낱말 하나가 살아 있는가**뿐이다.
 *
 * **대문자만 본다.** `en.json` 은 제품명(`Custom Agent`·`Auto Agent`·`Agent Lab` — 캔버스가 만드는
 * 버블 종류)을 대문자로, 문장 속 보통명사(`no agents in this project yet`)를 소문자로 적어 둘을
 * 구분한다. 이 검사가 잠그는 건 앞엣것뿐이다. 소문자 산문까지 영문으로 고정할지는 아직 정해지지
 * 않았다 — 정해지면 `AGENT_KEYS` 의 정규식만 대소문자 무시로 바꾸면 그대로 확장된다.
 *
 * 범위는 로케일 JSON 12장이다. 플러그인 카드 문자열(`panel.plugins.*`)은 각 플러그인 폴더의
 * `strings.ts` 가 정본이라 여기서 보지 않는다(§5.11 v4.58 자립 규약 — `pluginCoverage.test.ts` 담당).
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

/**
 * 대문자 제품명만 들어 있고 소문자 산문은 섞이지 않은 키.
 *
 * 한 문자열이 둘을 다 갖는 경우가 있다 — 예: "…credit pool of the **Agent SDK**. Does not apply to
 * this **agent**'s interactive runs." 이런 문자열의 올바른 번역문은 `Agent SDK` 는 영문으로 두고
 * 뒤의 보통명사만 그 언어로 옮긴 것이라, 문자열 단위로는 옛 번역어의 존재만 보고는 옳고 그름을
 * 가릴 수 없다. 그래서 아래 "옛 번역어" 검사는 섞이지 않은 키에만 건다.
 */
const AGENT_WORD_LOWER = /\bagents?\b/;
const PURE_TERM_KEYS = AGENT_KEYS.filter((k) => !AGENT_WORD_LOWER.test(EN[k]!));

/**
 * 각 언어가 예전에 `Agent` 를 옮길 때 쓰던 말. 제품 용어 키에서 되살아나면 여기서 걸린다.
 * (`Agent` 가 남아 있어도 옛말이 **함께** 서 있으면 한 화면에 두 낱말이 도는 것이라 그것도 어긋남이다.)
 *
 * `fr` 이 없는 건 빠뜨린 게 아니다 — 프랑스어의 `agent` 는 영어와 철자가 같아서 "옛 번역어"라는
 * 것이 존재하지 않는다. 정규식을 넣으면 정답을 오답으로 잡는다.
 */
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
