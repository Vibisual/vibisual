import { describe, it, expect } from 'vitest';
import { EXTERNAL_PLACE_PATTERNS, SUPPORTED_UI_LOCALES } from '@vibisual/shared';
import en from './locales/en.json';

/**
 * §2.1 (D) 읽는 이름 — **사전과 번역이 한 벌인가**를 못박는다.
 *
 * 서버는 문구가 아니라 `externalPlaceKey` 만 실어 보내고(로케일이 12개라 문구를 서버가 고를 수 없다),
 * 화면은 `canvas.externalPlace.<key>` 로 그것을 문장으로 바꾼다. 그래서 두 목록이 어긋나는 순간
 * 이 축은 **조용히 죽는다** — 키가 없으면 `defaultValue: ''` 로 떨어져 종전 라벨로 되돌아가므로
 * 타입도 빌드도 화면도 멀쩡하고, "왜 이 폴더만 이름이 안 바뀌지"로만 보인다.
 * 사전에 자리를 하나 더 넣는 사람이 번역을 잊는 것은 시간 문제라, 그 자리를 여기서 잡는다.
 */

type Dict = Record<string, unknown>;

const localeSources = import.meta.glob('./locales/*.json', { eager: true });

function placeStrings(locale: Dict): Record<string, string> {
  const canvas = locale.canvas as Dict | undefined;
  return (canvas?.externalPlace ?? {}) as Record<string, string>;
}

function localeDict(loc: string): Dict {
  const mod = localeSources[`./locales/${loc}.json`] as { default?: Dict } | undefined;
  if (!mod) throw new Error(`로케일 파일이 없다: ${loc}.json`);
  return (mod.default ?? mod) as Dict;
}

/** `{{name}}` 같은 보간 변수 집합 — 언어마다 어순은 달라도 **변수는 같아야** 한다. */
function varsOf(text: string): string[] {
  return [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]!).sort();
}

const enPlaces = placeStrings(en as unknown as Dict);

describe('외부 자리 사전 ↔ 번역', () => {
  it('사전의 모든 자리에 영문 문장이 있다', () => {
    const missing = EXTERNAL_PLACE_PATTERNS
      .map((p) => p.key)
      .filter((key) => typeof enPlaces[key] !== 'string' || enPlaces[key]!.trim() === '');
    expect(missing).toEqual([]);
  });

  it('사전에 없는 자리 이름이 남아 있지 않다', () => {
    // 사전에서 뺀 자리의 문장이 남으면 아무도 안 부르는 죽은 글이 된다(다음 사람은 살아 있다고 믿는다).
    const known = new Set<string>(EXTERNAL_PLACE_PATTERNS.map((p) => p.key));
    expect(Object.keys(enPlaces).filter((k) => !known.has(k))).toEqual([]);
  });
});

describe('로케일 전부가 같은 자리를 안다', () => {
  for (const loc of SUPPORTED_UI_LOCALES) {
    it(`${loc} — 자리 전부 번역 + 변수 일치`, () => {
      const places = placeStrings(localeDict(loc));

      const missing = Object.keys(enPlaces).filter(
        (k) => typeof places[k] !== 'string' || places[k]!.trim() === '',
      );
      expect(missing).toEqual([]);

      // 변수를 잃으면 자리를 가르는 조각(프로젝트명·스킬명)이 통째로 사라져, 같은 이름의 자리
      // 여럿이 화면에서 **똑같은 한 문장**이 된다 — 읽히게 만들려던 것이 오히려 구분을 지운다.
      const varDrift = Object.keys(enPlaces).filter(
        (k) => varsOf(places[k]!).join(',') !== varsOf(enPlaces[k]!).join(','),
      );
      expect(varDrift).toEqual([]);
    });
  }
});
