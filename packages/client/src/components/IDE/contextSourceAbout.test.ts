import { describe, it, expect } from 'vitest';
import { CONTEXT_SOURCE_ID_LIST, CONTEXT_SOURCE_IDS, CONTEXT_PLUGIN_ID_PREFIX } from '@vibisual/shared';
import en from '../../i18n/locales/en.json';
import ko from '../../i18n/locales/ko.json';
import {
  CONTEXT_ABOUT_FIELDS,
  CONTEXT_ABOUT_PLUGIN_KEY,
  aboutKeyCandidates,
  aboutSlugFor,
  controlExplainKey,
} from './contextSourceAbout.js';
import { CONTEXT_CATEGORY_ORDER } from './contextInventoryView.js';

/**
 * §5.5 #17-28 ⑦ — **설명 없는 줄이 생기지 않게** 막는 테스트.
 *
 * 주입원은 앞으로도 늘어난다. 설명 없이 하나가 들어오면 사용자는 다시 `cc.???` 를 보게 되고,
 * 그 줄은 "무엇이 사라지는지 모르는 스위치"가 되어 아무도 못 끈다. 그래서 이 파일이 먼저 막는다 —
 * 전 항목 × (무엇인가·어디서·끄면) × (en·ko).
 */

/** 점으로 이어진 키를 로케일 객체에서 꺼낸다. 없으면 undefined. */
function lookup(bundle: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, bundle);
}

/** 그 키에 **읽을 수 있는 문장**이 들어 있는가(빈 문자열은 없는 것과 같다). */
function hasText(bundle: unknown, key: string): boolean {
  const v = lookup(bundle, key);
  return typeof v === 'string' && v.trim().length > 0;
}

const LOCALES: { name: string; bundle: unknown }[] = [
  { name: 'en', bundle: en },
  { name: 'ko', bundle: ko },
];

describe('aboutSlugFor', () => {
  it('알려진 주입원은 모두 제 설명 조각을 가진다', () => {
    const missing = CONTEXT_SOURCE_ID_LIST.filter((id) => aboutSlugFor(id) === null);
    expect(missing).toEqual([]);
  });

  it('개별 플러그인 줄은 111종이 한 벌을 나눠 쓴다', () => {
    expect(aboutSlugFor(`${CONTEXT_PLUGIN_ID_PREFIX}ssot-drift`)).toBe(CONTEXT_ABOUT_PLUGIN_KEY);
    expect(aboutSlugFor(`${CONTEXT_PLUGIN_ID_PREFIX}anything-else`)).toBe(CONTEXT_ABOUT_PLUGIN_KEY);
  });

  it('모르는 id 는 전용 설명이 없다(= 분류 설명으로 물러난다)', () => {
    expect(aboutSlugFor('cc.some-future-source')).toBeNull();
  });
});

describe('aboutKeyCandidates', () => {
  it('전용 설명을 먼저 보고 분류 설명으로 물러난다', () => {
    const keys = aboutKeyCandidates(CONTEXT_SOURCE_IDS.claudeMd, 'instructions', 'what');
    expect(keys).toEqual(['ide.context.about.src.claudeMd.what', 'ide.context.about.cat.instructions.what']);
  });

  it('모르는 주입원도 최소한 분류 설명 한 줄은 받는다', () => {
    const keys = aboutKeyCandidates('cc.some-future-source', 'system', 'off');
    expect(keys).toEqual(['ide.context.about.cat.system.off']);
  });
});

describe('설명 번역문 (en · ko)', () => {
  for (const { name, bundle } of LOCALES) {
    it(`${name}: 모든 주입원이 무엇인가·어디서·끄면 세 문장을 갖는다`, () => {
      const missing: string[] = [];
      for (const id of CONTEXT_SOURCE_ID_LIST) {
        for (const field of CONTEXT_ABOUT_FIELDS) {
          const key = aboutKeyCandidates(id, 'system', field)[0]!;
          if (!hasText(bundle, key)) missing.push(key);
        }
      }
      expect(missing).toEqual([]);
    });

    it(`${name}: 개별 플러그인 줄의 공용 설명이 있다`, () => {
      for (const field of CONTEXT_ABOUT_FIELDS) {
        expect(hasText(bundle, `ide.context.about.src.${CONTEXT_ABOUT_PLUGIN_KEY}.${field}`)).toBe(true);
      }
    });

    it(`${name}: 모든 분류가 폴백 설명을 갖는다`, () => {
      const missing: string[] = [];
      for (const category of CONTEXT_CATEGORY_ORDER) {
        for (const field of CONTEXT_ABOUT_FIELDS) {
          const key = `ide.context.about.cat.${category}.${field}`;
          if (!hasText(bundle, key)) missing.push(key);
        }
      }
      expect(missing).toEqual([]);
    });

    it(`${name}: 통제 성격 넷을 모두 풀어 쓴다`, () => {
      for (const control of ['session', 'spawn', 'external', 'none']) {
        expect(hasText(bundle, controlExplainKey(control))).toBe(true);
      }
    });
  }

  it('ko 가 en 과 같은 설명 키를 갖는다(한쪽만 늘어나면 그 줄만 영어로 뜬다)', () => {
    const flatten = (obj: unknown, prefix = ''): string[] => {
      if (!obj || typeof obj !== 'object') return [prefix];
      return Object.entries(obj as Record<string, unknown>)
        .flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k));
    };
    const enKeys = flatten(lookup(en, 'ide.context')).sort();
    const koKeys = flatten(lookup(ko, 'ide.context')).sort();
    expect(koKeys).toEqual(enKeys);
  });
});
