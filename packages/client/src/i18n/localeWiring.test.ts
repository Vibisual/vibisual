/**
 * §5.11 — **언어 배선이 제 짝을 물었는가.**
 *
 * `i18n/index.ts` 는 로케일마다 한 줄씩 `withPlugins(<번역 JSON>, '<로케일>')` 을 적는다. 두 인자가
 * 어긋나도(예: `fr: withPlugins(fr, 'de')`) 타입은 통과한다 — 둘 다 그냥 문자열과 객체다. 그러면
 * 프랑스어 사용자에게 창 뼈대는 프랑스어인데 **카드 111종만 독일어**로 뜨고, 앱은 멀쩡히 돈다.
 *
 * 기존 검사들은 이 자리를 못 본다. `pluginCoverage` 는 "각 로케일의 카드 문자열이 en 과 같은 키를 갖는가"
 * 만 보고(플러그인 쪽), 로케일 파일 검사는 JSON 만 본다(호스트 쪽). **둘을 잇는 한 줄**은 아무도 안 봤다.
 *
 * 지원 언어가 늘었는데 여기 등록을 잊는 경우도 같은 종류다 — 그 언어를 고르면 화면 전체가 조용히
 * 영어로 폴백되고, 사용자는 "번역이 아직 없나 보다"라고 생각한다.
 */
import { describe, it, expect } from 'vitest';
import { SUPPORTED_UI_LOCALES } from '@vibisual/shared';
import { pluginLocaleResources } from '@vibisual/plugins/locales';
import i18n from './index.js';

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

const bundleOf = (locale: string): Tree | undefined =>
  i18n.getResourceBundle(locale, 'translation') as Tree | undefined;

const cardStringsIn = (locale: string): Record<string, string> => {
  const panel = (bundleOf(locale)?.panel ?? {}) as Tree;
  return flatten(panel.plugins ?? {});
};

describe('언어 배선', () => {
  it('지원 언어가 전부 등록돼 있다 — 빠진 언어를 고르면 화면이 통째로 영어가 된다', () => {
    const missing = SUPPORTED_UI_LOCALES.filter((l) => bundleOf(l) === undefined);
    expect(missing, `등록 안 된 언어: ${missing.join(', ')}`).toEqual([]);
  });

  it('등록된 언어가 지원 목록 밖으로 새지 않는다 — 고를 수 없는 언어를 싣지 않는다', () => {
    const known = new Set<string>(SUPPORTED_UI_LOCALES);
    const loaded = Object.keys((i18n.options.resources ?? {}) as Tree);
    expect(loaded.filter((l) => !known.has(l))).toEqual([]);
  });

  for (const locale of SUPPORTED_UI_LOCALES) {
    it(`${locale} — 카드 문자열이 그 언어 자신의 것이다(짝이 어긋나지 않았다)`, () => {
      const wired = cardStringsIn(locale);
      const own = flatten(pluginLocaleResources(locale));
      expect(Object.keys(own).length, `${locale} 의 카드 문자열이 비어 있다`).toBeGreaterThan(1000);

      const wrong = Object.entries(own).filter(([k, v]) => wired[k] !== v);
      // 어긋난 키를 몇 개만 보여 준다 — 배선이 통째로 어긋나면 목록이 1,000줄이 된다.
      expect(wrong.slice(0, 5), `${locale} 에 다른 언어의 카드 문자열이 실렸다 (총 ${wrong.length}개)`).toEqual([]);
    });
  }
});
