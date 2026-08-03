/**
 * §5.11 v4.17 — 플러그인 문자열 로케일 커버리지.
 *
 * 플러그인 카드가 111종이 되면서 문자열이 1,200개를 넘었다. 채우는 동안에는 "지금보다 뒤로 가지 못하게"만
 * 막는 래칫(FLOOR)으로 버텼지만, **12개 로케일이 전부 100퍼센트가 된 지금 래칫은 걷어냈다.**
 * 남은 규칙은 하나뿐 — 모든 로케일이 `en` 과 **완전히 일치**한다.
 *
 * 이 검사가 필요한 이유: 미번역 키는 영어로 폴백되므로 **앱은 멀쩡히 동작한다.** 즉 빠뜨려도 아무도 모르고,
 * 그 언어를 쓰는 사람 화면만 조용히 반쯤 영어가 된다. 새 플러그인을 추가하면서 en 에만 문자열을 넣으면
 * 여기서 12개가 한꺼번에 빨갛게 뜨는 것이 정상 동작이다 — 그때 12개를 다 채우고 넘어가라는 뜻이다.
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
import itIT from './locales/it.json';  // 'it' 는 vitest 의 테스트 함수와 이름이 겹친다
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

const plugins = (locale: unknown): Record<string, string> =>
  flatten(((locale as Tree).panel as Tree | undefined)?.['plugins']);

const EN_KEYS = Object.keys(plugins(en));

/** en 을 뺀 전 로케일. 하나도 예외를 두지 않는다 — 예외를 두는 순간 그 언어만 조용히 뒤처진다. */
const LOCALES: [string, unknown][] = [
  ['ko', ko], ['ja', ja], ['zh-CN', zhCN], ['de', de], ['fr', fr], ['es', es],
  ['es-419', es419], ['pt-BR', ptBR], ['it', itIT], ['id', id], ['hi', hi],
];

describe('플러그인 문자열 커버리지', () => {
  it('en 에 플러그인 문자열이 실제로 있다 — 정본이 비면 나머지 검사가 무의미하다', () => {
    expect(EN_KEYS.length).toBeGreaterThan(1000);
  });

  it('지원 로케일이 12개 전부 검사 대상이다 — 새 언어를 추가하고 여기 등록을 잊으면 그 언어만 빠진다', () => {
    expect(LOCALES).toHaveLength(11); // en 을 뺀 수
  });

  for (const [name, locale] of LOCALES) {
    it(`${name} 는 en 과 완전히 일치한다`, () => {
      const dict = plugins(locale);
      expect(EN_KEYS.filter((k) => typeof dict[k] !== 'string')).toEqual([]);
    });
  }
});
