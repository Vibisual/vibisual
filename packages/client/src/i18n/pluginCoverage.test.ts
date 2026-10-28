/** §5.11 — 플러그인 문자열 로케일 키가 **`en` 과 완전히 일치**한다(빠지면 조용히 영어). 호스트가 얹는 같은 함수(`pluginLocaleResources`)로 본다 — 두 군데서 읽으면 검사와 화면이 갈린다. */
import { describe, it, expect } from 'vitest';
import { pluginLocaleResources } from '@vibisual/plugins/locales';

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

const plugins = (locale: string): Record<string, string> => flatten(pluginLocaleResources(locale));

const EN_KEYS = Object.keys(plugins('en'));

/** en 을 뺀 전 로케일. 하나도 예외를 두지 않는다 — 예외를 두는 순간 그 언어만 조용히 뒤처진다. */
const LOCALES = ['ko', 'ja', 'zh-CN', 'de', 'fr', 'es', 'es-419', 'pt-BR', 'it', 'id', 'hi'];

describe('플러그인 문자열 커버리지', () => {
  it('en 에 플러그인 문자열이 실제로 있다 — 정본이 비면 나머지 검사가 무의미하다', () => {
    expect(EN_KEYS.length).toBeGreaterThan(1000);
  });

  it('지원 로케일이 12개 전부 검사 대상이다 — 새 언어를 추가하고 여기 등록을 잊으면 그 언어만 빠진다', () => {
    expect(LOCALES).toHaveLength(11); // en 을 뺀 수
  });

  for (const name of LOCALES) {
    it(`${name} 는 en 과 완전히 일치한다`, () => {
      const dict = plugins(name);
      // 폴백이 en 객체를 그대로 돌려주면 "일치"가 공짜가 된다 — 그건 번역이 아니라 누락이다.
      expect(dict, `${name} 가 en 으로 폴백되고 있다`).not.toBe(plugins('en'));
      expect(EN_KEYS.filter((k) => typeof dict[k] !== 'string')).toEqual([]);
    });
  }
});
